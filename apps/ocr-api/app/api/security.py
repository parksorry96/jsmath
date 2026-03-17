from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import time
from typing import Any

import redis.asyncio as aioredis
from fastapi import Depends, Header, HTTPException, Request, status

from app.config import settings


async def verify_internal_api_token(
    x_internal_api_token: str | None = Header(default=None),
) -> None:
    """Allow only trusted internal callers to use OCR management endpoints."""
    expected_token = settings.internal_api_token
    if not expected_token:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Internal API token is not configured",
        )

    if (
        not x_internal_api_token
        or not secrets.compare_digest(x_internal_api_token, expected_token)
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid internal API token",
        )


def _decode_base64url(value: str) -> bytes:
    padded = value + "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(padded.encode("utf-8"))


def _verify_jwt(token: str) -> dict[str, Any]:
    if not settings.jwt_secret:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="JWT secret is not configured",
        )

    parts = token.split(".")
    if len(parts) != 3:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    header_segment, payload_segment, signature_segment = parts
    try:
        header = json.loads(_decode_base64url(header_segment))
        payload = json.loads(_decode_base64url(payload_segment))
    except (ValueError, json.JSONDecodeError) as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token",
        ) from exc

    if header.get("alg") != "HS256":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unsupported token")

    signing_input = f"{header_segment}.{payload_segment}".encode("utf-8")
    expected_signature = base64.urlsafe_b64encode(
        hmac.new(
            settings.jwt_secret.encode("utf-8"),
            signing_input,
            hashlib.sha256,
        ).digest(),
    ).rstrip(b"=").decode("utf-8")

    if not hmac.compare_digest(signature_segment, expected_signature):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    exp = payload.get("exp")
    if isinstance(exp, (int, float)) and exp < time.time():
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token expired")

    if not isinstance(payload.get("sub"), str):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    return payload


async def verify_authenticated_user(
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
        )

    token = authorization.removeprefix("Bearer ").strip()
    return _verify_jwt(token)


def _get_shared_redis_client(request: Request) -> aioredis.Redis:
    redis = getattr(request.app.state, "redis", None)
    if redis is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Redis client is not initialized",
        )
    return redis


async def rate_limit_single_problem_ocr(
    request: Request,
    payload: dict[str, Any] = Depends(verify_authenticated_user),
) -> None:
    redis = _get_shared_redis_client(request)
    key = (
        f"rate-limit:single-ocr:{payload['sub']}:"
        f"{request.client.host if request.client else 'unknown'}"
    )
    count = await redis.incr(key)
    if count == 1:
        await redis.expire(key, 60)
    if count > settings.single_ocr_rate_limit_per_minute:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="OCR rate limit exceeded",
        )
