"""Celery task: unified analysis — single GPT call replacing 3 separate workers.

Combines: solution analysis, classification refinement, and exam source detection
into one structured output call for lower latency and better cross-task coherence.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Optional

from openai import APIConnectionError, APITimeoutError, AsyncOpenAI, RateLimitError
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.celery_app import celery
from app.config import settings
from app.database import worker_session
from app.models.problem import Problem, ProblemChoice
from app.schemas.problem import CURRICULUM_TREE, SUBJECTS

logger = logging.getLogger(__name__)

COMMON_SUBJECTS = {"수학I", "수학II"}


# ─── Pydantic output schemas ───


class SolutionStep(BaseModel):
    step: int
    description: str
    concept: str


class ExamSource(BaseModel):
    year: int
    month: int
    type: str  # "수능", "6월모의평가", "9월모의평가", "교육청모의고사"
    number: int


class UnifiedAnalysisResult(BaseModel):
    # Classification
    classification_reasoning: str
    subject: str
    unit_major: str
    unit_minor: Optional[str] = None
    unit_sub: Optional[str] = None
    difficulty_refined: float = Field(ge=1.0, le=5.0)
    is_common: bool
    classification_confidence: float = Field(ge=0.0, le=1.0)

    # Solution analysis
    solution_strategy: str
    required_concepts: list[str]
    solution_steps: list[SolutionStep]
    estimated_time_sec: int = Field(ge=30, le=900)
    common_mistakes: list[str]
    solution_confidence: float = Field(ge=0.0, le=1.0)

    # Exam source (optional)
    exam_source: Optional[ExamSource] = None


# ─── Prompts ───

SYSTEM_PROMPT = """You are a Korean CSAT (수능) math expert specializing in the 2015 개정교육과정.
Your task: classify the problem FIRST, then analyze the solution independently.

## Subjects (2015 개정교육과정)
- 수학I: 지수함수와 로그함수, 삼각함수, 수열. 고2 과정. 수능 공통과목.
- 수학II: 함수의 극한과 연속, 미분(다항함수), 적분(다항함수). 고2 과정. 수능 공통과목.
- 확률과 통계: 경우의 수(순열/조합), 확률, 통계(확률분포/정규분포/통계적 추정). 고2-3 선택과목.
- 미적분: 수열의 극한, 급수, 여러 가지 함수의 미분법(지수/로그/삼각), 여러 가지 적분법, 정적분의 활용. 고3 선택과목.
- 기하: 이차곡선(포물선/타원/쌍곡선), 평면벡터(벡터연산/내적), 공간도형과 공간벡터. 고3 선택과목.

## COMMON MISCLASSIFICATION WARNINGS
- 수열의 극한/급수 → 미적분 (NOT 수학I 수열)
- 함수의 극한 → check carefully: 다항함수 극한 = 수학II, 지수/로그/삼각함수 극한 = 미적분
- 지수/로그 미분 → 미적분 (NOT 수학I)
- 삼각함수 미분 → 미적분 (NOT 수학I)
- 벡터 내적/연산 → 기하 (NOT 수학II)

## Difficulty Scale (수능 기준, 정답률 anchors)
- 1.0 (기초): 교과서 기본 예제. 정답률 90%+. 개념 직접 적용.
- 2.0 (쉬움): 교과서 응용 문제. 정답률 70-90%. 한두 단계 풀이.
- 3.0 (보통): 수능 기본 문항 (2~3점). 정답률 50-70%. 표준적 풀이.
- 4.0 (어려움): 수능 고난도 3점/4점. 정답률 30-50%. 복합 개념, 다단계 추론.
- 5.0 (최상): 킬러문항 (21번, 29번, 30번급). 정답률 30% 미만. 창의적 풀이.

## Difficulty Modifiers
- 빈칸 추론형 (box-type): +0.5
- ㄱㄴㄷ 보기형: +0.5
- 조건 종합형 (다수 조건 결합): +0.3
- 그래프 해석 필요: +0.2

## Curriculum Hierarchy
{curriculum_json}

Respond with valid JSON matching the requested schema."""

USER_PROMPT_TEMPLATE = """## Problem

LaTeX:
{stem_latex}

Plain text:
{stem_text}

{choices_text}

Problem number: {problem_number}

Current classification (may be incorrect):
- Subject: {current_subject}
- Unit Major: {current_unit_major}
- Difficulty: {current_difficulty}

