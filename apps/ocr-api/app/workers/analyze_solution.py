"""Celery task: analyze solution strategy using OpenAI GPT-4o.

Extracts: solution_strategy, required_concepts, solution_steps,
estimated_time_sec, common_mistakes.
"""

from __future__ import annotations

import asyncio
import json
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

SOLUTION_ANALYSIS_SYSTEM_PROMPT = """You are a Korean CSAT (수능) math education expert.

# Goal
Independently solve the given problem and return a student-facing solution analysis.

# Evidence Priority
- Use only the provided problem statement and choices as ground truth.
- If LaTeX and plain text conflict, prefer LaTeX for formulas and plain text for prose unless one is obviously corrupted.
- Do not invent diagrams, hidden conditions, or textbook context that are not present in the input.

# Output Contract
- Return exactly one JSON object with these keys only:
  solution_strategy, required_concepts, solution_steps, estimated_time_sec, common_mistakes
- Do not add markdown, code fences, commentary, or extra keys.

# Field Rules
- solution_strategy: concise Korean explanation of the overall solving approach.
- required_concepts: Korean curriculum or concept names actually needed to solve the problem.
- solution_steps: ordered steps; each description must match a real step in the solution and name the concept used.
- estimated_time_sec: realistic time for an average student; use a conservative estimate.
- common_mistakes: plausible mistakes for this exact problem type, not generic advice.

# Language And Math Formatting
- All descriptive text must be in Korean.
- In solution_strategy, solution_steps.description, and common_mistakes, every mathematical expression must be written in LaTeX.
- Use $...$ for inline math and $$...$$ for display or multi-line derivations.
- Keep Korean explanation outside math delimiters.
- Never leave raw math like x^2, a_n, \\frac{1}{2}, lim_{n\\to\\infty} outside math delimiters.

# Self-Check
- solution_strategy and solution_steps must agree.
- required_concepts should be sufficient but not padded.
- common_mistakes must correspond to actual failure modes of this problem.
- The JSON must be valid and complete."""

SOLUTION_ANALYSIS_USER_PROMPT = """# Problem
<problem_latex>
{stem_latex}
</problem_latex>

<problem_text>
{stem_text}
</problem_text>

{choices_text}

# Return JSON
{{
  "solution_strategy": "Step-by-step explanation of how to solve this problem (Korean)",
  "required_concepts": ["concept1", "concept2", ...],
  "solution_steps": [
    {{"step": 1, "description": "description in Korean", "concept": "related concept"}},
    ...
  ],
  "estimated_time_sec": 120,
  "common_mistakes": ["mistake1 in Korean", "mistake2 in Korean", ...]
}}"""


@celery.task(
    bind=True,
    name="task.analysis.solution",
    max_retries=3,
    default_retry_delay=10,
    retry_backoff=True,
    acks_late=True,
)
def analyze_solution(
    self: Any,
    previous_result: dict[str, Any] | None = None,
    *,
    problem_id: str | None = None,
) -> dict[str, Any]:
    """Analyze a single problem's solution strategy using GPT-4o."""
    if previous_result and isinstance(previous_result, dict):
        problem_id = problem_id or previous_result.get("problem_id")
    if not problem_id:
        raise ValueError("problem_id is required")

    return asyncio.run(_analyze(self, problem_id))


async def _analyze(task: Any, problem_id: str) -> dict[str, Any]:
    async with worker_session() as session:
        result = await session.execute(
            select(Problem)
            .options(selectinload(Problem.choices))
            .where(Problem.id == problem_id)
        )
        problem = result.scalar_one_or_none()
        if not problem:
            raise ValueError(f"Problem {problem_id} not found")

        # Build choices text if available — extract data before session closes
        choices_text = ""
        if problem.choices:
            choices_lines = []
            for choice in sorted(problem.choices, key=lambda c: c.position):
                choices_lines.append(f"{choice.label} {choice.content_text}")
            choices_text = "Choices:\n" + "\n".join(choices_lines)

        user_prompt = SOLUTION_ANALYSIS_USER_PROMPT.format(
            stem_latex=problem.stem_latex,
            stem_text=problem.stem_text,
            choices_text=choices_text,
        )

    # Call OpenAI
    if not settings.ai_api_key:
        logger.warning("AI_API_KEY missing; returning empty analysis for %s", problem_id)
        return {
            "problem_id": problem_id,
            "solution_strategy": None,
            "required_concepts": [],
            "solution_steps": [],
            "estimated_time_sec": None,
            "common_mistakes": [],
        }

    client = get_openai_client()

    try:
        response = await client.chat.completions.create(
            model=settings.ai_model,
            messages=[
                {"role": "system", "content": SOLUTION_ANALYSIS_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            response_format={"type": "json_object"},
            max_completion_tokens=2000,
        )
    except (RateLimitError, APITimeoutError, APIConnectionError) as exc:
        logger.warning("OpenAI API error for problem %s: %s — retrying", problem_id, exc)
        raise task.retry(exc=exc)

    content = response.choices[0].message.content or "{}"
    analysis = json.loads(content)

    return {
        "problem_id": problem_id,
        "solution_strategy": analysis.get("solution_strategy"),
        "required_concepts": analysis.get("required_concepts", []),
        "solution_steps": analysis.get("solution_steps", []),
        "estimated_time_sec": analysis.get("estimated_time_sec"),
        "common_mistakes": analysis.get("common_mistakes", []),
    }
