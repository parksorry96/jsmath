"""Pipeline orchestration — chains Celery tasks into the full OCR workflow."""

from __future__ import annotations

import logging

from celery import chain

from app.workers.finalize import finalize_pipeline
from app.workers.ocr_poll import poll_mathpix_status
from app.workers.ocr_submit import submit_pdf_to_mathpix
from app.workers.parse_results import parse_mathpix_results
from app.workers.segment_problems import segment_problems

logger = logging.getLogger(__name__)


def start_ocr_pipeline(ocr_job_id: str, document_type: str = "exam") -> str:
    """Kick off the full OCR pipeline as a Celery chain.

    For exam: submit -> poll -> parse -> segment -> finalize
    For textbook: submit -> poll -> parse -> detect_sections -> segment_textbook -> match_answers -> finalize_textbook

    Returns the Celery task ID.
    """
    # Common chain: submit -> poll -> parse
    common = [
        submit_pdf_to_mathpix.s(ocr_job_id),
        poll_mathpix_status.s(),
        parse_mathpix_results.s(),
    ]

    if document_type == "textbook":
        from app.workers.detect_sections import detect_sections
        from app.workers.finalize_textbook import finalize_textbook
        from app.workers.match_answers import match_answers
        from app.workers.segment_textbook import segment_textbook

        workflow = chain(*common, detect_sections.s(), segment_textbook.s(), match_answers.s(), finalize_textbook.s())
    else:
        workflow = chain(*common, segment_problems.s(), finalize_pipeline.s())

    result = workflow.apply_async()
    logger.info("OCR pipeline (%s) started for job %s: task_id=%s", document_type, ocr_job_id, result.id)
    return result.id
