from __future__ import annotations

import secrets

from fastapi import Header, HTTPException, status

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
