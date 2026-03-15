"""FastAPI routes for OCR job management."""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.security import verify_internal_api_token
from app.database import get_db
from app.models.job import JobStatus, OcrJobTracking
from app.models.ocr import OcrLine, OcrPage
from app.models.checkpoint import PipelineCheckpoint
from app.schemas.ocr import (
    CheckpointResponse,
    OcrJobCreate,
    OcrJobResponse,
    OcrJobResultSummary,
    OcrPageSummary,
    ResumeRequest,
    ResumeResponse,
)
from app.services.checkpoint import get_checkpoints, get_last_checkpoint
from app.services.redis_events import notify_completed
from app.workers.pipeline import resume_pipeline, start_ocr_pipeline

router = APIRouter(
    prefix="/ocr",
    tags=["ocr"],
    dependencies=[Depends(verify_internal_api_token)],
)


@router.post("/jobs", status_code=201)
async def create_ocr_job(
    body: OcrJobCreate,
    db: AsyncSession = Depends(get_db),
) -> OcrJobResponse:
    """Create a new OCR job and start the pipeline.

    This is called by NestJS after PDF upload.
    """
    # Check for duplicate
    existing = await db.execute(
        select(OcrJobTracking).where(OcrJobTracking.id == body.ocr_job_id)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="OCR job already exists")

    tracking = OcrJobTracking(
        id=body.ocr_job_id,
        source_file_id=body.source_file_id,
        s3_key=body.s3_key,
        status=JobStatus.pending,
        document_type=body.document_type,
        book_title=body.book_title,
        publisher=body.publisher,
    )
    db.add(tracking)
    await db.commit()
    await db.refresh(tracking)

    # Celery submission is sync; offload it from the event loop.
    loop = asyncio.get_running_loop()
    await loop.run_in_executor(None, start_ocr_pipeline, body.ocr_job_id, body.document_type)

    return OcrJobResponse.model_validate(tracking)


@router.get("/jobs/{job_id}")
async def get_ocr_job(
    job_id: str,
    db: AsyncSession = Depends(get_db),
) -> OcrJobResponse:
    """Get OCR job status."""
    result = await db.execute(
        select(OcrJobTracking).where(OcrJobTracking.id == job_id)
    )
    job = result.scalar_one_or_none()
    if job is None:
        raise HTTPException(status_code=404, detail="OCR job not found")
    return OcrJobResponse.model_validate(job)


@router.get("/jobs/{job_id}/results")
async def get_ocr_job_results(
    job_id: str,
    db: AsyncSession = Depends(get_db),
) -> OcrJobResultSummary:
    """Get detailed OCR results for a completed job."""
    result = await db.execute(
        select(OcrJobTracking).where(OcrJobTracking.id == job_id)
    )
    job = result.scalar_one_or_none()
    if job is None:
        raise HTTPException(status_code=404, detail="OCR job not found")

    # Fetch pages with line counts
    pages_result = await db.execute(
        select(
            OcrPage.page_number,
            OcrPage.ocr_confidence,
            func.count(OcrLine.id).label("line_count"),
        )
        .outerjoin(OcrLine, OcrLine.page_id == OcrPage.id)
        .where(OcrPage.ocr_job_id == job_id)
        .group_by(OcrPage.id)
        .order_by(OcrPage.page_number)
    )
    pages = pages_result.all()

    total_lines = sum(p.line_count for p in pages)
    page_summaries = [
        OcrPageSummary(
            page_number=p.page_number,
            line_count=p.line_count,
            ocr_confidence=p.ocr_confidence,
        )
        for p in pages
    ]

    return OcrJobResultSummary(
        ocr_job_id=job_id,
        num_pages=len(pages),
        total_lines=total_lines,
        problem_count=job.problem_count or 0,
        pages=page_summaries,
    )


