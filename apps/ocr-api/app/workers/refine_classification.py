"""Celery task: refine classification using GPT-4o with CSAT-only taxonomy.

Re-classifies problems with: subject verification, unit correction,
difficulty refinement (1.0-5.0), and is_common determination.
"""

from __future__ import annotations

import asyncio
import json
import logging

from openai import APIConnectionError, APITimeoutError, AsyncOpenAI, RateLimitError
from sqlalchemy import select

from app.celery_app import celery
from app.config import settings
from app.database import worker_session
from app.models.problem import Problem
from app.schemas.problem import CURRICULUM_TREE, SUBJECTS

logger = logging.getLogger(__name__)

REFINE_PROMPT = """You are a Korean CSAT (수능) math classification expert.

Re-classify this math problem using ONLY the following subjects and curriculum:
Subjects: {subjects}

Curriculum hierarchy:
{curriculum}

Problem (LaTeX):
{stem_latex}

Problem (plain text):
{stem_text}

Current classification (may be incorrect):
- Subject: {current_subject}
- Unit Major: {current_unit_major}
- Difficulty: {current_difficulty}

Provide corrected classification in JSON:
{{
  "subject": "one of the subjects above",
  "unit_major": "대단원 name from curriculum",
  "unit_minor": "중단원 name from curriculum (or null)",
  "unit_sub": "소단원 topic from curriculum (or null)",
  "difficulty_refined": 3.5,
  "is_common": true,
  "confidence": 0.9
}}

Rules:
- subject MUST be one of: 수학I, 수학II, 확률과 통계, 미적분, 기하
- is_common: true if subject is 수학I or 수학II, false otherwise
- difficulty_refined: float from 1.0 (기초) to 5.0 (최상), use decimals for precision
- unit_major/minor/sub must come from the curriculum hierarchy above
- confidence: 0.0 to 1.0

Respond with JSON only."""

COMMON_SUBJECTS = {"수학I", "수학II"}


@celery.task(
    bind=True,
    name="task.analysis.refine_classification",
    max_retries=3,
    default_retry_delay=10,
    retry_backoff=True,
    acks_late=True,
)
def refine_classification(self, previous_result=None, *, problem_id: str | None = None) -> dict:
    """Refine classification for a single problem."""
    if previous_result and isinstance(previous_result, dict):
        problem_id = problem_id or previous_result.get("problem_id")
    if not problem_id:
        raise ValueError("problem_id is required")

    return asyncio.run(_refine(self, problem_id))


async def _refine(task, problem_id: str) -> dict:
    async with worker_session() as session:
        result = await session.execute(
            select(Problem).where(Problem.id == problem_id)
        )
        problem = result.scalar_one_or_none()
        if not problem:
            raise ValueError(f"Problem {problem_id} not found")

        prompt = REFINE_PROMPT.format(
            subjects=", ".join(SUBJECTS),
            curriculum=json.dumps(CURRICULUM_TREE, ensure_ascii=False, indent=2),
            stem_latex=problem.stem_latex,
            stem_text=problem.stem_text,
            current_subject=problem.subject or "unknown",
            current_unit_major=problem.unit_major or "unknown",
            current_difficulty=problem.difficulty or "unknown",
        )

    if not settings.ai_api_key:
        logger.warning("AI_API_KEY missing; returning heuristic for %s", problem_id)
        return _heuristic_refine(problem_id)

    client_kwargs: dict = {"api_key": settings.ai_api_key}
    if settings.ai_api_base_url:
        client_kwargs["base_url"] = settings.ai_api_base_url
    client = AsyncOpenAI(**client_kwargs)

    try:
        response = await client.chat.completions.create(
            model=settings.ai_model,
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"},
            temperature=0.2,
            max_completion_tokens=500,
        )
    except (RateLimitError, APITimeoutError, APIConnectionError) as exc:
        logger.warning("OpenAI API error for problem %s: %s — retrying", problem_id, exc)
        raise task.retry(exc=exc)

    content = response.choices[0].message.content or "{}"
    result = json.loads(content)

    subject = result.get("subject", SUBJECTS[0])
    if subject not in SUBJECTS:
        subject = SUBJECTS[0]

    difficulty = result.get("difficulty_refined", 3.0)
    difficulty = max(1.0, min(5.0, float(difficulty)))

    return {
        "problem_id": problem_id,
        "subject": subject,
        "unit_major": result.get("unit_major"),
        "unit_minor": result.get("unit_minor"),
        "unit_sub": result.get("unit_sub"),
        "difficulty_refined": round(difficulty, 1),
        "is_common": subject in COMMON_SUBJECTS,
        "classification_confidence": result.get("confidence", 0.5),
    }


def _heuristic_refine(problem_id: str) -> dict:
    """Fallback when no API key."""
    return {
        "problem_id": problem_id,
        "subject": None,
        "unit_major": None,
        "unit_minor": None,
        "unit_sub": None,
        "difficulty_refined": 3.0,
        "is_common": True,
        "classification_confidence": 0.3,
    }
