"""Textbook identification models."""

from __future__ import annotations

from sqlalchemy import Float, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, TimestampMixin


class Textbook(Base, TimestampMixin):
    """A uniquely identified math textbook (e.g., '수학I 개념플러스유형')."""

    __tablename__ = "textbooks"

    id: Mapped[str] = mapped_column(String(30), primary_key=True)
    isbn: Mapped[str | None] = mapped_column(String(20), unique=True)
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    publisher: Mapped[str | None] = mapped_column(String(200))
    author: Mapped[str | None] = mapped_column(String(300))
    subject: Mapped[str | None] = mapped_column(String(50))  # e.g., "수학I", "미적분"
    grade_level: Mapped[str | None] = mapped_column(String(20))  # e.g., "high_2"
    edition: Mapped[str | None] = mapped_column(String(50))
    cover_image_s3_key: Mapped[str | None] = mapped_column(String(500))

    # match confidence from auto-identification (0.0 ~ 1.0)
    match_confidence: Mapped[float | None] = mapped_column(Float)
    match_source: Mapped[str | None] = mapped_column(String(50))  # "isbn", "google_books", "manual"

    versions: Mapped[list[TextbookVersion]] = relationship(back_populates="textbook")


class TextbookVersion(Base, TimestampMixin):
    """A specific uploaded PDF for a textbook (different scans of the same book)."""

    __tablename__ = "textbook_versions"

    id: Mapped[str] = mapped_column(String(30), primary_key=True)
    textbook_id: Mapped[str] = mapped_column(ForeignKey("textbooks.id"), nullable=False)
    source_file_id: Mapped[str] = mapped_column(String(30), nullable=False)  # references lms.source_files
    page_count: Mapped[int | None]
    notes: Mapped[str | None] = mapped_column(Text)

    textbook: Mapped[Textbook] = relationship(back_populates="versions")
