"""Redis Pub/Sub listener for incoming events from NestJS.

Listens on `ocr:submit` and `analysis:request` channels.
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
    await pubsub.subscribe("ocr:submit", "analysis:request")
    logger.info("Listening for ocr:submit and analysis:request events on Redis")

    try:
        async for message in pubsub.listen():
            if message["type"] != "message":
                continue
            channel = message["channel"]
            try:
                if channel == "ocr:submit":
                    await _handle_submit(message["data"])
                elif channel == "analysis:request":
                    _handle_analysis_request(json.loads(message["data"]))
            except Exception:
                logger.exception("Error handling %s event", channel)
    finally:
        await pubsub.unsubscribe("ocr:submit", "analysis:request")
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


def _handle_analysis_request(data: dict) -> None:
    """Handle analysis:request event from NestJS."""
    ocr_job_id = data.get("ocrJobId")
    problem_ids = data.get("problemIds", [])
    if not ocr_job_id:
        logger.warning("analysis:request missing ocrJobId")
        return
    logger.info("Received analysis:request for job %s (%d problems)", ocr_job_id, len(problem_ids))

    from app.workers.analysis_pipeline import start_analysis_pipeline
    start_analysis_pipeline(ocr_job_id, problem_ids)
