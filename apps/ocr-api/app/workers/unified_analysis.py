"""Celery task: unified analysis — single GPT call replacing 3 separate workers.

Combines: solution analysis, classification refinement, and exam source detection
into one structured output call for lower latency and better cross-task coherence.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Optional

from openai import APIConnectionError, APITimeoutError, RateLimitError
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.celery_app import celery
from app.config import settings
from app.services.openai_client import get_openai_client
from app.database import worker_session
from app.models.problem import Problem, ProblemChoice
from app.schemas.problem import CURRICULUM_TREE, SUBJECTS

logger = logging.getLogger(__name__)

COMMON_SUBJECTS = {"수학I", "수학II"}

# ─── Textbook-specific prompts ───

TEXTBOOK_SYSTEM_PROMPT = """You are a Korean math textbook (교재) analysis expert for 2015 개정교육과정.

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

## Difficulty Scale (교재 기준 → 수능 환산)
- 1.0: 개념 확인 문제. 공식 직접 대입.
- 2.0: 기본 연습 문제. 한두 단계 풀이.
- 3.0: 응용 문제. 2-3개 개념 복합. 수능 기본 수준.
- 4.0: 심화/도전 문제. 다단계 추론. 수능 3-4점 수준.
- 5.0: 최고난도. 경시 수준. 수능 킬러 이상.

## Curriculum Hierarchy
{curriculum_json}

## Textbook Context Usage
교재 단원 정보는 STRONG PRIOR입니다. 문제 내용이 명백히 다른 단원이 아닌 한 교재 단원을 따르세요.
단, 교재 단원명과 교육과정 단원명이 다를 수 있으니 문제 내용으로 최종 판단하세요.
예: "미분법" → 다항함수만이면 수학II, 지수/로그/삼각함수면 미적분

## Answer Key Usage
해설지 정답이 주어지면:
1. 독립적으로 풀이하세요
2. 답이 다르면 classification_reasoning에 이유 명시
3. 해설지 오류 가능성이 있으면 지적

## IMPORTANT: Language
- ALL text fields MUST be written in Korean (한국어). English only for math notation/LaTeX.

Respond with valid JSON matching the requested schema."""

TEXTBOOK_USER_PROMPT = """## Problem
LaTeX: {stem_latex}
Plain text: {stem_text}
{choices_text}
Problem number: {problem_number}

## Textbook Context
교재: {book_title} ({publisher})
단원: {chapter} > {section}
문제 카테고리: {problem_category}

## Answer Key
해설지 정답: {answer_text}
해설지 풀이: {solution_text}
매칭 상태: {answer_match_status}

Classify FIRST using textbook context, then analyze solution.
IMPORTANT: Provide final answer in 'answer' field."""


def _make_strict_schema(schema: dict) -> dict:
    """Post-process Pydantic JSON schema for OpenAI strict structured output.

    Recursively adds additionalProperties: false to all object types,
    ensures all properties are listed in required, and removes unsupported
    keys like 'default' and 'title'.
    """
    schema = {k: v for k, v in schema.items() if k not in ("default", "title")}

    if schema.get("type") == "object":
        schema["additionalProperties"] = False
        if "properties" in schema:
            schema["required"] = list(schema["properties"].keys())
            schema["properties"] = {
                k: _make_strict_schema(v)
                for k, v in schema["properties"].items()
            }

    if "$defs" in schema:
        schema["$defs"] = {
            k: _make_strict_schema(v) for k, v in schema["$defs"].items()
        }

    if "anyOf" in schema:
        schema["anyOf"] = [_make_strict_schema(s) for s in schema["anyOf"]]

    if "items" in schema and isinstance(schema["items"], dict):
        schema["items"] = _make_strict_schema(schema["items"])

    return schema


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
    answer: str  # Final answer (e.g. "③", "24", "1/2")

    # Exam source (optional)
    exam_source: Optional[ExamSource] = None


class BatchItemResult(UnifiedAnalysisResult):
    problem_id: str


class BatchAnalysisResponse(BaseModel):
    results: list[BatchItemResult]


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

## IMPORTANT: Language
- ALL text fields (classification_reasoning, solution_strategy, required_concepts, solution_steps descriptions, common_mistakes) MUST be written in Korean (한국어).
- Do NOT use English for any descriptive text. Only use English for mathematical notation/LaTeX.

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

Classify FIRST (explain reasoning), then analyze the solution, then identify exam source if applicable.
IMPORTANT: You MUST provide the final answer in the 'answer' field (e.g. "③", "24", "\\frac{1}{2}")."""


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

    try:
        return asyncio.run(analyze_problem(problem_id))
    except (RateLimitError, APITimeoutError, APIConnectionError, ValidationError, ValueError) as exc:
        raise self.retry(exc=exc)


