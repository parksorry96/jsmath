"""Pydantic schemas for OCR API endpoints."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class OcrJobCreate(BaseModel):
    """Request to create a new OCR job (called by NestJS)."""

    ocr_job_id: str
    source_file_id: str
    s3_key: str
    document_type: str = "exam"
    book_title: str | None = None
    publisher: str | None = None


class OcrJobResponse(BaseModel):
    """OCR job status response."""

    id: str
    source_file_id: str
    status: str
    mathpix_pdf_id: str | None = None
    num_pages: int | None = None
    pages_completed: int | None = None
    percent_done: float | None = None
    problem_count: int | None = None
    error_message: str | None = None
    created_at: datetime
    completed_at: datetime | None = None

    model_config = {"from_attributes": True}


class OcrJobResultSummary(BaseModel):
    """Summary of OCR results for a completed job."""

    ocr_job_id: str
    num_pages: int
    total_lines: int
    problem_count: int
    pages: list[OcrPageSummary]


class OcrPageSummary(BaseModel):
    """Summary info for one OCR page."""

    page_number: int
    line_count: int
    ocr_confidence: float | None = None


class PipelineHealthResponse(BaseModel):
    """Pipeline health and queue depth info."""

    status: str
    redis_connected: bool
    celery_workers: int
    queue_depths: dict[str, int]
