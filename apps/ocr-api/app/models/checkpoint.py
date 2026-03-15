"""Pipeline checkpoint model for tracking stage progress and enabling resume."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Index, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class PipelineCheckpoint(Base):
    """Tracks completion of each pipeline stage for an OCR job.

    Enables resume from last successful checkpoint on failure.
    """

    __tablename__ = "pipeline_checkpoints"

    id: Mapped[str] = mapped_column(String(30), primary_key=True)
    ocr_job_id: Mapped[str] = mapped_column(String(30), nullable=False)
    stage_name: Mapped[str] = mapped_column(String(50), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, server_default="completed")
    payload: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        UniqueConstraint("ocr_job_id", "stage_name", name="uq_checkpoint_job_stage"),
        Index("ix_checkpoint_ocr_job", "ocr_job_id"),
    )