async def analyze_problem(problem_id: str, max_retries: int = 3) -> dict:
    """Standalone async analysis with built-in retry. Used by batch processing."""
    last_exc: Exception | None = None
    for attempt in range(max_retries + 1):
        try:
            return await _unified_analyze(problem_id)
        except (RateLimitError, APITimeoutError, APIConnectionError, ValidationError, ValueError) as exc:
            last_exc = exc
            if attempt < max_retries:
                wait = 10 * (attempt + 1)
                logger.warning(
                    "Retry %d/%d for %s: %s", attempt + 1, max_retries, problem_id, exc,
                )
                await asyncio.sleep(wait)
    raise last_exc  # type: ignore[misc]


async def _unified_analyze(problem_id: str) -> dict:
    """Core GPT analysis — raises exceptions on failure (no Celery retry)."""
    async with worker_session() as session:
        result = await session.execute(
            select(Problem)
            .options(selectinload(Problem.choices))
            .where(Problem.id == problem_id)
        )
        problem = result.scalar_one_or_none()
        if not problem:
            raise ValueError(f"Problem {problem_id} not found")

        choices_text = ""
        if problem.choices:
            choices_lines = []
            for choice in sorted(problem.choices, key=lambda c: c.position):
                choices_lines.append(f"{choice.label} {choice.content_text}")
            choices_text = "Choices:\n" + "\n".join(choices_lines)

        is_textbook = bool(problem.book_source)

        curriculum_json = json.dumps(CURRICULUM_TREE, ensure_ascii=False, indent=2)

        if is_textbook:
            book_source = problem.book_source or {}
            system_prompt = TEXTBOOK_SYSTEM_PROMPT.format(
                curriculum_json=curriculum_json,
            )
            user_prompt = TEXTBOOK_USER_PROMPT.format(
                stem_latex=problem.stem_latex,
                stem_text=problem.stem_text,
                choices_text=choices_text,
                problem_number=problem.problem_number or "",
                book_title=book_source.get("title", ""),
                publisher=book_source.get("publisher", ""),
                chapter=book_source.get("chapter", ""),
                section=book_source.get("section", ""),
                problem_category=book_source.get("problem_category", ""),
                answer_text=problem.answer_text or "없음",
                solution_text=problem.solution_text or "없음",
                answer_match_status=problem.answer_match_status or "no_answer_key",
            )
        else:
            system_prompt = SYSTEM_PROMPT.format(
                curriculum_json=curriculum_json,
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

    if not settings.ai_api_key:
        logger.warning("AI_API_KEY missing; returning heuristic fallback for %s", problem_id)
        return _heuristic_fallback(problem_id)

    client = get_openai_client()

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
                "schema": _make_strict_schema(UnifiedAnalysisResult.model_json_schema()),
            },
        },
    )

    content = response.choices[0].message.content
    finish_reason = response.choices[0].finish_reason

    if not content or content.strip() in ("{}", ""):
        raise ValueError(f"Empty GPT response for {problem_id} (finish_reason={finish_reason})")

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
        "answer": parsed.answer,
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
        "answer": None,
        "exam_source": None,
    }


# ─── Batch analysis (multiple problems in one GPT call) ───


def _format_choices_text(problem: Problem) -> str:
    if not problem.choices:
        return ""
    lines = [
        f"{c.label} {c.content_text}"
        for c in sorted(problem.choices, key=lambda c: c.position)
    ]
    return "Choices:\n" + "\n".join(lines)


def _format_problem_section(problem: Problem, choices_text: str) -> str:
    """Format a single problem for inclusion in a batch prompt."""
    if problem.book_source:
        bs = problem.book_source or {}
        return (
            f"## Problem (ID: {problem.id})\n"
            f"LaTeX: {problem.stem_latex}\n"
            f"Plain text: {problem.stem_text}\n"
            f"{choices_text}\n"
            f"Problem number: {problem.problem_number or ''}\n\n"
            f"Textbook Context:\n"
            f"교재: {bs.get('title', '')} ({bs.get('publisher', '')})\n"
            f"단원: {bs.get('chapter', '')} > {bs.get('section', '')}\n"
            f"문제 카테고리: {bs.get('problem_category', '')}\n\n"
            f"Answer Key:\n"
            f"해설지 정답: {problem.answer_text or '없음'}\n"
            f"해설지 풀이: {problem.solution_text or '없음'}\n"
            f"매칭 상태: {problem.answer_match_status or 'no_answer_key'}"
        )
    return (
        f"## Problem (ID: {problem.id})\n"
        f"LaTeX: {problem.stem_latex}\n"
        f"Plain text: {problem.stem_text}\n"
        f"{choices_text}\n"
        f"Problem number: {problem.problem_number or 'unknown'}\n\n"
        f"Current classification (may be incorrect):\n"
        f"- Subject: {problem.subject or 'unknown'}\n"
        f"- Unit Major: {problem.unit_major or 'unknown'}\n"
        f"- Difficulty: {problem.difficulty or 'unknown'}"
    )


