"""Celery task: poll Mathpix for PDF processing status and fetch results."""

from __future__ import annotations

import asyncio
import logging

from celery import Task
from sqlalchemy import select

from app.celery_app import celery
from app.database import worker_session
from app.models.job import JobStatus, OcrJobTracking
from app.services import mathpix

logger = logging.getLogger(__name__)

# Polling strategy (from agent instructions):
# 0-5 min: 30s intervals, 5-15 min: 60s, 15+ min: 120s, >30 min: give up
MAX_POLL_ATTEMPTS = 60
POLL_INTERVALS = {
    10: 30,   # first 10 attempts (0~5min at 30s each)
    20: 60,   # next 10 attempts (5~15min at 60s each)
    60: 120,  # remaining (15~30min at 120s each)
}


def _get_poll_delay(attempt: int) -> int:
    """Return the delay in seconds for the given poll attempt number."""
    for threshold, delay in sorted(POLL_INTERVALS.items()):
        if attempt < threshold:
            return delay
    return 120


@celery.task(
    bind=True,
    name="task.ocr.poll",
    max_retries=MAX_POLL_ATTEMPTS,
    acks_late=True,
)
def poll_mathpix_status(
    self: Task,
    submit_result: dict[str, str] | None = None,
    *,
    ocr_job_id: str | None = None,
    mathpix_pdf_id: str | None = None,
) -> dict[str, str]:
    """Poll Mathpix until PDF processing is complete, then fetch results.

    Can be called as part of a chain (receives submit_result) or directly.
    """
    # Support both chain input and direct kwargs
    if submit_result:
        ocr_job_id = submit_result["ocr_job_id"]
        mathpix_pdf_id = submit_result["mathpix_pdf_id"]

    if not ocr_job_id or not mathpix_pdf_id:
        raise ValueError("ocr_job_id and mathpix_pdf_id are required")

    return asyncio.run(_poll(self, ocr_job_id, mathpix_pdf_id))


async def _poll(task: Task, ocr_job_id: str, mathpix_pdf_id: str) -> dict[str, str]:
    attempt = task.request.retries or 0
    status_data = await mathpix.get_status(mathpix_pdf_id)
    mathpix_status = status_data.get("status", "unknown")

    logger.info(
        "Mathpix poll %s attempt=%d status=%s percent=%.1f%%",
        mathpix_pdf_id,
        attempt,
        mathpix_status,
        status_data.get("percent_done", 0),
    )

    # Update progress in DB
    async with worker_session() as session:
        result = await session.execute(
            select(OcrJobTracking).where(OcrJobTracking.id == ocr_job_id)
        )
        job = result.scalar_one_or_none()
        if job is None:
            raise ValueError(f"OcrJobTracking not found: {ocr_job_id}")

        job.num_pages = status_data.get("num_pages")
        job.pages_completed = status_data.get("num_pages_completed")
        job.percent_done = status_data.get("percent_done")

        if mathpix_status == "completed":
            await session.commit()

            num_pages = status_data.get("num_pages", 0)
            from app.services.redis_events import notify_progress

            notify_progress(ocr_job_id, "ocr_processing", current=num_pages, total=num_pages, message="OCR 처리 완료")

            logger.info("Mathpix completed for %s, %d pages", ocr_job_id, num_pages)
            return {
                "ocr_job_id": ocr_job_id,
                "mathpix_pdf_id": mathpix_pdf_id,
                "num_pages": num_pages,
            }

        if mathpix_status == "error":
            error_detail = status_data.get("error", status_data)
            logger.error("Mathpix error for %s: %s", mathpix_pdf_id, error_detail)
            job.status = JobStatus.failed
            job.error_message = f"Mathpix error: {error_detail}"
            await session.commit()

            from app.services.redis_events import notify_failed

            notify_failed(ocr_job_id, job.error_message, retryable=False)
            raise RuntimeError(f"Mathpix processing error for {mathpix_pdf_id}: {error_detail}")

        # Still processing -- schedule next poll
        await session.commit()

        if attempt >= MAX_POLL_ATTEMPTS:
            # Exceeded 30 min timeout
            async with worker_session() as s2:
                res = await s2.execute(
                    select(OcrJobTracking).where(OcrJobTracking.id == ocr_job_id)
                )
                j = res.scalar_one()
                j.status = JobStatus.failed
                j.error_message = "Mathpix processing timeout (>30 min)"
                await s2.commit()

            from app.services.redis_events import notify_failed

            notify_failed(ocr_job_id, "Mathpix processing timeout", retryable=True)
            raise RuntimeError(f"Mathpix timeout for {mathpix_pdf_id}")

        delay = _get_poll_delay(attempt)
        raise task.retry(countdown=delay)
