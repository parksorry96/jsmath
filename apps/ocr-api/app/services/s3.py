"""S3 utilities for signed URL generation and file management."""

from __future__ import annotations

import logging

import boto3
from botocore.config import Config

from app.config import settings

logger = logging.getLogger(__name__)

_client = None

MAX_DOWNLOAD_SIZE = 100 * 1024 * 1024  # 100 MB


def _validate_s3_key(s3_key: str) -> str:
    if ".." in s3_key or s3_key.startswith("/"):
        raise ValueError(f"Invalid S3 key: {s3_key}")
    return s3_key


def _get_client():  # type: ignore[no-untyped-def]
    global _client
    if _client is None:
        kwargs: dict = {
            "config": Config(signature_version="s3v4"),
            "region_name": settings.s3_region,
        }
        if settings.s3_access_key_id:
            kwargs["aws_access_key_id"] = settings.s3_access_key_id
            kwargs["aws_secret_access_key"] = settings.s3_secret_access_key
        _client = boto3.client("s3", **kwargs)
    return _client


def generate_presigned_url(s3_key: str, expires_in: int = 900) -> str:
    """Generate a presigned GET URL for an S3 object. Default 15 min expiry."""
    _validate_s3_key(s3_key)
    return _get_client().generate_presigned_url(
        "get_object",
        Params={"Bucket": settings.s3_bucket, "Key": s3_key},
        ExpiresIn=expires_in,
    )


def upload_bytes(s3_key: str, data: bytes, content_type: str = "application/octet-stream") -> None:
    """Upload raw bytes to S3."""
    _validate_s3_key(s3_key)
    _get_client().put_object(
        Bucket=settings.s3_bucket,
        Key=s3_key,
        Body=data,
        ContentType=content_type,
    )
    logger.info("Uploaded to s3://%s/%s", settings.s3_bucket, s3_key)


def download_bytes(s3_key: str, max_size: int = MAX_DOWNLOAD_SIZE) -> bytes:
    """Download raw bytes from S3 with size limit."""
    _validate_s3_key(s3_key)
    response = _get_client().get_object(Bucket=settings.s3_bucket, Key=s3_key)
    content_length = response.get("ContentLength", 0)
    if content_length > max_size:
        raise ValueError(f"S3 object too large: {content_length} bytes (limit: {max_size})")
    return response["Body"].read()
