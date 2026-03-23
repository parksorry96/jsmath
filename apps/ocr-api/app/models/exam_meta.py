"""External exam question metadata — national exam statistics (e.g. Megastudy)."""

from __future__ import annotations

from sqlalchemy import Float, ForeignKey, Index, Integer, SmallInteger, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, TimestampMixin


class ExamQuestionMeta(Base, TimestampMixin):
    """Per-question statistics from external sources (Megastudy, EBS, etc.).

    Stores correct rates and choice selection rates for national mock exams.
    Linked to Problem after OCR via problem_id FK.
    """

    __tablename__ = "exam_question_meta"

    id: Mapped[str] = mapped_column(String(30), primary_key=True)
    exam_year: Mapped[int] = mapped_column(Integer, nullable=False)
    exam_month: Mapped[int] = mapped_column(Integer, nullable=False)
    exam_type: Mapped[str] = mapped_column(String(30), nullable=False)  # suneung, mock_pyeongga, mock_gyoyuk
    subject: Mapped[str] = mapped_column(String(50), nullable=False)
    question_number: Mapped[int] = mapped_column(Integer, nullable=False)
    correct_answer: Mapped[str | None] = mapped_column(String(20))
    correct_rate: Mapped[float | None] = mapped_column(Float)  # 0.0 ~ 1.0
    point_value: Mapped[int | None] = mapped_column(SmallInteger)
    choice_rates: Mapped[dict | None] = mapped_column(JSONB)  # {"1": 0.05, "2": 0.10, ...}
    is_common: Mapped[bool | None] = mapped_column()
    source: Mapped[str] = mapped_column(String(30), default="megastudy")

    # Linked after OCR
    problem_id: Mapped[str | None] = mapped_column(ForeignKey("problems.id"))
    problem = relationship("Problem", backref="exam_meta")

    __table_args__ = (
        UniqueConstraint(
            "exam_year", "exam_month", "exam_type", "subject", "question_number",
            name="uq_exam_question",
        ),
        Index("ix_exam_meta_problem", "problem_id"),
        Index("ix_exam_meta_exam", "exam_year", "exam_month", "subject"),
    )
