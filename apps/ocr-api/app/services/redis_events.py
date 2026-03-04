"""Redis Pub/Sub event publisher and listener.

Channels:
  - ocr:submit   — NestJS -> FastAPI: new PDF to process
  - ocr:completed — FastAPI -> NestJS: pipeline done
  - ocr:failed    — FastAPI -> NestJS: pipeline failed
  - review:needed — FastAPI -> NestJS: manual review required
  - analysis:completed — FastAPI -> NestJS: AI analysis done
  - analysis:failed    — FastAPI -> NestJS: AI analysis failed
  - analysis:request   — NestJS -> FastAPI: start AI analysis
"""

from __future__ import annotations

import json
import logging
from typing import Any

import redis

from app.config import settings

logger = logging.getLogger(__name__)


def publish_sync(channel: str, payload: dict[str, Any]) -> None:
    """Publish a JSON event to a Redis channel (sync, safe for Celery workers).

    If no subscribers are listening, pushes to a fallback queue for later processing.
    """
    r = redis.from_url(settings.redis_url, decode_responses=True)
    try:
        data = json.dumps(payload)
        receivers = r.publish(channel, data)
        if receivers == 0:
            fallback_key = f"fallback:{channel}"
            r.lpush(fallback_key, data)
            logger.warning("No subscribers for %s — saved to %s", channel, fallback_key)
        else:
            logger.info("Published to %s (%d receivers): %s", channel, receivers, payload.get("ocrJobId", ""))
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


def notify_analysis_completed(
    ocr_job_id: str,
    analyzed_count: int,
    auto_approved_count: int,
    problem_ids: list[str] | None = None,
) -> None:
    """Notify NestJS that AI analysis completed for a batch."""
    publish_sync("analysis:completed", {
        "ocrJobId": ocr_job_id,
        "analyzedCount": analyzed_count,
        "autoApprovedCount": auto_approved_count,
        "problemIds": problem_ids or [],
    })


def notify_analysis_failed(ocr_job_id: str, reason: str) -> None:
    """Notify NestJS that AI analysis failed."""
    publish_sync("analysis:failed", {
        "ocrJobId": ocr_job_id,
        "reason": reason,
    })
