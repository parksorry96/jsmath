"""Celery task: generate vector embedding using OpenAI text-embedding-3-small.

Combines stem + choices + solution_strategy into a single text, generates
a 1536-dim embedding, and stores it in the Problem.embedding column (pgvector).
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from openai import APIConnectionError, APITimeoutError, RateLimitError
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.celery_app import celery
from app.config import settings
from app.database import worker_session
from app.models.problem import Problem
from app.services.openai_client import get_openai_client

logger = logging.getLogger(__name__)

EMBEDDING_MODEL = "text-embedding-3-small"


def _build_embedding_text(problem: Problem, solution_strategy: str | None = None) -> str:
    """Build the text to embed from problem content."""
    parts = []

    # Prepend subject/unit for better clustering across sources
    if problem.subject:
        parts.append(f"[{problem.subject}]")
    if problem.unit_major:
        parts.append(f"[{problem.unit_major}]")

    parts.append(problem.stem_text)

    if problem.choices:
        for choice in sorted(problem.choices, key=lambda c: c.position):
            parts.append(f"{choice.label} {choice.content_text}")

    if solution_strategy:
        parts.append(f"풀이전략: {solution_strategy}")

    if problem.required_concepts:
        parts.append(f"개념: {', '.join(problem.required_concepts)}")

    return "\n".join(parts)


@celery.task(
    bind=True,
    name="task.analysis.embedding",
    max_retries=3,
    default_retry_delay=10,
    retry_backoff=True,
    acks_late=True,
)
def generate_embedding(
    self: Any,
    previous_result: dict[str, Any] | None = None,
    *,
    problem_id: str | None = None,
) -> dict[str, Any]:
    """Generate and store embedding for a single problem."""
    if previous_result and isinstance(previous_result, dict):
        problem_id = problem_id or previous_result.get("problem_id")
    if not problem_id:
        raise ValueError("problem_id is required")

    try:
        return asyncio.run(generate_embedding_async(problem_id, previous_result))
    except (RateLimitError, APITimeoutError, APIConnectionError) as exc:
        raise self.retry(exc=exc)


async def generate_embedding_async(
    problem_id: str,
    stage1_result: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Standalone async embedding generation. Used by batch processing."""
    return await _generate(problem_id, stage1_result)


async def generate_embeddings_batch(
    items: list[tuple[str, dict[str, Any] | None]],
) -> list[dict[str, Any]]:
    """Batch embedding generation — single API call for multiple problems.

    Args:
        items: list of (problem_id, stage1_result) tuples.

    Returns:
        list of result dicts with problem_id and embedding_generated.
    """
    if not items:
        return []

    if not settings.ai_api_key:
        logger.warning("AI_API_KEY missing; skipping batch embedding")
        return [{"problem_id": pid, "embedding_generated": False} for pid, _ in items]

    # Build texts for all problems in one DB query
    problem_ids = [pid for pid, _ in items]
    stage1_map = {pid: s1 for pid, s1 in items}

    async with worker_session() as session:
        result = await session.execute(
            select(Problem)
            .options(selectinload(Problem.choices))
            .where(Problem.id.in_(problem_ids))
        )
        problems = {p.id: p for p in result.scalars().all()}

    texts: list[str] = []
    valid_ids: list[str] = []
    for pid in problem_ids:
        problem = problems.get(pid)
        if not problem:
            logger.warning("Problem %s not found for embedding", pid)
            continue
        s1 = stage1_map.get(pid)
        strategy = None
        if s1 and isinstance(s1, dict):
            strategy = s1.get("solution_strategy")
        if not strategy:
            strategy = problem.solution_strategy
        texts.append(_build_embedding_text(problem, strategy))
        valid_ids.append(pid)

    if not texts:
        return [{"problem_id": pid, "embedding_generated": False} for pid in problem_ids]

    client = get_openai_client()

    try:
        response = await client.embeddings.create(
            model=EMBEDDING_MODEL,
            input=texts,
        )
    except (RateLimitError, APITimeoutError, APIConnectionError) as exc:
        logger.warning("Batch embedding API error: %s", exc)
        raise
    except Exception:
        logger.exception("Batch embedding failed for %d problems", len(texts))
        return [{"problem_id": pid, "embedding_generated": False} for pid in problem_ids]

    # Store all embeddings in one DB session
    embeddings = {valid_ids[i]: response.data[i].embedding for i in range(len(valid_ids))}
    async with worker_session() as session:
        result = await session.execute(
            select(Problem).where(Problem.id.in_(valid_ids))
        )
        for problem in result.scalars().all():
            emb = embeddings.get(problem.id)
            if emb:
                problem.embedding = emb
        await session.commit()

    logger.info("Batch generated embeddings for %d problems", len(valid_ids))
    return [
        {"problem_id": pid, "embedding_generated": pid in embeddings}
        for pid in problem_ids
    ]


async def _generate(
    problem_id: str,
    stage1_result: dict[str, Any] | None,
) -> dict[str, Any]:
    async with worker_session() as session:
        result = await session.execute(
            select(Problem)
            .options(selectinload(Problem.choices))
            .where(Problem.id == problem_id)
        )
        problem = result.scalar_one_or_none()
        if not problem:
            raise ValueError(f"Problem {problem_id} not found")

        # Use solution_strategy from stage1 results or from DB
        solution_strategy = None
        if stage1_result and isinstance(stage1_result, dict):
            solution_strategy = stage1_result.get("solution_strategy")
        if not solution_strategy:
            solution_strategy = problem.solution_strategy

        # Build embedding text while session is open (accesses choices relation)
        text = _build_embedding_text(problem, solution_strategy)

    if not settings.ai_api_key:
        logger.warning("AI_API_KEY missing; skipping embedding for %s", problem_id)
        return {"problem_id": problem_id, "embedding_generated": False}

    client = get_openai_client()

    try:
        response = await client.embeddings.create(
            model=EMBEDDING_MODEL,
            input=text,
        )
    except (RateLimitError, APITimeoutError, APIConnectionError) as exc:
        logger.warning("OpenAI embedding API error for problem %s: %s", problem_id, exc)
        raise
    except Exception:
        logger.exception("Embedding generation failed for %s; skipping", problem_id)
        return {"problem_id": problem_id, "embedding_generated": False}

    embedding = response.data[0].embedding

    # Store embedding in DB
    async with worker_session() as session:
        result = await session.execute(
            select(Problem).where(Problem.id == problem_id)
        )
        problem = result.scalar_one()
        problem.embedding = embedding
        await session.commit()

    logger.info("Generated embedding for problem %s (%d dims)", problem_id, len(embedding))
    return {"problem_id": problem_id, "embedding_generated": True}
