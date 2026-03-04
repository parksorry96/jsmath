"""Celery task: submit PDF to Mathpix and store the pdf_id."""

from __future__ import annotations

import asyncio
import logging

from celery import Task
from sqlalchemy import select

from app.celery_app import celery
from app.database import worker_session
from app.models.job import JobStatus, OcrJobTracking
from app.services import mathpix, s3

logger = logging.getLogger(__name__)

MAX_RETRIES = 3
RETRY_BACKOFF = 5  # seconds, exponential


@celery.task(
    bind=True,
    name="task.ocr.submit",
    max_retries=MAX_RETRIES,
    default_retry_delay=RETRY_BACKOFF,
    retry_backoff=True,
    retry_backoff_max=60,
    acks_late=True,
)
def submit_pdf_to_mathpix(self: Task, ocr_job_id: str) -> dict[str, str]:
    """Submit a PDF to Mathpix OCR API.

    1. Fetch job tracking record to get s3_key.
    2. Generate presigned URL for the PDF.
    3. Call Mathpix POST /v3/pdf.
    4. Store mathpix_pdf_id and update status.
    5. Return data for the next task in the chain (ocr_poll).
    """
    return asyncio.run(_submit(self, ocr_job_id))


async def _submit(task: Task, ocr_job_id: str) -> dict[str, str]:
    async with worker_session() as session:
        result = await session.execute(
            select(OcrJobTracking).where(OcrJobTracking.id == ocr_job_id)
        )
        job = result.scalar_one_or_none()
        if job is None:
            raise ValueError(f"OcrJobTracking not found: {ocr_job_id}")

        # Update status to submitting
        job.status = JobStatus.submitting
        await session.commit()

        try:
            presigned_url = s3.generate_presigned_url(job.s3_key, expires_in=3600)
            pdf_id = await mathpix.submit_pdf(presigned_url)

            job.mathpix_pdf_id = pdf_id
            job.status = JobStatus.processing
            await session.commit()

            logger.info(
                "OCR job %s submitted to Mathpix: pdf_id=%s",
                ocr_job_id,
                pdf_id,
            )
            return {"ocr_job_id": ocr_job_id, "mathpix_pdf_id": pdf_id}

        except Exception as exc:
            job.retry_count += 1
            if job.retry_count >= MAX_RETRIES:
                job.status = JobStatus.failed
                job.error_message = str(exc)
                await session.commit()
                logger.error("OCR submit permanently failed for %s: %s", ocr_job_id, exc)
                # Notify NestJS
                from app.services.redis_events import notify_failed

                notify_failed(ocr_job_id, str(exc), retryable=False)
                raise
            await session.commit()
            logger.warning(
                "OCR submit retry %d/%d for %s: %s",
                job.retry_count,
                MAX_RETRIES,
                ocr_job_id,
                exc,
            )
            raise task.retry(exc=exc)
