"""Celery task: generate vector embedding using OpenAI text-embedding-3-small.

Combines stem + choices + solution_strategy into a single text, generates
a 1536-dim embedding, and stores it in the Problem.embedding column (pgvector).
"""

from __future__ import annotations

import asyncio
import logging

from openai import APIConnectionError, APITimeoutError, AsyncOpenAI, RateLimitError
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.celery_app import celery
from app.config import settings
from app.database import worker_session
from app.models.problem import Problem, ProblemChoice

logger = logging.getLogger(__name__)

EMBEDDING_MODEL = "text-embedding-3-small"


def _build_embedding_text(problem: Problem, solution_strategy: str | None = None) -> str:
    """Build the text to embed from problem content."""
    parts = [problem.stem_text]

    if problem.choices:
        for choice in sorted(problem.choices, key=lambda c: c.position):
            parts.append(f"{choice.label} {choice.content_text}")

    if solution_strategy:
        parts.append(f"풀이전략: {solution_strategy}")

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
    self, previous_result=None, *, problem_id: str | None = None
) -> dict:
    """Generate and store embedding for a single problem."""
    if previous_result and isinstance(previous_result, dict):
        problem_id = problem_id or previous_result.get("problem_id")
    if not problem_id:
        raise ValueError("problem_id is required")

    return asyncio.run(_generate(self, problem_id, previous_result))


async def _generate(task, problem_id: str, stage1_result: dict | None) -> dict:
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

    client_kwargs: dict = {"api_key": settings.ai_api_key}
    if settings.ai_api_base_url:
        client_kwargs["base_url"] = settings.ai_api_base_url
    client = AsyncOpenAI(**client_kwargs)

    try:
        response = await client.embeddings.create(
            model=EMBEDDING_MODEL,
            input=text,
        )
    except (RateLimitError, APITimeoutError, APIConnectionError) as exc:
        logger.warning("OpenAI embedding API error for problem %s: %s — retrying", problem_id, exc)
        raise task.retry(exc=exc)
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
