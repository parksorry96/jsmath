"""Redis event listeners for incoming events from NestJS.

Two listeners run in parallel:
  1. Pub/Sub listener (legacy) — kept during migration
  2. Stream listener (durable) — uses XREADGROUP with consumer groups

Streams that OCR-API consumes:
  - stream:ocr:submit
  - stream:analysis:request
  - stream:photo:analyze
  - stream:photo:rubric
"""

from __future__ import annotations

import asyncio
import json
import logging
import socket

import redis.asyncio as aioredis
from sqlalchemy import select

from app.config import settings
from app.database import async_session
from app.models.job import JobStatus, OcrJobTracking

logger = logging.getLogger(__name__)
RECONNECT_DELAY_SEC = 5

# Consumer group for the OCR-API service
_CONSUMER_GROUP = "ocr-api"
_CONSUMER_NAME = f"ocr-api-{socket.gethostname()}"

# Streams this service consumes (NestJS → FastAPI direction)
_INBOUND_STREAMS = [
    "stream:ocr:submit",
    "stream:analysis:request",
    "stream:photo:analyze",
    "stream:photo:rubric",
]

# Stream name → handler channel key (reuse existing handlers)
_STREAM_TO_CHANNEL: dict[str, str] = {
    "stream:ocr:submit": "ocr:submit",
    "stream:analysis:request": "analysis:request",
    "stream:photo:analyze": "photo:analyze",
    "stream:photo:rubric": "photo:rubric",
}


async def listen_for_events() -> None:
    """Subscribe to Redis Pub/Sub and process incoming OCR events (legacy)."""
    while True:
        r = aioredis.from_url(settings.redis_url, decode_responses=True)
        pubsub = r.pubsub()
        try:
            await pubsub.subscribe("ocr:submit", "analysis:request", "photo:analyze", "photo:rubric")
            logger.info("Listening for ocr:submit, analysis:request, photo:analyze, photo:rubric events on Redis")

            async for message in pubsub.listen():
                if message["type"] != "message":
                    continue
                channel = message["channel"]
                try:
                    if channel == "ocr:submit":
                        await _handle_submit(message["data"])
                    elif channel == "analysis:request":
                        await _handle_analysis_request(json.loads(message["data"]))
                    elif channel == "photo:analyze":
                        await _handle_photo_analyze(json.loads(message["data"]))
                    elif channel == "photo:rubric":
                        await _handle_photo_rubric(json.loads(message["data"]))
                except Exception:
                    logger.exception("Error handling %s event", channel)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception(
                "Redis event listener crashed; reconnecting in %s seconds",
                RECONNECT_DELAY_SEC,
            )
            await asyncio.sleep(RECONNECT_DELAY_SEC)
        finally:
            try:
                await pubsub.unsubscribe("ocr:submit", "analysis:request", "photo:analyze", "photo:rubric")
            except Exception:
                logger.debug("Redis unsubscribe failed during shutdown", exc_info=True)
            await r.aclose()


async def listen_for_events_stream() -> None:
    """Consume events from Redis Streams using XREADGROUP (durable)."""
    while True:
        r = aioredis.from_url(settings.redis_url, decode_responses=True)
        try:
            # Ensure consumer groups exist (MKSTREAM creates the stream if absent)
            for stream in _INBOUND_STREAMS:
                try:
                    await r.xgroup_create(stream, _CONSUMER_GROUP, id="0", mkstream=True)
                    logger.info("Created consumer group %s on %s", _CONSUMER_GROUP, stream)
                except aioredis.ResponseError as e:
                    if "BUSYGROUP" not in str(e):
                        raise

            logger.info(
                "Stream listener started (group=%s, consumer=%s, streams=%s)",
                _CONSUMER_GROUP, _CONSUMER_NAME, _INBOUND_STREAMS,
            )

            # Read loop
            streams_arg = {s: ">" for s in _INBOUND_STREAMS}
            while True:
                entries = await r.xreadgroup(
                    groupname=_CONSUMER_GROUP,
                    consumername=_CONSUMER_NAME,
                    streams=streams_arg,
                    count=10,
                    block=5000,
                )
                if not entries:
                    continue

                for stream_name, messages in entries:
                    channel = _STREAM_TO_CHANNEL.get(stream_name, stream_name)
                    for msg_id, fields in messages:
                        raw_data = fields.get("data", "{}")
                        try:
                            await _dispatch_stream_event(channel, raw_data)
                            await r.xack(stream_name, _CONSUMER_GROUP, msg_id)
                        except Exception:
                            logger.exception(
                                "Error processing stream %s msg %s", stream_name, msg_id,
                            )

        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception(
                "Stream listener crashed; reconnecting in %s seconds",
                RECONNECT_DELAY_SEC,
            )
            await asyncio.sleep(RECONNECT_DELAY_SEC)
        finally:
            await r.aclose()