@router.post("/jobs/{job_id}/resync")
async def resync_ocr_job(
    job_id: str,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Re-run segment+classify+notify for a completed job.

    Use this when NestJS missed the ocr:completed event and has no Problem
    records for a job that FastAPI already completed.
    """
    result = await db.execute(
        select(OcrJobTracking).where(OcrJobTracking.id == job_id)
    )
    job = result.scalar_one_or_none()
    if job is None:
        raise HTTPException(status_code=404, detail="OCR job not found")
    if job.status != JobStatus.completed:
        raise HTTPException(
            status_code=400,
            detail=f"Job is not completed (status={job.status.value}). Re-run pipeline instead.",
        )

    # Inline async segment + notify (avoid Celery asyncio.run conflict)
    from sqlalchemy.orm import selectinload
    from app.workers.segment_problems import _rule_based_segment

    # 1. Fetch pages with lines
    pages_result = await db.execute(
        select(OcrPage)
        .where(OcrPage.ocr_job_id == job_id)
        .options(selectinload(OcrPage.lines))
        .order_by(OcrPage.page_number)
    )
    pages = pages_result.scalars().all()

    # Build page_number → image_s3_key mapping
    page_image_map: dict[int, str | None] = {
        p.page_number: p.image_s3_key for p in pages
    }

    # 2. Segment
    segments = _rule_based_segment(pages)
    seg_dicts = [s.model_dump() for s in segments]

    # 3. Build problem payloads (no AI classification)
    merged_problems = []
    for seg_dict in seg_dicts:
        problem = {
            "problemNumber": seg_dict.get("problem_number"),
            "displayNumber": seg_dict.get("display_number"),
            "problemType": seg_dict.get("problem_type", "short_answer"),
            "startPage": seg_dict.get("start_page", 0),
            "endPage": seg_dict.get("end_page", 0),
            "stemLatex": seg_dict.get("stem_latex", ""),
            "stemText": seg_dict.get("stem_text", ""),
            "pageImageS3Key": page_image_map.get(seg_dict.get("start_page", 0)),
            "problemImageS3Key": seg_dict.get("problem_image_s3_key"),
        }
        choices = seg_dict.get("choices")
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

    # 4. Re-publish to NestJS
    notify_completed(job_id, len(merged_problems), merged_problems)

    return {
        "ocr_job_id": job_id,
        "resynced_problems": len(merged_problems),
    }


@router.get("/jobs/{job_id}/checkpoints")
async def get_job_checkpoints(
    job_id: str,
    db: AsyncSession = Depends(get_db),
) -> list[CheckpointResponse]:
    """Return checkpoint history for an OCR job."""
    # Verify job exists
    result = await db.execute(
        select(OcrJobTracking).where(OcrJobTracking.id == job_id)
    )
    if result.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="OCR job not found")

    checkpoints = await get_checkpoints(db, job_id)
    return [CheckpointResponse.model_validate(cp) for cp in checkpoints]


@router.post("/jobs/{job_id}/resume")
async def resume_ocr_job(
    job_id: str,
    body: ResumeRequest | None = None,
    db: AsyncSession = Depends(get_db),
) -> ResumeResponse:
    """Resume a failed pipeline from the last completed checkpoint."""
    result = await db.execute(
        select(OcrJobTracking).where(OcrJobTracking.id == job_id)
    )
    job = result.scalar_one_or_none()
    if job is None:
        raise HTTPException(status_code=404, detail="OCR job not found")

    doc_type = (body.document_type if body else None) or job.document_type
    answer_key = body.answer_s3_key if body else None

    # Determine resume point for response
    last_cp = await get_last_checkpoint(db, job_id, doc_type)
    resumed_from = last_cp.stage_name if last_cp else "(start)"

    # Reset job status for re-processing
    job.status = JobStatus.processing
    job.error_message = None
    await db.commit()

    loop = asyncio.get_running_loop()
    try:
        task_id = await loop.run_in_executor(
            None, resume_pipeline, job_id, doc_type, answer_key
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    return ResumeResponse(
        ocr_job_id=job_id,
        resumed_from=resumed_from,
        task_id=task_id,
    )