Classify FIRST (explain reasoning), then analyze the solution, then identify exam source if applicable."""


# ─── Celery task ───


@celery.task(
    bind=True,
    name="task.analysis.unified",
    max_retries=3,
    default_retry_delay=10,
    retry_backoff=True,
    acks_late=True,
)
def unified_analysis(self, prev_result=None, *, problem_id: str | None = None) -> dict:
    """Unified analysis: classification + solution + exam source in one GPT call."""
    if prev_result and isinstance(prev_result, dict):
        problem_id = problem_id or prev_result.get("problem_id")
    if not problem_id:
        raise ValueError("problem_id is required")

    return asyncio.run(_unified_analyze(self, problem_id))


async def _unified_analyze(task, problem_id: str) -> dict:
    async with worker_session() as session:
        result = await session.execute(
            select(Problem)
            .options(selectinload(Problem.choices))
            .where(Problem.id == problem_id)
        )
        problem = result.scalar_one_or_none()
        if not problem:
            raise ValueError(f"Problem {problem_id} not found")

        # Extract data before session closes
        choices_text = ""
        if problem.choices:
            choices_lines = []
            for choice in sorted(problem.choices, key=lambda c: c.position):
                choices_lines.append(f"{choice.label} {choice.content_text}")
            choices_text = "Choices:\n" + "\n".join(choices_lines)

        system_prompt = SYSTEM_PROMPT.format(
            curriculum_json=json.dumps(CURRICULUM_TREE, ensure_ascii=False, indent=2),
        )
        user_prompt = USER_PROMPT_TEMPLATE.format(
            stem_latex=problem.stem_latex,
            stem_text=problem.stem_text,
            choices_text=choices_text,
            problem_number=problem.problem_number or "unknown",
            current_subject=problem.subject or "unknown",
            current_unit_major=problem.unit_major or "unknown",
            current_difficulty=problem.difficulty or "unknown",
        )

    # No API key — return heuristic fallback
    if not settings.ai_api_key:
        logger.warning("AI_API_KEY missing; returning heuristic fallback for %s", problem_id)
        return _heuristic_fallback(problem_id)

    client_kwargs: dict = {"api_key": settings.ai_api_key}
    if settings.ai_api_base_url:
        client_kwargs["base_url"] = settings.ai_api_base_url
    client = AsyncOpenAI(**client_kwargs)

    try:
        response = await client.chat.completions.create(
            model=settings.ai_model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            response_format={
                "type": "json_schema",
                "json_schema": {
                    "name": "unified_analysis",
                    "strict": True,
                    "schema": UnifiedAnalysisResult.model_json_schema(),
                },
            },
            max_completion_tokens=3000,
        )
    except (RateLimitError, APITimeoutError, APIConnectionError) as exc:
        logger.warning("OpenAI API error for problem %s: %s — retrying", problem_id, exc)
        raise task.retry(exc=exc)

    content = response.choices[0].message.content or "{}"
    parsed = UnifiedAnalysisResult.model_validate_json(content)

    # Post-validation: enforce subject membership
    subject = parsed.subject
    if subject not in SUBJECTS:
        subject = SUBJECTS[0]

    # Enforce is_common based on subject
    is_common = subject in COMMON_SUBJECTS

    # Clamp difficulty
    difficulty = max(1.0, min(5.0, parsed.difficulty_refined))

    return {
        "problem_id": problem_id,
        # Classification
        "classification_reasoning": parsed.classification_reasoning,
        "subject": subject,
        "unit_major": parsed.unit_major,
        "unit_minor": parsed.unit_minor,
        "unit_sub": parsed.unit_sub,
        "difficulty_refined": round(difficulty, 1),
        "is_common": is_common,
        "classification_confidence": parsed.classification_confidence,
        # Solution
        "solution_strategy": parsed.solution_strategy,
        "required_concepts": parsed.required_concepts,
        "solution_steps": [s.model_dump() for s in parsed.solution_steps],
        "estimated_time_sec": parsed.estimated_time_sec,
        "common_mistakes": parsed.common_mistakes,
        "solution_confidence": parsed.solution_confidence,
        # Exam source
        "exam_source": parsed.exam_source.model_dump() if parsed.exam_source else None,
    }


def _heuristic_fallback(problem_id: str) -> dict:
    """Minimal defaults when no API key is available."""
    return {
        "problem_id": problem_id,
        "classification_reasoning": None,
        "subject": None,
        "unit_major": None,
        "unit_minor": None,
        "unit_sub": None,
        "difficulty_refined": 3.0,
        "is_common": True,
        "classification_confidence": 0.3,
        "solution_strategy": None,
        "required_concepts": [],
        "solution_steps": [],
        "estimated_time_sec": None,
        "common_mistakes": [],
        "solution_confidence": 0.0,
        "exam_source": None,
    }
