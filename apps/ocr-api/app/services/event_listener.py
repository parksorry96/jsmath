"""Redis Pub/Sub listener for incoming events from NestJS.

Listens on `ocr:submit` channel and starts the OCR pipeline.
Runs as an asyncio background task inside the FastAPI process.
"""

from __future__ import annotations

import asyncio
import json
import logging

import redis.asyncio as aioredis

from app.config import settings
from app.database import async_session
from app.models.job import JobStatus, OcrJobTracking

logger = logging.getLogger(__name__)


async def listen_for_events() -> None:
    """Subscribe to Redis and process incoming OCR events."""
    r = aioredis.from_url(settings.redis_url, decode_responses=True)
    pubsub = r.pubsub()
    await pubsub.subscribe("ocr:submit")
    logger.info("Listening for ocr:submit events on Redis")

    try:
        async for message in pubsub.listen():
            if message["type"] != "message":
                continue
            try:
                await _handle_submit(message["data"])
            except Exception:
                logger.exception("Error handling ocr:submit event")
    finally:
        await pubsub.unsubscribe("ocr:submit")
        await r.aclose()


async def _handle_submit(raw: str) -> None:
    """Handle an ocr:submit event from NestJS.

    Expected payload: {"fileId": "...", "s3Key": "...", "ocrJobId": "..."}
    """
    payload = json.loads(raw)
    ocr_job_id = payload.get("jobId") or payload.get("ocrJobId")
    source_file_id = payload.get("sourceFileId") or payload.get("fileId")
    s3_key = payload["s3Key"]

    logger.info("Received ocr:submit for job %s (file=%s)", ocr_job_id, source_file_id)

    # Create tracking record in OCR schema
    async with async_session() as session:
        tracking = OcrJobTracking(
            id=ocr_job_id,
            source_file_id=source_file_id,
            s3_key=s3_key,
            status=JobStatus.pending,
        )
        session.add(tracking)
        await session.commit()

    # Start the Celery pipeline
    from app.workers.pipeline import start_ocr_pipeline

    start_ocr_pipeline(ocr_job_id)
