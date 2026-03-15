"""Celery task: finalize textbook pipeline — update job status and notify NestJS."""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from sqlalchemy import select

from app.celery_app import celery
from app.database import worker_session
from app.models.job import JobStatus, OcrJobTracking
from app.models.ocr import OcrPage

logger = logging.getLogger(__name__)


@celery.task(
    bind=True,
    name="task.textbook.finalize",
    max_retries=3,
    default_retry_delay=10,
    acks_late=True,
)
def finalize_textbook(
    self,
    prev_result: dict | None = None,
    *,
    ocr_job_id: str | None = None,
) -> dict:
    """Mark textbook job as completed, build problem payloads, and notify NestJS."""
    if prev_result:
        ocr_job_id = ocr_job_id or prev_result.get("ocr_job_id")
    if not ocr_job_id:
        raise ValueError("ocr_job_id is required")

    segments = prev_result.get("segments", []) if prev_result else []

    return asyncio.run(_finalize(ocr_job_id, segments))


async def _finalize(ocr_job_id: str, segments: list[dict]) -> dict:
    # Idempotency: skip if job already completed
    book_title: str | None = None
    publisher: str | None = None

    async with worker_session() as session:
        job_result = await session.execute(
            select(OcrJobTracking).where(OcrJobTracking.id == ocr_job_id)
        )
        job = job_result.scalar_one()
        if job.status == JobStatus.completed:
            logger.info("Skipping finalize_textbook for job %s — already completed", ocr_job_id)
            return {"ocr_job_id": ocr_job_id, "problem_count": job.problem_count or 0, "skipped": True}
        job.status = JobStatus.completed
        job.problem_count = len(segments)
        job.completed_at = datetime.now(timezone.utc)
        book_title = job.book_title
        publisher = job.publisher
        await session.commit()

    # Build page_number -> image_s3_key mapping
    page_image_map: dict[int, str | None] = {}
    async with worker_session() as session:
        pages_result = await session.execute(
            select(OcrPage.page_number, OcrPage.image_s3_key).where(
                OcrPage.ocr_job_id == ocr_job_id
            )
        )
        for row in pages_result.all():
            page_image_map[row.page_number] = row.image_s3_key

    # Build problem payloads with textbook-specific fields
    merged_problems = []
    for segment in segments:
        start_page = segment.get("start_page", 0)
        end_page = segment.get("end_page", 0)
        problem_number = segment.get("problem_number")
        display_number = segment.get("display_number")
        problem_label = segment.get("problem_label")

        problem = {
            "problemNumber": problem_number,
            "displayNumber": display_number,
            "problemType": segment.get("problem_type", "short_answer"),
            "startPage": start_page,
            "endPage": end_page,
            "stemLatex": segment.get("stem_latex", ""),
            "stemText": segment.get("stem_text", ""),
            "pageImageS3Key": page_image_map.get(start_page),
            "problemImageS3Key": segment.get("problem_image_s3_key"),
            # Textbook-specific fields
            "documentType": "textbook",
            "bookSource": {
                "title": book_title,
                "publisher": publisher,
                "problemLabel": problem_label,
                "pageStart": start_page,
                "pageEnd": end_page,
                "chapter": segment.get("chapter"),
                "section": segment.get("section_label") or segment.get("section"),
                "sectionType": segment.get("section_type"),
                "problemCategory": segment.get("problem_category"),
                "itemCode": segment.get("item_code"),
                "difficultyLabel": segment.get("problem_category"),
                "inlineHint": segment.get("inline_hint"),
                "examHeader": segment.get("exam_source"),
            },
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

        sub_problems = segment.get("sub_problems")
        if sub_problems:
            problem["subProblems"] = sub_problems

        merged_problems.append(problem)

    # Notify NestJS
    from app.services.redis_events import notify_completed, notify_progress

    notify_progress(ocr_job_id, "ocr_complete", message="교재 OCR 완료")
    notify_completed(ocr_job_id, len(segments), merged_problems)

    logger.info(
        "Finalized textbook pipeline for job %s: %d problems",
        ocr_job_id,
        len(segments),
    )

    return {
        "ocr_job_id": ocr_job_id,
        "problem_count": len(segments),
    }
