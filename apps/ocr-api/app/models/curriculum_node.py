"""CurriculumNode model and lookup helper for curriculum tree matching."""

from __future__ import annotations

import logging
import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, and_, select
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base

logger = logging.getLogger(__name__)


class CurriculumNode(Base):
    """A node in the curriculum tree (subject → unitMajor → unitMinor → unitSub)."""

    __tablename__ = "curriculum_nodes"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    curriculum_year: Mapped[int] = mapped_column(Integer, nullable=False)
    level: Mapped[int] = mapped_column(Integer, nullable=False)
    code: Mapped[str] = mapped_column(String, nullable=False)
    label: Mapped[str] = mapped_column(String, nullable=False)
    parent_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("curriculum_nodes.id"),
        nullable=True,
    )
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    grade_level: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default="now()", nullable=False
    )


async def find_curriculum_node(
    session: AsyncSession,
    subject: str | None,
    unit_major: str | None = None,
    unit_minor: str | None = None,
    curriculum_year: int = 2015,
) -> CurriculumNode | None:
    """Find the most specific matching CurriculumNode by Korean label.

    Tries level 3 (unit_minor) first, then level 2 (unit_major), then level 1 (subject).
    When looking up unit_minor, also verifies the parent's label matches unit_major
    to disambiguate labels that appear under multiple subjects (e.g. "극한").
    """
    if not subject:
        return None

    # Try most specific first: level 3 (unit_minor)
    if unit_minor and unit_major:
        # Join with parent to verify unit_major matches
        parent = CurriculumNode.__table__.alias("parent")
        stmt = (
            select(CurriculumNode)
            .join(parent, CurriculumNode.parent_id == parent.c.id)
            .where(
                and_(
                    CurriculumNode.curriculum_year == curriculum_year,
                    CurriculumNode.level == 3,
                    CurriculumNode.label == unit_minor,
                    parent.c.label == unit_major,
                )
            )
        )
        result = await session.execute(stmt)
        node = result.scalar_one_or_none()
        if node:
            return node

    # Try level 2 (unit_major), verifying parent is the matching subject
    if unit_major:
        parent = CurriculumNode.__table__.alias("parent")
        stmt = (
            select(CurriculumNode)
            .join(parent, CurriculumNode.parent_id == parent.c.id)
            .where(
                and_(
                    CurriculumNode.curriculum_year == curriculum_year,
                    CurriculumNode.level == 2,
                    CurriculumNode.label == unit_major,
                    parent.c.label == subject,
                )
            )
        )
        result = await session.execute(stmt)
        node = result.scalar_one_or_none()
        if node:
            return node

    # Fallback: level 1 (subject)
    stmt = select(CurriculumNode).where(
        and_(
            CurriculumNode.curriculum_year == curriculum_year,
            CurriculumNode.level == 1,
            CurriculumNode.label == subject,
        )
    )
    result = await session.execute(stmt)
    return result.scalar_one_or_none()
