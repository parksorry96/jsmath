"""Celery task: finalize OCR pipeline — update job status and notify NestJS."""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select

from app.celery_app import celery
from app.database import worker_session
from app.models.job import JobStatus, OcrJobTracking
from app.models.ocr import OcrPage

logger = logging.getLogger(__name__)


@celery.task(
    bind=True,
    name="task.pipeline.finalize",
    max_retries=3,
    default_retry_delay=10,
    acks_late=True,
)
def finalize_pipeline(
    self: Any,
    prev_result: dict[str, Any] | None = None,
    *,
    ocr_job_id: str | None = None,
    segments: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Mark job as completed, build problem payloads, and notify NestJS."""
    if prev_result:
        ocr_job_id = prev_result["ocr_job_id"]
        if segments is None:
            segments = prev_result.get("segments", [])
    if not ocr_job_id:
        raise ValueError("ocr_job_id is required")
    if segments is None:
        segments = []

    return asyncio.run(_finalize(ocr_job_id, segments))


async def _finalize(
    ocr_job_id: str,
    segments: list[dict[str, Any]],
) -> dict[str, Any]:
    # Idempotency: skip if job already completed
    async with worker_session() as session:
        job_result = await session.execute(
            select(OcrJobTracking).where(OcrJobTracking.id == ocr_job_id)
        )
        job = job_result.scalar_one()
        if job.status == JobStatus.completed:
            logger.info("Skipping finalize for job %s — already completed", ocr_job_id)
            return {"ocr_job_id": ocr_job_id, "problem_count": job.problem_count or 0, "skipped": True}
        job.status = JobStatus.completed
        job.problem_count = len(segments)
        job.completed_at = datetime.now(timezone.utc)
        await session.commit()

    # Build page_number → image_s3_key mapping
    page_image_map: dict[int, str | None] = {}
    async with worker_session() as session:
        pages_result = await session.execute(
            select(OcrPage.page_number, OcrPage.image_s3_key).where(
                OcrPage.ocr_job_id == ocr_job_id
            )
        )
        for row in pages_result.all():
            page_image_map[row.page_number] = row.image_s3_key

    # Build problem payloads (no AI classification)
    merged_problems = []
    for segment in segments:
        problem = {
            "problemNumber": segment.get("problem_number"),
            "displayNumber": segment.get("display_number"),
            "problemType": segment.get("problem_type", "short_answer"),
            "startPage": segment.get("start_page", 0),
            "endPage": segment.get("end_page", 0),
            "stemLatex": segment.get("stem_latex", ""),
            "stemText": segment.get("stem_text", ""),
            "bbox": segment.get("bbox"),
            "pageImageS3Key": page_image_map.get(segment.get("start_page", 0)),
            "problemImageS3Key": segment.get("problem_image_s3_key"),
            "subject": segment.get("subject"),
            "isCommon": segment.get("is_common"),
            "examSource": segment.get("exam_source"),
            "answerText": segment.get("answer_text"),
            "solutionLatex": segment.get("solution_latex"),
            "solutionText": segment.get("solution_text"),
            "answerMatchStatus": segment.get("answer_match_status"),
            "matchConfidence": segment.get("match_confidence"),
        }
        choices = segment.get("choices")
        if choices:
            problem["choices"] = [
                {
                    "position": c.get("position", i + 1),
                    "label": c.get("label", ""),
                    "contentLatex": c.get("content_latex", ""),
                    "contentText": c.get("content_text", ""),
                }
                for i, c in enumerate(choices)
            ]
        merged_problems.append(problem)

    # Notify NestJS
    from app.services.redis_events import notify_completed, notify_progress

    notify_progress(ocr_job_id, "ocr_complete", message="OCR 완료")
    notify_completed(ocr_job_id, len(segments), merged_problems)

    logger.info(
        "Finalized pipeline for job %s: %d problems",
        ocr_job_id,
        len(segments),
    )

    return {
        "ocr_job_id": ocr_job_id,
        "problem_count": len(segments),
    }
