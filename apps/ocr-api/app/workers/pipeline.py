"""Pipeline orchestration — chains Celery tasks into the full OCR workflow."""

from __future__ import annotations

import logging

from celery import chain

from app.workers.crop_figures import crop_figures
from app.workers.finalize import finalize_pipeline
from app.workers.ocr_poll import poll_mathpix_status
from app.workers.ocr_submit import submit_pdf_to_mathpix
from app.workers.parse_results import parse_mathpix_results
from app.workers.segment_problems import segment_problems

logger = logging.getLogger(__name__)


def start_ocr_pipeline(ocr_job_id: str) -> str:
    """Kick off the full OCR pipeline as a Celery chain.

    Chain: submit -> poll -> parse -> segment -> crop -> finalize

    Returns the Celery task ID.
    """
    workflow = chain(
        submit_pdf_to_mathpix.s(ocr_job_id),
        poll_mathpix_status.s(),
        parse_mathpix_results.s(),
        segment_problems.s(),
        finalize_pipeline.s(),
    )
    result = workflow.apply_async()
    logger.info("OCR pipeline started for job %s: task_id=%s", ocr_job_id, result.id)
    return result.id
