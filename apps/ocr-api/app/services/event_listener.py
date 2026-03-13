"""Redis Pub/Sub listener for incoming events from NestJS.

Listens on `ocr:submit` and `analysis:request` channels.
Runs as an asyncio background task inside the FastAPI process.
"""

from __future__ import annotations

import asyncio
import json
import logging

import redis.asyncio as aioredis
from sqlalchemy import select

from app.config import settings
from app.database import async_session
from app.models.job import JobStatus, OcrJobTracking

logger = logging.getLogger(__name__)
RECONNECT_DELAY_SEC = 5


async def listen_for_events() -> None:
    """Subscribe to Redis and process incoming OCR events."""
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
        logger.warning("Ignoring malformed ocr:submit payload: %s", payload)
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
        await session.commit()

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
