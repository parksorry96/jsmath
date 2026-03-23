"""Redis Pub/Sub + Streams event publisher.

Pub/Sub channels (legacy, kept during migration):
  - ocr:submit, ocr:completed, ocr:failed, review:needed
  - analysis:request, analysis:completed, analysis:failed
  - pipeline:progress
  - photo:analyze, photo:analysis:completed, photo:analysis:failed
  - photo:rubric, photo:rubric:completed, photo:rubric:failed

Redis Streams (durable, consumer-group based):
  - stream:ocr:submit, stream:ocr:completed, stream:ocr:failed
  - stream:analysis:request, stream:analysis:completed, stream:analysis:failed
  - stream:photo:analyze, stream:photo:analysis:completed, stream:photo:analysis:failed
  - stream:photo:rubric, stream:photo:rubric:completed, stream:photo:rubric:failed
"""

from __future__ import annotations

import json
import logging
from typing import Any

import redis

from app.config import settings

logger = logging.getLogger(__name__)

# Mapping from Pub/Sub channel to Redis Stream name for dual-publish
_CHANNEL_TO_STREAM: dict[str, str] = {
    "ocr:submit": "stream:ocr:submit",
    "ocr:completed": "stream:ocr:completed",
    "ocr:failed": "stream:ocr:failed",
    "analysis:request": "stream:analysis:request",
    "analysis:completed": "stream:analysis:completed",
    "analysis:failed": "stream:analysis:failed",
    "photo:analyze": "stream:photo:analyze",
    "photo:analysis:completed": "stream:photo:analysis:completed",
    "photo:analysis:failed": "stream:photo:analysis:failed",
    "photo:rubric": "stream:photo:rubric",
    "photo:rubric:completed": "stream:photo:rubric:completed",
    "photo:rubric:failed": "stream:photo:rubric:failed",
}

# Max stream length — old entries trimmed automatically
_STREAM_MAXLEN = 10_000


def publish_sync(channel: str, payload: dict[str, Any]) -> None:
    """Publish a JSON event to a Redis Pub/Sub channel (sync, safe for Celery workers)."""
    r = redis.from_url(settings.redis_url, decode_responses=True)
    try:
        data = json.dumps(payload)
        receivers = r.publish(channel, data)
        if receivers == 0:
            logger.warning("No subscribers listening on %s", channel)
        else:
            logger.info("Published to %s (%d receivers): %s", channel, receivers, payload.get("ocrJobId", ""))
    finally:
        r.close()


def publish_stream(stream: str, payload: dict[str, Any]) -> str:
    """Append a JSON event to a Redis Stream. Returns the stream entry ID."""
    r = redis.from_url(settings.redis_url, decode_responses=True)
    try:
        data = json.dumps(payload)
        entry_id: str = r.xadd(stream, {"data": data}, maxlen=_STREAM_MAXLEN, approximate=True)
        logger.info("Published to stream %s (id=%s): %s", stream, entry_id, payload.get("ocrJobId", ""))
        return entry_id
    finally:
        r.close()


def publish_dual(channel: str, payload: dict[str, Any]) -> None:
    """Publish to both Pub/Sub and the corresponding Redis Stream.

    Used during migration so both old (Pub/Sub) and new (Stream) consumers
    receive the event. Once all consumers are migrated to Streams, callers
    can switch to publish_stream() only.
    """
    stream = _CHANNEL_TO_STREAM.get(channel)
    if stream:
        publish_stream(stream, payload)
    publish_sync(channel, payload)


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
    publish_dual("ocr:completed", payload)


def notify_failed(ocr_job_id: str, reason: str, retryable: bool = False) -> None:
    """Notify NestJS that OCR pipeline failed."""
    publish_dual("ocr:failed", {
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
    publish_dual("analysis:completed", {
        "ocrJobId": ocr_job_id,
        "analyzedCount": analyzed_count,
        "autoApprovedCount": auto_approved_count,
        "problemIds": problem_ids or [],
    })


def notify_analysis_failed(
    ocr_job_id: str,
    reason: str,
    problem_ids: list[str] | None = None,
) -> None:
    """Notify NestJS that AI analysis failed."""
    publish_dual("analysis:failed", {
        "ocrJobId": ocr_job_id,
        "reason": reason,
        "problemIds": problem_ids or [],
    })


def notify_progress(
    ocr_job_id: str,
    stage: str,
    current: int = 0,
    total: int = 0,
    message: str = "",
) -> None:
    """Publish pipeline progress for real-time SSE updates (Pub/Sub only)."""
    publish_sync("pipeline:progress", {
        "ocrJobId": ocr_job_id,
        "stage": stage,
        "current": current,
        "total": total,
        "message": message,
    })
