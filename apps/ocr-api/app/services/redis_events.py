"""Redis Pub/Sub event publisher and listener.

Channels:
  - ocr:submit   — NestJS -> FastAPI: new PDF to process
  - ocr:completed — FastAPI -> NestJS: pipeline done
  - ocr:failed    — FastAPI -> NestJS: pipeline failed
  - review:needed — FastAPI -> NestJS: manual review required
"""

from __future__ import annotations

import json
import logging
from typing import Any

import redis

from app.config import settings

logger = logging.getLogger(__name__)


def publish_sync(channel: str, payload: dict[str, Any]) -> None:
    """Publish a JSON event to a Redis channel (sync, safe for Celery workers)."""
    r = redis.from_url(settings.redis_url, decode_responses=True)
    try:
        r.publish(channel, json.dumps(payload))
        logger.info("Published to %s: %s", channel, payload.get("ocrJobId", ""))
    finally:
        r.close()


def notify_completed(
    ocr_job_id: str,
    problem_count: int,
    problems: list[dict[str, Any]] | None = None,
) -> None:
    """Notify NestJS that OCR pipeline completed."""
    payload: dict[str, Any] = {
        "ocrJobId": ocr_job_id,
        "problemCount": problem_count,
    }
    if problems is not None:
        payload["problems"] = problems
    publish_sync("ocr:completed", payload)


def notify_failed(ocr_job_id: str, reason: str, retryable: bool = False) -> None:
    """Notify NestJS that OCR pipeline failed."""
    publish_sync("ocr:failed", {
        "ocrJobId": ocr_job_id,
        "reason": reason,
        "retryable": retryable,
    })


def notify_review_needed(problem_id: str, reason: str, confidence: float) -> None:
    """Notify NestJS that a problem needs manual review."""
    publish_sync("review:needed", {
        "problemId": problem_id,
        "reason": reason,
        "confidence": confidence,
    })
