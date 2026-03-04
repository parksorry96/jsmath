"""OCR job tracking model — mirrors lms.ocr_jobs with pipeline-specific fields."""

from __future__ import annotations

import enum

from sqlalchemy import DateTime, Enum, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, TimestampMixin


class JobStatus(str, enum.Enum):
    pending = "pending"
    submitting = "submitting"
    processing = "processing"
    segmenting = "segmenting"
    cropping = "cropping"
    classifying = "classifying"
    completed = "completed"
    failed = "failed"
    manual_review = "manual_review"


class OcrJobTracking(Base, TimestampMixin):
    """Pipeline-side tracking for an OCR job.

    The authoritative OcrJob record lives in lms.ocr_jobs (Prisma).
    This table tracks Mathpix-specific state and pipeline progress.
    """

    __tablename__ = "ocr_job_tracking"

    id: Mapped[str] = mapped_column(String(30), primary_key=True)  # same ID as lms.ocr_jobs
    source_file_id: Mapped[str] = mapped_column(String(30), nullable=False)
    s3_key: Mapped[str] = mapped_column(String(500), nullable=False)

    status: Mapped[JobStatus] = mapped_column(
        Enum(JobStatus, name="pipeline_job_status", schema="ocr"),
        default=JobStatus.pending,
        nullable=False,
    )

    # Mathpix tracking
    mathpix_pdf_id: Mapped[str | None] = mapped_column(String(100))
    num_pages: Mapped[int | None] = mapped_column(Integer)
    pages_completed: Mapped[int | None] = mapped_column(Integer)
    percent_done: Mapped[float | None]

    # Pipeline results
    problem_count: Mapped[int | None] = mapped_column(Integer)
    error_message: Mapped[str | None] = mapped_column(Text)
    retry_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # Textbook identification
    textbook_id: Mapped[str | None] = mapped_column(String(30))

    completed_at: Mapped[str | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        Index("ix_job_tracking_status_created", "status", "created_at"),
    )
