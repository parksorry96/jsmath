"""Pipeline orchestration — chains Celery tasks into the full OCR workflow."""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from celery import chain

from app.celery_app import celery
from app.database import worker_session
from app.services.checkpoint import (
    fail_checkpoint,
    get_last_checkpoint,
    get_stage_order,
    save_checkpoint,
)
from app.workers.finalize import finalize_pipeline
from app.workers.ocr_poll import poll_mathpix_status
from app.workers.ocr_submit import submit_pdf_to_mathpix
from app.workers.parse_results import parse_mathpix_results
from app.workers.segment_problems import segment_problems

logger = logging.getLogger(__name__)


# ── Checkpoint Celery tasks ──


@celery.task(name="task.pipeline.checkpoint_save")
def checkpoint_save(
    prev_result: dict[str, Any] | None,
    stage_name: str | None = None,
) -> dict[str, Any] | None:
    """Save a completed checkpoint with stage output, then pass through."""
    if prev_result and stage_name:
        ocr_job_id = prev_result.get("ocr_job_id")
        if ocr_job_id:
            asyncio.run(_save(ocr_job_id, stage_name, prev_result))
    return prev_result


@celery.task(bind=True, name="task.pipeline.checkpoint_fail")
def checkpoint_fail(
    self: Any,
    task_id: str,
    ocr_job_id: str | None = None,
    document_type: str = "exam",
) -> None:
    """Chain error callback — mark the next unfinished stage as failed."""
    if ocr_job_id:
        asyncio.run(_fail(ocr_job_id, document_type, f"Task {task_id} failed"))


async def _save(ocr_job_id: str, stage_name: str, payload: dict[str, Any]) -> None:
    async with worker_session() as session:
        await save_checkpoint(session, ocr_job_id, stage_name, payload=payload)


async def _fail(ocr_job_id: str, document_type: str, error: str) -> None:
    async with worker_session() as session:
        last = await get_last_checkpoint(session, ocr_job_id, document_type)
        stages = get_stage_order(document_type)
        if last and last.stage_name in stages:
            idx = stages.index(last.stage_name)
            failed_stage = stages[idx + 1] if idx + 1 < len(stages) else stages[-1]
        else:
            failed_stage = stages[0]
        await fail_checkpoint(session, ocr_job_id, failed_stage, error)


# ── Stage → task mapping ──


def _stage_signature(
    stage_name: str,
    ocr_job_id: str,
    answer_s3_key: str | None = None,
) -> Any:
    """Return the Celery task signature for a given stage."""
    if stage_name == "ocr_submit":
        return submit_pdf_to_mathpix.s(ocr_job_id)
    if stage_name == "ocr_poll":
        return poll_mathpix_status.s()
    if stage_name == "parse_results":
        return parse_mathpix_results.s()
    if stage_name == "segment_problems":
        return segment_problems.s()
    if stage_name == "finalize":
        return finalize_pipeline.s()

    # Textbook-specific stages (lazy import)
    if stage_name == "detect_sections":
        from app.workers.detect_sections import detect_sections
        return detect_sections.s()
    if stage_name == "segment_textbook":
        from app.workers.segment_textbook import segment_textbook
        return segment_textbook.s()
    if stage_name == "match_answers":
        from app.workers.match_answers import match_answers
        return match_answers.s(answer_s3_key=answer_s3_key)
    if stage_name == "finalize_textbook":
        from app.workers.finalize_textbook import finalize_textbook
        return finalize_textbook.s()

    raise ValueError(f"Unknown stage: {stage_name}")


def _build_chain(
    stages: list[str],
    ocr_job_id: str,
    answer_s3_key: str | None = None,
) -> list[Any]:
    """Build a Celery task list with checkpoint_save after each stage."""
    tasks = []
    for stage in stages:
        tasks.append(_stage_signature(stage, ocr_job_id, answer_s3_key))
        tasks.append(checkpoint_save.s(stage_name=stage))
    return tasks


# ── Public API ──


def start_ocr_pipeline(
    ocr_job_id: str,
    document_type: str = "exam",
    answer_s3_key: str | None = None,
) -> str:
    """Kick off the full OCR pipeline as a Celery chain.

    For exam: submit -> poll -> parse -> segment -> finalize
    For textbook: submit -> poll -> parse -> detect_sections -> segment_textbook -> match_answers -> finalize_textbook

    Returns the Celery task ID.
    """
    stages = get_stage_order(document_type)
    tasks = _build_chain(stages, ocr_job_id, answer_s3_key)

    workflow = chain(*tasks)
    result = workflow.apply_async(
        link_error=[
            checkpoint_fail.s(ocr_job_id=ocr_job_id, document_type=document_type),
        ],
    )
    logger.info(
        "OCR pipeline (%s) started for job %s: task_id=%s",
        document_type, ocr_job_id, result.id,
    )
    return result.id


def resume_pipeline(
    ocr_job_id: str,
    document_type: str = "exam",
    answer_s3_key: str | None = None,
) -> str:
    """Resume a failed/stopped pipeline from the last completed checkpoint.

    Returns the Celery task ID, or raises ValueError if nothing to resume.
    """
    last_cp, stages = asyncio.run(_get_resume_point(ocr_job_id, document_type))

    if last_cp is None:
        logger.info("No checkpoints for job %s — restarting full pipeline", ocr_job_id)
        return start_ocr_pipeline(ocr_job_id, document_type, answer_s3_key)

    last_idx = stages.index(last_cp.stage_name)
    remaining = stages[last_idx + 1:]

    if not remaining:
        raise ValueError(f"Pipeline for job {ocr_job_id} already completed all stages")

    # Build chain from the remaining stages
    tasks = _build_chain(remaining, ocr_job_id, answer_s3_key)

    # Use checkpoint payload as seed input for the first remaining stage
    seed = last_cp.payload or {"ocr_job_id": ocr_job_id}

    workflow = chain(*tasks)
    result = workflow.apply_async(
        args=(seed,),
        link_error=[
            checkpoint_fail.s(ocr_job_id=ocr_job_id, document_type=document_type),
        ],
    )
    logger.info(
        "OCR pipeline (%s) resumed for job %s from '%s': task_id=%s",
        document_type, ocr_job_id, last_cp.stage_name, result.id,
    )
    return result.id


async def _get_resume_point(
    ocr_job_id: str,
    document_type: str,
) -> tuple[Any, list[str]]:
    async with worker_session() as session:
        last = await get_last_checkpoint(session, ocr_job_id, document_type)
    return last, get_stage_order(document_type)
