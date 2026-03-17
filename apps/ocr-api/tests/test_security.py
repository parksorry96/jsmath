from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.api import security
from app.config import settings


def make_jwt(payload: dict[str, object], secret: str) -> str:
    header = {"alg": "HS256", "typ": "JWT"}

    def encode(value: dict[str, object]) -> str:
        raw = json.dumps(value, separators=(",", ":"), sort_keys=True).encode("utf-8")
        return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("utf-8")

    header_segment = encode(header)
    payload_segment = encode(payload)
    signing_input = f"{header_segment}.{payload_segment}".encode("utf-8")
    signature = base64.urlsafe_b64encode(
        hmac.new(secret.encode("utf-8"), signing_input, hashlib.sha256).digest()
    ).rstrip(b"=").decode("utf-8")
    return f"{header_segment}.{payload_segment}.{signature}"


def test_verify_jwt_accepts_valid_hs256_token() -> None:
    previous_secret = settings.jwt_secret
    settings.jwt_secret = "test-secret"
    try:
        token = make_jwt(
            {"sub": "user-1", "role": "student", "exp": int(time.time()) + 60},
            settings.jwt_secret,
        )
        payload = security._verify_jwt(token)
        assert payload["sub"] == "user-1"
    finally:
        settings.jwt_secret = previous_secret


@pytest.mark.asyncio
async def test_single_problem_rate_limit_rejects_after_limit() -> None:
    class FakeRedis:
        def __init__(self) -> None:
            self.count = 0

        async def incr(self, _key: str) -> int:
            self.count += 1
            return self.count

        async def expire(self, _key: str, _seconds: int) -> None:
            return None

        async def aclose(self) -> None:
            return None

    fake_redis = FakeRedis()

    previous_limit = settings.single_ocr_rate_limit_per_minute
    settings.single_ocr_rate_limit_per_minute = 1
    try:
        request = SimpleNamespace(
            client=SimpleNamespace(host="127.0.0.1"),
            app=SimpleNamespace(state=SimpleNamespace(redis=fake_redis)),
        )
        payload = {"sub": "user-1"}

        await security.rate_limit_single_problem_ocr(request, payload)
        with pytest.raises(HTTPException) as exc:
            await security.rate_limit_single_problem_ocr(request, payload)

        assert exc.value.status_code == 429
    finally:
        settings.single_ocr_rate_limit_per_minute = previous_limit
