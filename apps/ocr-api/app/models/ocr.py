"""OCR job, page, and line models — stores raw Mathpix output."""

from __future__ import annotations

from sqlalchemy import Float, ForeignKey, Index, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, TimestampMixin


class OcrPage(Base, TimestampMixin):
    """One rendered page from a PDF, with its OCR result."""

    __tablename__ = "ocr_pages"

    id: Mapped[str] = mapped_column(String(30), primary_key=True)
    ocr_job_id: Mapped[str] = mapped_column(String(30), nullable=False)  # references lms.ocr_jobs
    page_number: Mapped[int] = mapped_column(Integer, nullable=False)
    image_s3_key: Mapped[str | None] = mapped_column(String(500))  # 300dpi page render
    width_px: Mapped[int | None]
    height_px: Mapped[int | None]
    dpi: Mapped[int] = mapped_column(Integer, default=300)
    ocr_confidence: Mapped[float | None] = mapped_column(Float)  # average confidence for page
    raw_response: Mapped[dict | None] = mapped_column(JSONB)  # full Mathpix response for page

    lines: Mapped[list[OcrLine]] = relationship(back_populates="page", order_by="OcrLine.line_number")

    __table_args__ = (
        Index("ix_ocr_pages_job_page", "ocr_job_id", "page_number", unique=True),
    )


class OcrLine(Base):
    """A single OCR line from Mathpix output, with coordinates and LaTeX."""

    __tablename__ = "ocr_lines"

    id: Mapped[str] = mapped_column(String(30), primary_key=True)
    page_id: Mapped[str] = mapped_column(ForeignKey("ocr_pages.id"), nullable=False)
    line_number: Mapped[int] = mapped_column(Integer, nullable=False)

    # Content
    text: Mapped[str] = mapped_column(Text, nullable=False)  # plain text
    latex: Mapped[str | None] = mapped_column(Text)  # LaTeX if math detected
    line_type: Mapped[str | None] = mapped_column(String(30))  # "text", "math", "mixed"

    # Bounding box (from Mathpix line_data)
    bbox_x: Mapped[float | None] = mapped_column(Float)
    bbox_y: Mapped[float | None] = mapped_column(Float)
    bbox_w: Mapped[float | None] = mapped_column(Float)
    bbox_h: Mapped[float | None] = mapped_column(Float)

    # Confidence
    confidence: Mapped[float | None] = mapped_column(Float)

    # Mathpix raw line_data (for graph detection coordinates etc.)
    line_data: Mapped[dict | None] = mapped_column(JSONB)

    page: Mapped[OcrPage] = relationship(back_populates="lines")

    __table_args__ = (
        Index("ix_ocr_lines_page_num", "page_id", "line_number", unique=True),
    )
