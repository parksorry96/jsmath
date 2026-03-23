"""Textbook-only metadata analysis worker.

Keeps file-based solutions as the source of truth and asks the model only for
classification metadata such as curriculum mapping and required skills.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, Literal

from openai import APIConnectionError, APITimeoutError, RateLimitError
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.celery_app import celery
from app.config import settings
from app.database import worker_session
from app.models.problem import Problem
from app.schemas.problem import SOLUTION_STRATEGY_TAGS, SUBJECTS_2015, SUBJECTS_2022
from app.services.openai_client import get_openai_client
from app.workers.unified_analysis import (
    COMMON_SUBJECTS,
    CURRICULUM_TREE_2015,
    CURRICULUM_TREE_2022,
    CurriculumClassificationResult,
    SUBJECT_DETAILS_2015,
    SUBJECT_DETAILS_2022,
    _book_source_value,
    _build_exam_context_hint,
    _make_strict_schema,
    _normalize_curriculum_classification,
    _pick_primary_classification,
    _render_prompt,
)

logger = logging.getLogger(__name__)

TEXTBOOK_METADATA_SYSTEM_PROMPT = """You are a Korean math textbook metadata analyst.

## Goal
Return only problem-bank metadata for a textbook problem.
Do not generate student-facing 풀이, 단계별 해설, alternative solution, or final answer.

## Required Output
You must return only these metadata fields:
1. dual curriculum classification (2015 / 2022)
2. classification_reasoning
3. difficulty_refined
4. required_concepts
5. solution_tags
6. estimated_time_sec

## Dual Curriculum Mapping
You must classify every problem twice and keep the two mappings separate:
1. classification_2015: best-fit mapping within the 2015 revised curriculum.
2. classification_2022: best-fit mapping within the 2022 revised curriculum.
If one curriculum does not meaningfully cover the concept, set that curriculum's subject/unit fields to null and keep confidence low.

## Subjects (2015 개정교육과정)
{subject_details_2015}

## Subjects (2022 개정교육과정)
{subject_details_2022}

## COMMON MISCLASSIFICATION WARNINGS
- 수열의 극한/급수 → 2015에서는 미적분, 2022에서는 미적분II
- 함수의 극한 → 다항함수 극한은 2015 수학II / 2022 미적분I, 지수·로그·삼각함수 극한은 2015 미적분 / 2022 미적분II
- 지수/로그/삼각함수 미분 → 2015 미적분, 2022 미적분II
- 벡터 내적/연산 → 2015 기하, 2022 기하

## Difficulty Scale (교재 기준 → 수능 환산)
- 1.0: 개념 확인 문제. 공식 직접 대입. 수능 정답률 90%+.
- 2.0: 기본 연습 문제. 한두 단계 풀이. 수능 정답률 75~90%.
- 3.0: 응용 문제. 2-3개 개념 복합. 수능 정답률 55~75%.
- 4.0: 심화 문제. 개념 응용/변형. 수능 정답률 35~55%.
- 5.0: 고난도 문제. 복합 개념, 준킬러급. 수능 정답률 15~35%.
- 6.0: 최고난도. 킬러 문항. 수능 정답률 15% 미만.

## 2015 Curriculum Hierarchy
{curriculum_2015_json}

## 2022 Curriculum Hierarchy
{curriculum_2022_json}

## Evidence Priority
1. 문제 본문과 선택지
2. 교재 단원 정보 (strong prior)
3. 정답 파일의 정답/풀이 (metadata extraction helper only)

## Textbook Context Usage
교재 단원 정보는 STRONG PRIOR입니다. 문제 내용이 명백히 다른 단원이 아닌 한 교재 단원을 따르세요.
정답 파일의 풀이/해설은 분류와 필요한 스킬 추출의 보조 근거로만 사용하세요.
정답 파일 내용을 그대로 요약하거나 학생용 해설처럼 다시 쓰지 마세요.

## Output Boundaries
- final answer를 새로 계산하거나 answer field를 만들지 마세요.
- solution_strategy, solution_steps, common_mistakes 같은 해설형 필드는 만들지 마세요.
- required_concepts는 실제로 필요한 개념만 2~6개로 제한하세요.
- solution_tags는 제공된 목록에서 1~4개만 고르세요.
- classification_reasoning은 2~4문장 분량의 짧은 근거 요약만 쓰세요.

## Uncertainty Handling
- 각 교육과정 hierarchy에 없는 단원명을 invent하지 마세요.
- 근거가 약하면 가장 가까운 유효 단원을 선택하거나 null로 두고 confidence를 낮추세요.
- 숨겨진 chain-of-thought를 그대로 쓰지 마세요.

