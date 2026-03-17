"""Celery task: find similar problems using pgvector cosine similarity.

After embedding is generated, queries for top-10 similar problems and
stores results in the problem_similarities table.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from typing import Any

from sqlalchemy import func, select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.celery_app import celery
from app.database import worker_session
from app.models.problem import Problem
from app.models.similarity import ProblemSimilarity, SimilarityType

logger = logging.getLogger(__name__)

TOP_K = 10
MIN_SIMILARITY = 0.5  # Minimum cosine similarity threshold


@celery.task(
    bind=True,
    name="task.analysis.find_similar",
    max_retries=2,
    default_retry_delay=5,
    acks_late=True,
)
def find_similar(
    self: Any,
    previous_result: dict[str, Any] | None = None,
    *,
    problem_id: str | None = None,
) -> dict[str, Any]:
    """Find top-K similar problems using pgvector cosine distance."""
    if previous_result and isinstance(previous_result, dict):
        problem_id = problem_id or previous_result.get("problem_id")
    if not problem_id:
        raise ValueError("problem_id is required")

    return asyncio.run(_find(problem_id))


async def _find(problem_id: str) -> dict[str, Any]:
    async with worker_session() as session:
        # Get the problem's embedding
        result = await session.execute(
            select(Problem.embedding).where(Problem.id == problem_id)
        )
        row = result.one_or_none()
        if not row or row[0] is None:
            logger.warning("No embedding for problem %s; skipping similarity search", problem_id)
            return {"problem_id": problem_id, "similar_count": 0}

        embedding = row[0]

        # Query pgvector for top-K similar problems using cosine distance (<=>)
        similar_query = text("""
            SELECT id, 1 - (embedding <=> CAST(:query_embedding AS vector)) AS score
            FROM ocr.problems
            WHERE id != :problem_id
              AND embedding IS NOT NULL
            ORDER BY embedding <=> CAST(:query_embedding AS vector)
            LIMIT :top_k
        """)

        embedding_str = '[' + ','.join(str(x) for x in embedding) + ']'
        similar_result = await session.execute(
            similar_query,
            {
                "query_embedding": embedding_str,
                "problem_id": problem_id,
                "top_k": TOP_K,
            },
        )
        similar_rows = similar_result.all()

        # Filter by minimum similarity and upsert results
        stored = 0
        for similar_id, score in similar_rows:
            if score < MIN_SIMILARITY:
                continue

            stmt = pg_insert(ProblemSimilarity).values(
                id=str(uuid.uuid4()),
                problem_id=problem_id,
                similar_problem_id=similar_id,
                similarity_score=round(float(score), 4),
                similarity_type=SimilarityType.content,
                created_at=func.now(),
                updated_at=func.now(),
            ).on_conflict_do_update(
                index_elements=["problem_id", "similar_problem_id"],
                set_={
                    "similarity_score": round(float(score), 4),
                    "updated_at": func.now(),
                },
            )
            await session.execute(stmt)
            stored += 1

        await session.commit()

    logger.info("Found %d similar problems for %s", stored, problem_id)
    return {"problem_id": problem_id, "similar_count": stored}
