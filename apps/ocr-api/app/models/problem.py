"""Problem domain models — the core of the math problem bank."""

from __future__ import annotations

import enum
from datetime import datetime

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Index,
    Integer,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, TSVECTOR
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, TimestampMixin


# ─── Enums ───


class ProblemType(str, enum.Enum):
    multiple_choice = "multiple_choice"  # 객관식
    short_answer = "short_answer"  # 주관식 단답형
    written_solution = "written_solution"  # 서술형
    essay = "essay"  # 논술형


class AssetKind(str, enum.Enum):
    graph = "graph"  # coordinate graph (function, inequality, etc.)
    geometry = "geometry"  # geometric figure
    statistics = "statistics"  # histogram, box plot, scatter, etc.
    number_line = "number_line"
    tree_diagram = "tree_diagram"
    venn_diagram = "venn_diagram"
    table = "table"
    other = "other"


class ReviewStatus(str, enum.Enum):
    auto_approved = "auto_approved"  # confidence above threshold
    pending_review = "pending_review"  # needs teacher review
    approved = "approved"  # teacher approved
    rejected = "rejected"  # teacher rejected


class AnalysisStatus(str, enum.Enum):
    pending = "pending"
    analyzing = "analyzing"
    completed = "completed"
    failed = "failed"


class QuestionFormat(str, enum.Enum):
    multiple_choice_5 = "multiple_choice_5"  # 5지선다
    short_answer = "short_answer"  # 단답형


class PositionType(str, enum.Enum):
    normal = "normal"
    semi_killer = "semi_killer"  # 준킬러
    killer = "killer"  # 킬러


# ─── Problem (main entity) ───


class Problem(Base, TimestampMixin):
    """A single math problem extracted from OCR."""

    __tablename__ = "problems"

    id: Mapped[str] = mapped_column(String(30), primary_key=True)

    # Source traceability
    ocr_job_id: Mapped[str] = mapped_column(String(30), nullable=False)
    textbook_id: Mapped[str | None] = mapped_column(ForeignKey("textbooks.id"))
    source_file_id: Mapped[str | None] = mapped_column(String(30))

    # Position in source
    start_page: Mapped[int] = mapped_column(Integer, nullable=False)
    end_page: Mapped[int] = mapped_column(Integer, nullable=False)
    problem_number: Mapped[str | None] = mapped_column(String(20))  # e.g., "3", "15"
    display_number: Mapped[str | None] = mapped_column(String(50))  # e.g., "3.", "15-1)"

    # Parent-child relationship (for sub-problems)
    parent_id: Mapped[str | None] = mapped_column(ForeignKey("problems.id"))
    parent: Mapped[Problem | None] = relationship(
        remote_side="Problem.id", back_populates="sub_problems"
    )
    sub_problems: Mapped[list[Problem]] = relationship(back_populates="parent")

    # Shared stem (for 공통 조건 + 하위 문제)
    shared_stem_latex: Mapped[str | None] = mapped_column(Text)
    shared_stem_text: Mapped[str | None] = mapped_column(Text)

    # Content
    stem_latex: Mapped[str] = mapped_column(Text, nullable=False)  # raw OCR LaTeX
    stem_text: Mapped[str] = mapped_column(Text, nullable=False)  # plain text (Korean + stripped math)
    stem_latex_normalized: Mapped[str | None] = mapped_column(Text)  # sympy-normalized LaTeX
    problem_type: Mapped[ProblemType] = mapped_column(nullable=False)

    # Bounding box in source page (for crop reference)
    bbox: Mapped[dict | None] = mapped_column(JSONB)  # {"x": float, "y": float, "w": float, "h": float}

    # Answer (for auto-grading)
    answer_text: Mapped[str | None] = mapped_column(Text)
    answer_latex: Mapped[str | None] = mapped_column(Text)

    # Classification
    grade_level: Mapped[str | None] = mapped_column(String(20))  # e.g., "high_1", "middle_3"
    subject: Mapped[str | None] = mapped_column(String(50))  # e.g., "수학I", "미적분"
    unit_major: Mapped[str | None] = mapped_column(String(100))  # 대단원
    unit_minor: Mapped[str | None] = mapped_column(String(100))  # 중단원
    unit_sub: Mapped[str | None] = mapped_column(String(100))  # 소단원
    difficulty: Mapped[int | None] = mapped_column(SmallInteger)  # 1~5
    classification_confidence: Mapped[float | None] = mapped_column(Float)

    # Review
    review_status: Mapped[ReviewStatus] = mapped_column(
        Enum(ReviewStatus, name="ReviewStatus", schema="ocr", create_constraint=False),
        default=ReviewStatus.pending_review,
    )
    reviewed_by: Mapped[str | None] = mapped_column(String(30))  # user id from lms

    # CSAT-specific metadata
    is_common: Mapped[bool | None] = mapped_column(default=True)  # 공통과목 vs 선택과목
    point_value: Mapped[int | None] = mapped_column(SmallInteger)  # 2, 3, 4
    question_format: Mapped[QuestionFormat | None] = mapped_column()
    position_type: Mapped[PositionType | None] = mapped_column()
    exam_source: Mapped[dict | None] = mapped_column(JSONB)  # {"year","month","type","number"}

    # AI analysis results
    solution_strategy: Mapped[str | None] = mapped_column(Text)
    required_concepts: Mapped[list | None] = mapped_column(JSONB)
    solution_steps: Mapped[list | None] = mapped_column(JSONB)
    estimated_time_sec: Mapped[int | None] = mapped_column(Integer)
    common_mistakes: Mapped[list | None] = mapped_column(JSONB)
    difficulty_refined: Mapped[float | None] = mapped_column(Float)
    analysis_status: Mapped[AnalysisStatus] = mapped_column(default=AnalysisStatus.pending)
    analyzed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # Full-text search
    stem_tsv: Mapped[str | None] = mapped_column(TSVECTOR)

    # Vector embedding for similarity search
    embedding: Mapped[list[float] | None] = mapped_column(Vector(1536))

    # Relations
    choices: Mapped[list[ProblemChoice]] = relationship(
        back_populates="problem", order_by="ProblemChoice.position"
    )
    assets: Mapped[list[ProblemAsset]] = relationship(back_populates="problem")
    tags: Mapped[list[ProblemTag]] = relationship(back_populates="problem")

    __table_args__ = (
        Index("ix_problems_ocr_job", "ocr_job_id"),
        Index("ix_problems_textbook", "textbook_id"),
        Index("ix_problems_classification", "grade_level", "subject", "unit_major"),
        Index("ix_problems_review", "review_status"),
        Index("ix_problems_analysis_status", "analysis_status"),
        Index("ix_problems_stem_tsv", "stem_tsv", postgresql_using="gin"),
        Index("ix_problems_embedding", "embedding", postgresql_using="hnsw",
              postgresql_with={"m": 16, "ef_construction": 64},
              postgresql_ops={"embedding": "vector_cosine_ops"}),
    )