async def _dispatch_stream_event(channel: str, raw_data: str) -> None:
    """Route a stream event to the appropriate handler."""
    if channel == "ocr:submit":
        await _handle_submit(raw_data)
    elif channel == "analysis:request":
        await _handle_analysis_request(json.loads(raw_data))
    elif channel == "photo:analyze":
        await _handle_photo_analyze(json.loads(raw_data))
    elif channel == "photo:rubric":
        await _handle_photo_rubric(json.loads(raw_data))


async def _handle_submit(raw: str) -> None:
    """Handle an ocr:submit event from NestJS.

    Expected payload: {"fileId": "...", "s3Key": "...", "answerS3Key": "...",
                       "ocrJobId": "...", "documentType": "exam"|"textbook",
                       "bookTitle": "...", "publisher": "..."}
    """
    payload = json.loads(raw)
    ocr_job_id = payload.get("jobId") or payload.get("ocrJobId")
    source_file_id = payload.get("sourceFileId") or payload.get("fileId")
    s3_key = payload.get("s3Key")
    answer_s3_key = payload.get("answerS3Key")
    document_type = payload.get("documentType", "exam")
    book_title = payload.get("bookTitle")
    publisher = payload.get("publisher")

    if not ocr_job_id or not source_file_id or not s3_key:
        logger.warning("Ignoring malformed ocr:submit payload (keys=%s)", list(payload.keys()))
        return

    logger.info("Received ocr:submit for job %s (file=%s, type=%s)", ocr_job_id, source_file_id, document_type)

    # Create tracking record in OCR schema
    async with async_session() as session:
        existing = await session.execute(
            select(OcrJobTracking.id).where(OcrJobTracking.id == ocr_job_id)
        )
        if existing.scalar_one_or_none():
            logger.info("Ignoring duplicate ocr:submit for job %s", ocr_job_id)
            return

        tracking = OcrJobTracking(
            id=ocr_job_id,
            source_file_id=source_file_id,
            s3_key=s3_key,
            status=JobStatus.pending,
            document_type=document_type,
            book_title=book_title,
            publisher=publisher,
        )
        session.add(tracking)
        try:
            await session.commit()
        except Exception:
            await session.rollback()
            logger.info("Ignoring duplicate ocr:submit for job %s (race)", ocr_job_id)
            return

    # Start the Celery pipeline — offload to thread to avoid blocking event loop
    from app.workers.pipeline import start_ocr_pipeline

    loop = asyncio.get_running_loop()
    await loop.run_in_executor(
        None,
        start_ocr_pipeline,
        ocr_job_id,
        document_type,
        answer_s3_key,
    )


async def _handle_analysis_request(data: dict) -> None:
    """Handle analysis:request event from NestJS.

    Celery's apply_async() is a synchronous call that must not block the
    async event loop.  We offload it to a thread via run_in_executor.
    """
    ocr_job_id = data.get("ocrJobId")
    problem_ids = data.get("problemIds", [])
    if not ocr_job_id:
        logger.warning("analysis:request missing ocrJobId")
        return
    logger.info("Received analysis:request for job %s (%d problems)", ocr_job_id, len(problem_ids))

    from app.workers.analysis_pipeline import start_analysis_pipeline

    loop = asyncio.get_running_loop()
    await loop.run_in_executor(None, start_analysis_pipeline, ocr_job_id, problem_ids)


async def _handle_photo_analyze(data: dict) -> None:
    """Handle photo:analyze event from NestJS.

    Expected payload: {
        submissionPhotoId, s3Key, problems
    }
    """
    photo_id = data.get("submissionPhotoId")
    if not photo_id:
        logger.warning("photo:analyze missing submissionPhotoId")
        return
    logger.info("Received photo:analyze for %s", photo_id)

    from app.workers.analyze_photo import analyze_submission_photo

    loop = asyncio.get_running_loop()
    await loop.run_in_executor(None, analyze_submission_photo.delay, data)


async def _handle_photo_rubric(data: dict) -> None:
    """Handle photo:rubric event from NestJS (explicit rubric grading request).

    Expected payload: {
        submissionPhotoId, submissionAnswerId, s3Key, problem
    }
    """
    photo_id = data.get("submissionPhotoId")
    if not photo_id:
        logger.warning("photo:rubric missing submissionPhotoId")
        return
    logger.info("Received photo:rubric for %s", photo_id)

    from app.workers.rubric_grader import rubric_grade_photo

    loop = asyncio.get_running_loop()
    await loop.run_in_executor(None, rubric_grade_photo.delay, data)
