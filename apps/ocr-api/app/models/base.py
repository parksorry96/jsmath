"""SQLAlchemy base and common utilities for OCR domain models."""

from datetime import datetime

from sqlalchemy import DateTime, MetaData, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

# All OCR models live in the 'ocr' schema
OCR_SCHEMA = "ocr"

metadata = MetaData(schema=OCR_SCHEMA)


class Base(DeclarativeBase):
    metadata = metadata


class TimestampMixin:
    """Adds created_at / updated_at columns."""

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