## Solution Strategy Tags
Select 1-4 tags from this list that best describe the skills or approach actually needed:
{solution_tags_json}
- Pick only tags that directly apply.
- Order by relevance.

## IMPORTANT: Language
- ALL text fields MUST be written in Korean (한국어). English only for math notation/LaTeX.

## Output Contract
- Return exactly one JSON object matching the requested schema.
- Do not add markdown, code fences, commentary, or extra keys.

## Self-Check
- classification_2015 subject/unit fields must align with the 2015 curriculum hierarchy or be null.
- classification_2022 subject/unit fields must align with the 2022 curriculum hierarchy or be null.
- required_concepts should be short, specific, and non-duplicative.
- solution_tags must be chosen from the provided list only.
- Do not output any explanation text beyond classification_reasoning."""

TEXTBOOK_METADATA_USER_PROMPT = """## Problem
<problem_latex>
{stem_latex}
</problem_latex>

<problem_text>
{stem_text}
</problem_text>

{choices_text}

Problem number: {problem_number}

## Textbook Context
교재: {book_title} ({publisher})
단원: {chapter} > {section}
문제 카테고리: {problem_category}

## Reference Answer Materials
정답 파일 정답: {answer_text}
정답 파일 풀이: {solution_text}
매칭 상태: {answer_match_status}

## Exam Structure Hint
{exam_context_hint}