# ─── Choices (for multiple-choice problems) ───


class ProblemChoice(Base):
    """A single choice option (①②③④⑤) for a multiple-choice problem."""

    __tablename__ = "problem_choices"

    id: Mapped[str] = mapped_column(String(30), primary_key=True)
    problem_id: Mapped[str] = mapped_column(ForeignKey("problems.id"), nullable=False)
    position: Mapped[int] = mapped_column(SmallInteger, nullable=False)  # 1~5
    label: Mapped[str] = mapped_column(String(10), nullable=False)  # "①", "②", ...
    content_latex: Mapped[str] = mapped_column(Text, nullable=False)
    content_text: Mapped[str] = mapped_column(Text, nullable=False)
    is_correct: Mapped[bool | None]  # null if answer not yet confirmed

    problem: Mapped[Problem] = relationship(back_populates="choices")

    __table_args__ = (
        UniqueConstraint("problem_id", "position", name="uq_choice_position"),
    )


# ─── Assets (graphs, figures, tables cropped from pages) ───


class ProblemAsset(Base, TimestampMixin):
    """A cropped image asset (graph, figure, table) associated with a problem."""

    __tablename__ = "problem_assets"

    id: Mapped[str] = mapped_column(String(30), primary_key=True)
    problem_id: Mapped[str] = mapped_column(ForeignKey("problems.id"), nullable=False)
    kind: Mapped[AssetKind] = mapped_column(nullable=False)
    sub_kind: Mapped[str | None] = mapped_column(String(50))  # e.g., "function_plot", "triangle"

    # Source location
    page_id: Mapped[str | None] = mapped_column(String(30))  # ocr_pages.id
    bbox: Mapped[dict | None] = mapped_column(JSONB)  # {"x", "y", "w", "h"} in source page

    # Stored crop
    s3_key: Mapped[str] = mapped_column(String(500), nullable=False)
    format: Mapped[str] = mapped_column(String(10), default="webp")  # "webp", "png"
    width_px: Mapped[int | None]
    height_px: Mapped[int | None]

    # Quality metrics
    edge_density: Mapped[float | None] = mapped_column(Float)  # % of edge pixels
    blank_ratio: Mapped[float | None] = mapped_column(Float)  # % of white pixels

    # AI classification result
    ai_description: Mapped[str | None] = mapped_column(Text)  # from OpenAI Vision
    detection_method: Mapped[str | None] = mapped_column(String(30))  # "line_data", "vision_fallback"

    problem: Mapped[Problem] = relationship(back_populates="assets")

    __table_args__ = (
        Index("ix_assets_problem_kind", "problem_id", "kind"),
    )


# ─── Tags (controlled vocabulary for concept tagging) ───


class TagDictionary(Base, TimestampMixin):
    """A controlled vocabulary entry for math concept tags."""

    __tablename__ = "tag_dictionary"

    id: Mapped[str] = mapped_column(String(30), primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)  # e.g., "이차방정식"
    category: Mapped[str | None] = mapped_column(String(50))  # e.g., "algebra", "calculus"
    grade_levels: Mapped[list[str] | None] = mapped_column(ARRAY(String(20)))
    curriculum_code: Mapped[str | None] = mapped_column(String(30))  # official curriculum reference


class ProblemTag(Base):
    """Association between a problem and a concept tag."""

    __tablename__ = "problem_tags"

    id: Mapped[str] = mapped_column(String(30), primary_key=True)
    problem_id: Mapped[str] = mapped_column(ForeignKey("problems.id"), nullable=False)
    tag_id: Mapped[str] = mapped_column(ForeignKey("tag_dictionary.id"), nullable=False)
    confidence: Mapped[float | None] = mapped_column(Float)  # AI classification confidence
    source: Mapped[str | None] = mapped_column(String(30))  # "auto", "manual"

    problem: Mapped[Problem] = relationship(back_populates="tags")
    tag: Mapped[TagDictionary] = relationship()

    __table_args__ = (
        UniqueConstraint("problem_id", "tag_id", name="uq_problem_tag"),
    )
