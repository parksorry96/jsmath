"""Problem similarity tracking — stores vector similarity search results."""

from __future__ import annotations

import enum

from sqlalchemy import Float, ForeignKey, Index, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, TimestampMixin


class SimilarityType(str, enum.Enum):
    content = "content"      # text/LaTeX similarity
    concept = "concept"      # shared concepts
    structure = "structure"  # similar problem structure


class ProblemSimilarity(Base, TimestampMixin):
    """Tracks similarity between problems based on vector embeddings."""

    __tablename__ = "problem_similarities"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    problem_id: Mapped[str] = mapped_column(
        ForeignKey("problems.id"), nullable=False
    )
    similar_problem_id: Mapped[str] = mapped_column(
        ForeignKey("problems.id"), nullable=False
    )
    similarity_score: Mapped[float] = mapped_column(Float, nullable=False)
    similarity_type: Mapped[SimilarityType] = mapped_column(nullable=False)

    problem = relationship("Problem", foreign_keys=[problem_id])
    similar_problem = relationship("Problem", foreign_keys=[similar_problem_id])

    __table_args__ = (
        UniqueConstraint("problem_id", "similar_problem_id", name="uq_problem_similarity"),
        Index("ix_similarity_problem", "problem_id"),
        Index("ix_similarity_score", "similarity_score"),
    )
