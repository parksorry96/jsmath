"""Pipeline checkpoint service — save/query stage progress for resume."""

from __future__ import annotations

import logging
import random
import string
import time
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.checkpoint import PipelineCheckpoint

logger = logging.getLogger(__name__)

# Stage order per document type (used to determine resume point)
EXAM_STAGES = [
    "ocr_submit",
    "ocr_poll",
    "parse_results",
    "segment_problems",
    "finalize",
]

EXAM_WITH_ANS_STAGES = [
    "ocr_submit",
    "ocr_poll",
    "parse_results",
    "segment_problems",
    "match_answers",
    "finalize",
]

TEXTBOOK_STAGES = [
    "ocr_submit",
    "ocr_poll",
    "parse_results",
    "detect_sections",
    "segment_textbook",
    "match_answers",
    "finalize_textbook",
]


def _generate_id() -> str:
    ts = hex(int(time.time() * 1000))[2:]
    rand = "".join(random.choices(string.ascii_lowercase + string.digits, k=8))
    return f"cp{ts}{rand}"


def get_stage_order(document_type: str) -> list[str]:
    if document_type == "textbook":
        return TEXTBOOK_STAGES
    if document_type == "exam_with_answers":
        return EXAM_WITH_ANS_STAGES
    return EXAM_STAGES


async def start_checkpoint(
    session: AsyncSession,
    ocr_job_id: str,
    stage_name: str,
) -> None:
    """UPSERT a checkpoint with status='running' and startedAt=now."""
    now = datetime.now(timezone.utc)
    stmt = pg_insert(PipelineCheckpoint).values(
        id=_generate_id(),
        ocr_job_id=ocr_job_id,
        stage_name=stage_name,
        status="running",
        started_at=now,
        completed_at=None,
        error_message=None,
        payload=None,
    ).on_conflict_do_update(
        constraint="uq_checkpoint_job_stage",
        set_={
            "status": "running",
            "started_at": now,
            "completed_at": None,
            "error_message": None,
        },
    )
    await session.execute(stmt)
    await session.commit()


async def save_checkpoint(
    session: AsyncSession,
    ocr_job_id: str,
    stage_name: str,
    payload: dict | None = None,
) -> None:
    """UPSERT a checkpoint with status='completed' and completedAt=now."""
    now = datetime.now(timezone.utc)
    stmt = pg_insert(PipelineCheckpoint).values(
        id=_generate_id(),
        ocr_job_id=ocr_job_id,
        stage_name=stage_name,
        status="completed",
        started_at=now,
        completed_at=now,
        payload=payload,
    ).on_conflict_do_update(
        constraint="uq_checkpoint_job_stage",
        set_={
            "status": "completed",
            "completed_at": now,
            "payload": payload,
        },
    )
    await session.execute(stmt)
    await session.commit()


async def fail_checkpoint(
    session: AsyncSession,
    ocr_job_id: str,
    stage_name: str,
    error: str,
) -> None:
    """UPSERT a checkpoint with status='failed' and errorMessage."""
    now = datetime.now(timezone.utc)
    stmt = pg_insert(PipelineCheckpoint).values(
        id=_generate_id(),
        ocr_job_id=ocr_job_id,
        stage_name=stage_name,
        status="failed",
        started_at=now,
        error_message=error,
    ).on_conflict_do_update(
        constraint="uq_checkpoint_job_stage",
        set_={
            "status": "failed",
            "error_message": error,
        },
    )
    await session.execute(stmt)
    await session.commit()


async def get_last_checkpoint(
    session: AsyncSession,
    ocr_job_id: str,
    document_type: str = "exam",
) -> PipelineCheckpoint | None:
    """Get the latest completed checkpoint by stage order."""
    stages = get_stage_order(document_type)
    result = await session.execute(
        select(PipelineCheckpoint)
        .where(
            PipelineCheckpoint.ocr_job_id == ocr_job_id,
            PipelineCheckpoint.status == "completed",
        )
    )
    checkpoints = result.scalars().all()
    if not checkpoints:
        return None

    # Find the one furthest in stage order
    stage_index = {name: i for i, name in enumerate(stages)}
    completed = [cp for cp in checkpoints if cp.stage_name in stage_index]
    if not completed:
        return None
    return max(completed, key=lambda cp: stage_index[cp.stage_name])


async def get_checkpoints(
    session: AsyncSession,
    ocr_job_id: str,
) -> list[PipelineCheckpoint]:
    """List all checkpoints for a job, ordered by created_at."""
    result = await session.execute(
        select(PipelineCheckpoint)
        .where(PipelineCheckpoint.ocr_job_id == ocr_job_id)
        .order_by(PipelineCheckpoint.created_at)
    )
    return list(result.scalars().all())
