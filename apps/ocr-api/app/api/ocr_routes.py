"""FastAPI routes for OCR job management."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.job import JobStatus, OcrJobTracking
from app.models.ocr import OcrLine, OcrPage
from app.schemas.ocr import OcrJobCreate, OcrJobResponse, OcrJobResultSummary, OcrPageSummary
from app.services.redis_events import notify_completed
from app.workers.pipeline import start_ocr_pipeline

router = APIRouter(prefix="/ocr", tags=["ocr"])


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
    )
    db.add(tracking)
    await db.commit()
    await db.refresh(tracking)

    # Start the pipeline
    start_ocr_pipeline(body.ocr_job_id)

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
