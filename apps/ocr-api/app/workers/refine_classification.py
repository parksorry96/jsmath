"""Celery task: refine classification using GPT-4o with CSAT-only taxonomy.

Re-classifies problems with: subject verification, unit correction,
difficulty refinement (1.0-5.0), and is_common determination.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

from openai import APIConnectionError, APITimeoutError, RateLimitError
from sqlalchemy import select

from app.celery_app import celery
from app.config import settings
from app.database import worker_session
from app.models.problem import Problem
from app.schemas.problem import CURRICULUM_TREE, SUBJECTS
from app.services.openai_client import get_openai_client

logger = logging.getLogger(__name__)

REFINE_SYSTEM_PROMPT = """You are a Korean CSAT (수능) math classification expert specializing in the 2015 개정교육과정.

# Goal
Re-classify the problem using only the allowed subjects and the provided curriculum hierarchy.

# Evidence Priority
- Problem content is the primary evidence.
- The provided curriculum hierarchy is the source of truth for valid unit names.
- Current classification is only a weak hint and may be wrong.

# Classification Rules
- subject MUST be one of: 수학I, 수학II, 확률과 통계, 미적분, 기하.
- unit_major, unit_minor, unit_sub must come from the provided curriculum hierarchy.
- Do not invent new unit names or merge unrelated units.
- If the evidence is mixed, choose the closest valid curriculum node and lower confidence.
- difficulty_refined must be a float from 1.0 to 5.0.
- is_common must be true only for 수학I or 수학II.

# Reasoning Field
- reasoning must be a short evidence summary in Korean.
- Explain the decisive concepts, the best-fit subject/unit, and the difficulty basis.
- Do not output hidden chain-of-thought or speculative internal monologue.

# Output Contract
- Return exactly one JSON object with these keys only:
  reasoning, subject, unit_major, unit_minor, unit_sub, difficulty_refined, is_common, confidence
- Do not add markdown, code fences, or extra keys."""

REFINE_USER_PROMPT = """# Allowed Subjects
{subjects}

# Curriculum Hierarchy (2015 개정교육과정)
{curriculum}

# Subject Details
- 수학I: 지수함수와 로그함수, 삼각함수, 수열. 고2 과정. 수능 공통과목.
- 수학II: 함수의 극한과 연속, 미분(다항함수), 적분(다항함수). 고2 과정. 수능 공통과목.
- 확률과 통계: 경우의 수(순열/조합), 확률, 통계(확률분포/정규분포/통계적 추정). 고2-3 선택과목.
- 미적분: 수열의 극한, 급수, 여러 가지 함수의 미분법(지수/로그/삼각), 여러 가지 적분법, 정적분의 활용. 고3 선택과목.
- 기하: 이차곡선(포물선/타원/쌍곡선), 평면벡터(벡터연산/내적), 공간도형과 공간벡터. 고3 선택과목.

# Difficulty Scale (수능 기준)
- 1 (기초): 교과서 기본 예제 수준. 개념 직접 적용.
- 2 (쉬움): 교과서 응용 문제 수준. 한두 단계 풀이.
- 3 (보통): 수능 기본 문항 수준 (2~3점). 표준적 풀이 방법 적용.
- 4 (어려움): 수능 고난도 3점/4점 문항 수준. 복합 개념, 다단계 추론 필요.
- 5 (최상): 킬러문항 (21번, 29번, 30번급). 창의적 풀이, 고도의 추론 필요.

# Problem
<problem_latex>
{stem_latex}
</problem_latex>

<problem_text>
{stem_text}
</problem_text>

# Current Classification Hint
- Subject: {current_subject}
- Unit Major: {current_unit_major}
- Difficulty: {current_difficulty}

# Return JSON
{{
  "reasoning": "This problem involves ... therefore it belongs to ...",
  "subject": "one of the subjects above",
  "unit_major": "대단원 name from curriculum",
  "unit_minor": "중단원 name from curriculum (or null)",
  "unit_sub": "소단원 topic from curriculum (or null)",
  "difficulty_refined": 3.5,
  "is_common": true,
  "confidence": 0.9
}}"""

COMMON_SUBJECTS = {"수학I", "수학II"}


@celery.task(
    bind=True,
    name="task.analysis.refine_classification",
    max_retries=3,
    default_retry_delay=10,
    retry_backoff=True,
    acks_late=True,
)
def refine_classification(
    self: Any,
    previous_result: dict[str, Any] | None = None,
    *,
    problem_id: str | None = None,
) -> dict[str, Any]:
    """Refine classification for a single problem."""
    if previous_result and isinstance(previous_result, dict):
        problem_id = problem_id or previous_result.get("problem_id")
    if not problem_id:
        raise ValueError("problem_id is required")

    return asyncio.run(_refine(self, problem_id))


async def _refine(task: Any, problem_id: str) -> dict[str, Any]:
    async with worker_session() as session:
        result = await session.execute(
            select(Problem).where(Problem.id == problem_id)
        )
        problem = result.scalar_one_or_none()
        if not problem:
            raise ValueError(f"Problem {problem_id} not found")

        user_prompt = REFINE_USER_PROMPT.format(
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

    client = get_openai_client()

    try:
        response = await client.chat.completions.create(
            model=settings.ai_model,
            messages=[
                {"role": "system", "content": REFINE_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            response_format={"type": "json_object"},
            max_completion_tokens=1500,
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


def _heuristic_refine(problem_id: str) -> dict[str, Any]:
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