def _postprocess_batch_item(item: BatchItemResult) -> dict:
    """Post-process a single batch result item into a plain dict."""
    subject = item.subject if item.subject in SUBJECTS else SUBJECTS[0]
    is_common = subject in COMMON_SUBJECTS
    difficulty = max(1.0, min(5.0, item.difficulty_refined))

    return {
        "problem_id": item.problem_id,
        "classification_reasoning": item.classification_reasoning,
        "subject": subject,
        "unit_major": item.unit_major,
        "unit_minor": item.unit_minor,
        "unit_sub": item.unit_sub,
        "difficulty_refined": round(difficulty, 1),
        "is_common": is_common,
        "classification_confidence": item.classification_confidence,
        "solution_strategy": item.solution_strategy,
        "required_concepts": item.required_concepts,
        "solution_steps": [s.model_dump() for s in item.solution_steps],
        "estimated_time_sec": item.estimated_time_sec,
        "common_mistakes": item.common_mistakes,
        "solution_confidence": item.solution_confidence,
        "answer": item.answer,
        "exam_source": item.exam_source.model_dump() if item.exam_source else None,
    }


async def analyze_problems_batch(problem_ids: list[str], max_retries: int = 3) -> list[dict]:
    """Batch analyze problems in a single GPT call with retry."""
    last_exc: Exception | None = None
    for attempt in range(max_retries + 1):
        try:
            return await _batch_analyze(problem_ids)
        except (RateLimitError, APITimeoutError, APIConnectionError, ValidationError, ValueError) as exc:
            last_exc = exc
            if attempt < max_retries:
                wait = 10 * (attempt + 1)
                logger.warning(
                    "Batch retry %d/%d for %d problems: %s",
                    attempt + 1, max_retries, len(problem_ids), exc,
                )
                await asyncio.sleep(wait)
    raise last_exc  # type: ignore[misc]


async def _batch_analyze(problem_ids: list[str]) -> list[dict]:
    """Core batch GPT analysis — multiple problems in one API call."""
    async with worker_session() as session:
        result = await session.execute(
            select(Problem)
            .options(selectinload(Problem.choices))
            .where(Problem.id.in_(problem_ids))
        )
        problems = {p.id: p for p in result.scalars().all()}

    missing = [pid for pid in problem_ids if pid not in problems]
    if missing:
        raise ValueError(f"Problems not found: {missing}")

    # All problems in a batch share the same type (exam or textbook)
    first = problems[problem_ids[0]]
    is_textbook = bool(first.book_source)

    curriculum_json = json.dumps(CURRICULUM_TREE, ensure_ascii=False, indent=2)
    if is_textbook:
        system_prompt = TEXTBOOK_SYSTEM_PROMPT.format(curriculum_json=curriculum_json)
    else:
        system_prompt = SYSTEM_PROMPT.format(curriculum_json=curriculum_json)

    # Build per-problem sections
    sections = []
    for pid in problem_ids:
        p = problems[pid]
        sections.append(_format_problem_section(p, _format_choices_text(p)))

    user_prompt = (
        f"Analyze ALL {len(problem_ids)} problems below. "
        f"Return one result per problem in the 'results' array, "
        f"in the EXACT SAME ORDER as listed. "
        f"Each result MUST include the correct problem_id.\n\n"
        + "\n\n---\n\n".join(sections)
    )

    if not settings.ai_api_key:
        logger.warning("AI_API_KEY missing; returning heuristic fallback for batch")
        return [_heuristic_fallback(pid) for pid in problem_ids]

    client = get_openai_client()

    response = await client.chat.completions.create(
        model=settings.ai_model,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        response_format={
            "type": "json_schema",
            "json_schema": {
                "name": "batch_analysis",
                "strict": True,
                "schema": _make_strict_schema(BatchAnalysisResponse.model_json_schema()),
            },
        },
    )

    content = response.choices[0].message.content
    finish_reason = response.choices[0].finish_reason

    if not content or content.strip() in ("{}", ""):
        raise ValueError(f"Empty GPT response for batch (finish_reason={finish_reason})")

    parsed = BatchAnalysisResponse.model_validate_json(content)

    if len(parsed.results) != len(problem_ids):
        logger.warning(
            "Batch result count mismatch: expected %d, got %d",
            len(problem_ids), len(parsed.results),
        )

    return [_postprocess_batch_item(item) for item in parsed.results]
