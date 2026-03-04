"""Celery task: analyze solution strategy using OpenAI GPT-4o.

Extracts: solution_strategy, required_concepts, solution_steps,
estimated_time_sec, common_mistakes.
"""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone

from openai import AsyncOpenAI
from sqlalchemy import select

from app.celery_app import celery
from app.config import settings
from app.database import worker_session
from app.models.problem import AnalysisStatus, Problem

logger = logging.getLogger(__name__)

SOLUTION_ANALYSIS_PROMPT = """You are a Korean CSAT (수능) math education expert. Analyze the following math problem.

Problem (LaTeX):
{stem_latex}

Problem (plain text):
{stem_text}

{choices_text}

Provide a detailed analysis in JSON format:
{{
  "solution_strategy": "Step-by-step explanation of how to solve this problem (Korean)",
  "required_concepts": ["concept1", "concept2", ...],
  "solution_steps": [
    {{"step": 1, "description": "description in Korean", "concept": "related concept"}},
    ...
  ],
  "estimated_time_sec": 120,
  "common_mistakes": ["mistake1 in Korean", "mistake2 in Korean", ...]
}}

Rules:
- solution_strategy: Clear, concise explanation a student can follow
- required_concepts: List of Korean math concepts needed (e.g., "이차방정식의 근의 공식", "판별식")
- solution_steps: Ordered steps with the specific math concept used in each
- estimated_time_sec: Realistic time for an average student (60-300 seconds typical)
- common_mistakes: Typical errors students make on this type of problem

Respond with JSON only."""


@celery.task(
    bind=True,
    name="task.analysis.solution",
    max_retries=3,
    default_retry_delay=10,
    retry_backoff=True,
    acks_late=True,
)
def analyze_solution(self, previous_result=None, *, problem_id: str | None = None) -> dict:
    """Analyze a single problem's solution strategy using GPT-4o."""
    if previous_result and isinstance(previous_result, dict):
        problem_id = problem_id or previous_result.get("problem_id")
    if not problem_id:
        raise ValueError("problem_id is required")

    return asyncio.run(_analyze(self, problem_id))


async def _analyze(task, problem_id: str) -> dict:
    async with worker_session() as session:
        result = await session.execute(
            select(Problem).where(Problem.id == problem_id)
        )
        problem = result.scalar_one_or_none()
        if not problem:
            raise ValueError(f"Problem {problem_id} not found")

        # Build choices text if available
        choices_text = ""
        if problem.choices:
            choices_lines = []
            for choice in sorted(problem.choices, key=lambda c: c.position):
                choices_lines.append(f"{choice.label} {choice.content_text}")
            choices_text = "Choices:\n" + "\n".join(choices_lines)

        prompt = SOLUTION_ANALYSIS_PROMPT.format(
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

    client_kwargs: dict = {"api_key": settings.ai_api_key}
    if settings.ai_api_base_url:
        client_kwargs["base_url"] = settings.ai_api_base_url
    client = AsyncOpenAI(**client_kwargs)

    response = await client.chat.completions.create(
        model=settings.ai_model,
        messages=[{"role": "user", "content": prompt}],
        response_format={"type": "json_object"},
        temperature=0.3,
        max_completion_tokens=1000,
    )

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
