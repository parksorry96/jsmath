"""Celery task: detect CSAT exam patterns using GPT-4o.

Determines: exam_source, position_type, point_value, question_format.
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

logger = logging.getLogger(__name__)

EXAM_PATTERN_PROMPT = """You are a Korean CSAT (수능) exam analysis expert.

Analyze this math problem and determine its exam characteristics.

Problem (LaTeX):
{stem_latex}

Problem (plain text):
{stem_text}

Problem number in source: {problem_number}
Problem type: {problem_type}

CSAT Exam Structure:
- Common section (수학I+수학II): 22 questions
  - Q1-2: 2점 (5지선다)
  - Q3-8: 3점 (5지선다)
  - Q9-15: 4점 (5지선다)
  - Q16-19: 3점 (단답형)
  - Q20-22: 4점 (단답형)
- Elective section (미적분/확통/기하): 8 questions
  - Q23: 2점 (5지선다)
  - Q24-27: 3점 (5지선다)
  - Q28: 4점 (5지선다)
  - Q29-30: 4점 (단답형)
- Killer questions: typically Q21 (common), Q29-30 (elective)
- Semi-killer: Q15, Q20-22, Q28

Provide analysis in JSON:
{{
  "exam_source": null,
  "position_type": "normal",
  "point_value": 3,
  "question_format": "multiple_choice_5"
}}

Rules:
- exam_source: If the problem appears to be from a specific 수능/모의평가, return {{"year": 2024, "month": 11, "type": "수능", "number": 15}}. Otherwise null.
- position_type: "killer" for extremely difficult (Q21/29/30 level), "semi_killer" for hard (Q15/20/22/28 level), "normal" otherwise
- point_value: 2, 3, or 4 based on estimated difficulty and structure
- question_format: "multiple_choice_5" if has 5 choices, "short_answer" if requires numeric answer

Respond with JSON only."""


@celery.task(
    bind=True,
    name="task.analysis.exam_pattern",
    max_retries=3,
    default_retry_delay=10,
    retry_backoff=True,
    acks_late=True,
)
def detect_exam_pattern(self, previous_result=None, *, problem_id: str | None = None) -> dict:
    """Detect CSAT exam patterns for a single problem."""
    if previous_result and isinstance(previous_result, dict):
        problem_id = problem_id or previous_result.get("problem_id")
    if not problem_id:
        raise ValueError("problem_id is required")

    return asyncio.run(_detect(self, problem_id))


async def _detect(task, problem_id: str) -> dict:
    async with worker_session() as session:
        result = await session.execute(
            select(Problem).where(Problem.id == problem_id)
        )
        problem = result.scalar_one_or_none()
        if not problem:
            raise ValueError(f"Problem {problem_id} not found")

        prompt = EXAM_PATTERN_PROMPT.format(
            stem_latex=problem.stem_latex,
            stem_text=problem.stem_text,
            problem_number=problem.problem_number or "unknown",
            problem_type=problem.problem_type.value if problem.problem_type else "unknown",
        )

    if not settings.ai_api_key:
        logger.warning("AI_API_KEY missing; returning defaults for %s", problem_id)
        return _default_pattern(problem_id)

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
            max_completion_tokens=300,
        )
    except (RateLimitError, APITimeoutError, APIConnectionError) as exc:
        logger.warning("OpenAI API error for problem %s: %s — retrying", problem_id, exc)
        raise task.retry(exc=exc)

    content = response.choices[0].message.content or "{}"
    analysis = json.loads(content)

    # Validate point_value
    point_value = analysis.get("point_value", 3)
    if point_value not in (2, 3, 4):
        point_value = 3

    # Validate position_type
    position_type = analysis.get("position_type", "normal")
    if position_type not in ("normal", "semi_killer", "killer"):
        position_type = "normal"

    # Validate question_format
    question_format = analysis.get("question_format", "multiple_choice_5")
    if question_format not in ("multiple_choice_5", "short_answer"):
        question_format = "multiple_choice_5"

    return {
        "problem_id": problem_id,
        "exam_source": analysis.get("exam_source"),
        "position_type": position_type,
        "point_value": point_value,
        "question_format": question_format,
    }


def _default_pattern(problem_id: str) -> dict:
    """Fallback defaults."""
    return {
        "problem_id": problem_id,
        "exam_source": None,
        "position_type": "normal",
        "point_value": 3,
        "question_format": "multiple_choice_5",
    }