## Task
- 교재 단원 정보를 strong prior로 사용해 먼저 분류하세요.
- 2015 교육과정과 2022 교육과정에 대해 각각 별도로 분류하세요.
- DB 메타데이터만 추출하세요: 상세 분류, 난이도, 필요한 개념, 풀이 스킬 태그, 예상 풀이시간.
- 학생용 해설이나 정답을 새로 작성하지 마세요.
- 정답 파일 내용은 복사하지 말고, 메타데이터 추출 보조 근거로만 사용하세요."""


class TextbookMetadataAnalysisResult(BaseModel):
    analysis_mode: Literal["textbook_metadata_v1"] = "textbook_metadata_v1"
    classification_reasoning: str
    classification_2015: CurriculumClassificationResult
    classification_2022: CurriculumClassificationResult
    difficulty_refined: float = Field(ge=1.0, le=6.0)
    solution_tags: list[str] = Field(default_factory=list)
    required_concepts: list[str] = Field(default_factory=list)
    estimated_time_sec: int = Field(ge=30, le=900)


def _postprocess_textbook_metadata_result(
    problem_id: str,
    parsed: TextbookMetadataAnalysisResult,
) -> dict[str, Any]:
    classification_2015 = _normalize_curriculum_classification(
        parsed.classification_2015,
        curriculum_year=2015,
        allowed_subjects=SUBJECTS_2015,
    )
    classification_2022 = _normalize_curriculum_classification(
        parsed.classification_2022,
        curriculum_year=2022,
        allowed_subjects=SUBJECTS_2022,
    )
    primary_classification = _pick_primary_classification(
        classification_2015,
        classification_2022,
    )
    subject = primary_classification["subject"]
    difficulty = max(1.0, min(6.0, parsed.difficulty_refined))
    valid_tags = [tag for tag in parsed.solution_tags if tag in SOLUTION_STRATEGY_TAGS]
    required_concepts = [
        concept.strip()
        for concept in parsed.required_concepts
        if isinstance(concept, str) and concept.strip()
    ]

    return {
        "problem_id": problem_id,
        "analysis_mode": parsed.analysis_mode,
        "classification_reasoning": parsed.classification_reasoning,
        "classification_2015": classification_2015,
        "classification_2022": classification_2022,
        "primary_curriculum_year": primary_classification["curriculum_year"],
        "subject": subject,
        "unit_major": primary_classification["unit_major"],
        "unit_minor": primary_classification["unit_minor"],
        "unit_sub": primary_classification["unit_sub"],
        "difficulty_refined": round(difficulty, 1),
        "is_common": subject in COMMON_SUBJECTS if subject else None,
        "classification_confidence": primary_classification["confidence"],
        "solution_tags": valid_tags,
        "required_concepts": required_concepts,
        "estimated_time_sec": parsed.estimated_time_sec,
        "solution_strategy": None,
        "solution_steps": [],
        "common_mistakes": [],
        "solution_confidence": None,
        "answer": None,
        "exam_source": None,
    }


@celery.task(
    bind=True,
    name="task.analysis.textbook_metadata",
    max_retries=3,
    default_retry_delay=10,
    retry_backoff=True,
    acks_late=True,
)
def textbook_metadata_analysis(
    self: Any,
    prev_result: dict[str, Any] | None = None,
    *,
    problem_id: str | None = None,
) -> dict[str, Any]:
    if prev_result and isinstance(prev_result, dict):
        problem_id = problem_id or prev_result.get("problem_id")
    if not problem_id:
        raise ValueError("problem_id is required")

    try:
        return asyncio.run(analyze_textbook_metadata(problem_id))
    except (RateLimitError, APITimeoutError, APIConnectionError, ValidationError, ValueError) as exc:
        raise self.retry(exc=exc)


async def analyze_textbook_metadata(
    problem_id: str,
    max_retries: int = 3,
    *,
    model: str | None = None,
) -> dict[str, Any]:
    last_exc: Exception | None = None
    for attempt in range(max_retries + 1):
        try:
            return await _analyze_textbook_metadata(problem_id, model=model)
        except (RateLimitError, APITimeoutError, APIConnectionError, ValidationError, ValueError) as exc:
            last_exc = exc
            if attempt < max_retries:
                wait = 2 * (attempt + 1)
                logger.warning(
                    "Textbook metadata retry %d/%d for %s: %s",
                    attempt + 1,
                    max_retries,
                    problem_id,
                    exc,
                )
                await asyncio.sleep(wait)
    raise last_exc  # type: ignore[misc]


async def _analyze_textbook_metadata(
    problem_id: str,
    *,
    model: str | None = None,
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
        if not problem.book_source:
            raise ValueError(f"Problem {problem_id} is not a textbook problem")

        choices_text = ""
        if problem.choices:
            choices_lines = []
            for choice in sorted(problem.choices, key=lambda c: c.position):
                choices_lines.append(f"{choice.label} {choice.content_text}")
            choices_text = "Choices:\n" + "\n".join(choices_lines)

        book_source = problem.book_source or {}
        system_prompt = _render_prompt(
            TEXTBOOK_METADATA_SYSTEM_PROMPT,
            curriculum_2015_json=json.dumps(CURRICULUM_TREE_2015, ensure_ascii=False, indent=2),
            curriculum_2022_json=json.dumps(CURRICULUM_TREE_2022, ensure_ascii=False, indent=2),
            subject_details_2015=SUBJECT_DETAILS_2015,
            subject_details_2022=SUBJECT_DETAILS_2022,
            solution_tags_json=json.dumps(SOLUTION_STRATEGY_TAGS, ensure_ascii=False),
        )
        user_prompt = _render_prompt(
            TEXTBOOK_METADATA_USER_PROMPT,
            stem_latex=problem.stem_latex,
            stem_text=problem.stem_text,
            choices_text=choices_text,
            problem_number=problem.problem_number or "",
            book_title=book_source.get("title", ""),
            publisher=book_source.get("publisher", ""),
            chapter=book_source.get("chapter", ""),
            section=book_source.get("section", ""),
            problem_category=_book_source_value(book_source, "problemCategory", "problem_category"),
            answer_text=problem.answer_text or "없음",
            solution_text=problem.solution_text or "없음",
            answer_match_status=problem.answer_match_status or "no_answer_key",
            exam_context_hint=_build_exam_context_hint(problem) or "- 별도 시험 구조 힌트 없음",
        )

    if not settings.ai_api_key:
        logger.warning("AI_API_KEY missing; returning heuristic textbook metadata for %s", problem_id)
        return {
            "problem_id": problem_id,
            "analysis_mode": "textbook_metadata_v1",
            "classification_reasoning": None,
            "classification_2015": None,
            "classification_2022": None,
            "subject": None,
            "unit_major": None,
            "unit_minor": None,
            "unit_sub": None,
            "difficulty_refined": 3.0,
            "is_common": None,
            "classification_confidence": 0.3,
            "solution_tags": [],
            "required_concepts": [],
            "estimated_time_sec": 180,
            "solution_strategy": None,
            "solution_steps": [],
            "common_mistakes": [],
            "solution_confidence": None,
            "answer": None,
            "exam_source": None,
        }

    client = get_openai_client()
    model_name = model or settings.ai_model

    response = await client.chat.completions.create(
        model=model_name,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        response_format={
            "type": "json_schema",
            "json_schema": {
                "name": "textbook_metadata_analysis",
                "strict": True,
                "schema": _make_strict_schema(TextbookMetadataAnalysisResult.model_json_schema()),
            },
        },
    )

    content = response.choices[0].message.content
    finish_reason = response.choices[0].finish_reason
    if not content or content.strip() in ("{}", ""):
        raise ValueError(f"Empty textbook metadata response for {problem_id} (finish_reason={finish_reason})")

    parsed = TextbookMetadataAnalysisResult.model_validate_json(content)
    return _postprocess_textbook_metadata_result(problem_id, parsed)
