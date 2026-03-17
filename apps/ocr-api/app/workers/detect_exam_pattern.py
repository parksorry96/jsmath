"""Celery task: detect CSAT exam patterns.

Uses deterministic rules for position_type and point_value when question number
is known. Falls back to GPT for exam_source identification only.
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
from app.models.problem import AnalysisStatus, PositionType, Problem, QuestionFormat
from app.services.openai_client import get_openai_client

logger = logging.getLogger(__name__)

# ─── Deterministic CSAT rules by question number ───

# Common section (Q1-22)
_COMMON_RULES: dict[int, tuple[PositionType, int, QuestionFormat]] = {}
# Q1-2: 2pt, multiple choice, normal
for _q in range(1, 3):
    _COMMON_RULES[_q] = (PositionType.normal, 2, QuestionFormat.multiple_choice_5)
# Q3-8: 3pt, multiple choice, normal
for _q in range(3, 9):
    _COMMON_RULES[_q] = (PositionType.normal, 3, QuestionFormat.multiple_choice_5)
# Q9-14: 4pt, multiple choice, normal
for _q in range(9, 15):
    _COMMON_RULES[_q] = (PositionType.normal, 4, QuestionFormat.multiple_choice_5)
# Q15: 4pt, multiple choice, semi_killer
_COMMON_RULES[15] = (PositionType.semi_killer, 4, QuestionFormat.multiple_choice_5)
# Q16-19: 3pt, short answer, normal
for _q in range(16, 20):
    _COMMON_RULES[_q] = (PositionType.normal, 3, QuestionFormat.short_answer)
# Q20: 4pt, short answer, semi_killer
_COMMON_RULES[20] = (PositionType.semi_killer, 4, QuestionFormat.short_answer)
# Q21: 4pt, short answer, killer (common killer)
_COMMON_RULES[21] = (PositionType.killer, 4, QuestionFormat.short_answer)
# Q22: 4pt, short answer, semi_killer
_COMMON_RULES[22] = (PositionType.semi_killer, 4, QuestionFormat.short_answer)

# Elective section (Q23-30)
_ELECTIVE_RULES: dict[int, tuple[PositionType, int, QuestionFormat]] = {}
# Q23: 2pt, multiple choice, normal
_ELECTIVE_RULES[23] = (PositionType.normal, 2, QuestionFormat.multiple_choice_5)
# Q24-27: 3pt, multiple choice, normal
for _q in range(24, 28):
    _ELECTIVE_RULES[_q] = (PositionType.normal, 3, QuestionFormat.multiple_choice_5)
# Q28: 4pt, multiple choice, semi_killer
_ELECTIVE_RULES[28] = (PositionType.semi_killer, 4, QuestionFormat.multiple_choice_5)
# Q29-30: 4pt, short answer, killer (elective killers)
_ELECTIVE_RULES[29] = (PositionType.killer, 4, QuestionFormat.short_answer)
_ELECTIVE_RULES[30] = (PositionType.killer, 4, QuestionFormat.short_answer)

_ALL_RULES: dict[int, tuple[PositionType, int, QuestionFormat]] = {
    **_COMMON_RULES,
    **_ELECTIVE_RULES,
}

# Difficulty-based point value fallback (when question number is unknown)
_DIFFICULTY_TO_POINT: dict[int, int] = {
    1: 2,  # 기초 → 2pt
    2: 2,  # 쉬움 → 2pt
    3: 3,  # 보통 → 3pt
    4: 4,  # 어려움 → 4pt
    5: 4,  # 최상 → 4pt
}

EXAM_SOURCE_SYSTEM_PROMPT = """You are a Korean CSAT (수능/모의평가) exam identification expert.

# Goal
Determine whether the problem can be matched to one specific known exam source.

# Decision Policy
- Be conservative. Return a specific exam source only when the evidence is strong enough to support one exact source.
- Topic, difficulty, or question number alone are not sufficient evidence.
- If multiple exams are plausible or the evidence is weak, return null.
- Do not guess year, month, type, or number.

# Output Contract
- Return exactly one JSON object with one key only: exam_source.
- exam_source must be either null or an object with year, month, type, number.
- type must be one of: 수능, 6월모의평가, 9월모의평가, 교육청모의고사.
- Do not add markdown, commentary, or extra keys."""

EXAM_SOURCE_USER_PROMPT = """# Problem
<problem_latex>
{stem_latex}
</problem_latex>

<problem_text>
{stem_text}
</problem_text>

Problem number: {problem_number}

# Return JSON
{{
  "exam_source": {{"year": 2024, "month": 11, "type": "수능", "number": 15}}
}}
or
{{
  "exam_source": null
}}"""


def _parse_question_number(raw: str | None) -> int | None:
    """Extract integer question number from string like '15', '15.', 'Q15'."""
    if not raw:
        return None
    cleaned = raw.strip().lstrip("Qq#").rstrip(".")
    try:
        return int(cleaned)
    except ValueError:
        return None


def _rules_from_number(
    qnum: int | None,
) -> tuple[PositionType, int, QuestionFormat] | None:
    """Look up deterministic CSAT rules by question number."""
    if qnum is None or qnum not in _ALL_RULES:
        return None
    return _ALL_RULES[qnum]


def _point_from_difficulty(difficulty: float | None) -> int:
    """Estimate point value from difficulty when question number is unknown."""
    if difficulty is None:
        return 3
    return _DIFFICULTY_TO_POINT.get(round(difficulty), 3)


def _position_from_difficulty(difficulty: float | None) -> PositionType:
    """Estimate position type from difficulty when question number is unknown."""
    if difficulty is None:
        return PositionType.normal
    if difficulty >= 4.5:
        return PositionType.killer
    if difficulty >= 3.5:
        return PositionType.semi_killer
    return PositionType.normal


@celery.task(
    bind=True,
    name="task.analysis.exam_pattern",
    max_retries=3,
    default_retry_delay=10,
    retry_backoff=True,
    acks_late=True,
)
def detect_exam_pattern(
    self: Any,
    previous_result: dict[str, Any] | None = None,
    *,
    problem_id: str | None = None,
) -> dict[str, Any]:
    """Detect CSAT exam patterns for a single problem."""
    if previous_result and isinstance(previous_result, dict):
        problem_id = problem_id or previous_result.get("problem_id")
    if not problem_id:
        raise ValueError("problem_id is required")

    return asyncio.run(_detect(self, problem_id))


async def _detect(task: Any, problem_id: str) -> dict[str, Any]:
    async with worker_session() as session:
        result = await session.execute(
            select(Problem).where(Problem.id == problem_id)
        )
        problem = result.scalar_one_or_none()
        if not problem:
            raise ValueError(f"Problem {problem_id} not found")

        problem_number_raw = problem.problem_number
        qnum = _parse_question_number(problem_number_raw)
        problem_type_val = problem.problem_type.value if problem.problem_type else "unknown"
        stem_latex = problem.stem_latex
        stem_text = problem.stem_text
        difficulty = problem.difficulty

    # Apply deterministic rules when question number is known
    rules = _rules_from_number(qnum)
    if rules:
        position_type, point_value, question_format = rules
        # Override question_format if problem_type provides explicit info
        if problem_type_val == "short_answer":
            question_format = QuestionFormat.short_answer
        elif problem_type_val == "multiple_choice":
            question_format = QuestionFormat.multiple_choice_5
    else:
        # Fallback: estimate from difficulty
        position_type = _position_from_difficulty(difficulty)
        point_value = _point_from_difficulty(difficulty)
        question_format = (
            QuestionFormat.short_answer
            if problem_type_val == "short_answer"
            else QuestionFormat.multiple_choice_5
        )

    # Use GPT only for exam_source identification
    exam_source = None
    if settings.ai_api_key:
        exam_source = await _identify_exam_source(
            task, problem_id, stem_latex, stem_text,
            problem_number_raw or "unknown",
        )

    logger.info(
        "Exam pattern for %s (Q%s): position=%s, points=%d, format=%s",
        problem_id, qnum, position_type, point_value, question_format,
    )

    return {
        "problem_id": problem_id,
        "exam_source": exam_source,
        "position_type": position_type,
        "point_value": point_value,
        "question_format": question_format,
    }


@celery.task(
    bind=True,
    name="task.analysis.apply_exam_rules",
    acks_late=True,
)
def apply_deterministic_rules(
    self: Any,
    prev_result: dict[str, Any] | None = None,
    *,
    problem_id: str | None = None,
) -> dict[str, Any]:
    """Apply deterministic CSAT exam rules and save analysis results to DB.

    Runs after unified_analysis or legacy merge. Reads problem_number from DB,
    applies position_type/point_value/question_format rules, and persists
    all analysis fields from prev_result.
    """
    if prev_result and isinstance(prev_result, dict):
        problem_id = problem_id or prev_result.get("problem_id")
    if not problem_id:
        raise ValueError("problem_id is required")
    return asyncio.run(_apply_rules(problem_id, prev_result or {}))


async def _apply_rules(
    problem_id: str,
    prev_result: dict[str, Any],
) -> dict[str, Any]:
    async with worker_session() as session:
        result = await session.execute(
            select(Problem).where(Problem.id == problem_id)
        )
        problem = result.scalar_one_or_none()
        if not problem:
            logger.warning("Problem %s not found in DB — skipping deterministic rules", problem_id)
            return {**prev_result, "problem_id": problem_id}

        is_textbook = bool(problem.book_source)

        if is_textbook:
            # Textbook mode: skip CSAT-specific rules entirely
            # position_type, point_value, question_format stay null
            pass
        else:
            # CSAT mode: apply deterministic rules
            qnum = _parse_question_number(problem.problem_number)
            rules = _rules_from_number(qnum)

            if rules:
                position_type, point_value, question_format = rules
                problem.position_type = position_type
                problem.point_value = point_value
                if not problem.question_format:
                    problem.question_format = question_format
            else:
                # Fallback: use difficulty from prev_result or existing
                difficulty = prev_result.get("difficulty_refined") or problem.difficulty_refined or problem.difficulty
                problem.point_value = _point_from_difficulty(difficulty)
                problem.position_type = _position_from_difficulty(difficulty)

        # Save unified analysis results to DB
        field_map = {
            "solution_tags": "solution_tags",
            "solution_strategy": "solution_strategy",
            "required_concepts": "required_concepts",
            "solution_steps": "solution_steps",
            "estimated_time_sec": "estimated_time_sec",
            "common_mistakes": "common_mistakes",
            "classification_2015": "classification_2015",
            "classification_2022": "classification_2022",
            "subject": "subject",
            "unit_major": "unit_major",
            "unit_minor": "unit_minor",
            "unit_sub": "unit_sub",
            "difficulty_refined": "difficulty_refined",
            "is_common": "is_common",
            "classification_confidence": "classification_confidence",
            "solution_confidence": "solution_confidence",
            "exam_source": "exam_source",
        }
        if is_textbook:
            # For textbooks: save AI answer to answer_latex (answer_text has book answer)
            field_map["answer"] = "answer_latex"
        else:
            field_map["answer"] = "answer_text"

        for key, attr in field_map.items():
            val = prev_result.get(key)
            if val is not None and hasattr(problem, attr):
                setattr(problem, attr, val)

        from app.models.curriculum_node import find_curriculum_node

        classification_2015 = prev_result.get("classification_2015") or problem.classification_2015
        if isinstance(classification_2015, dict):
            classification_2015 = dict(classification_2015)
            cls_2015_subject = classification_2015.get("subject")
            cls_2015_major = classification_2015.get("unitMajor")
            cls_2015_minor = classification_2015.get("unitMinor")
            node_2015 = await find_curriculum_node(
                session,
                cls_2015_subject,
                cls_2015_major,
                cls_2015_minor,
                curriculum_year=2015,
            )
            classification_2015["curriculumNodeId"] = node_2015.id if node_2015 else None
            problem.classification_2015 = classification_2015

        classification_2022 = prev_result.get("classification_2022") or problem.classification_2022
        if isinstance(classification_2022, dict):
            classification_2022 = dict(classification_2022)
            cls_2022_subject = classification_2022.get("subject")
            cls_2022_major = classification_2022.get("unitMajor")
            cls_2022_minor = classification_2022.get("unitMinor")
            node_2022 = await find_curriculum_node(
                session,
                cls_2022_subject,
                cls_2022_major,
                cls_2022_minor,
                curriculum_year=2022,
            )
            classification_2022["curriculumNodeId"] = node_2022.id if node_2022 else None
            problem.classification_2022 = classification_2022

        # Link to curriculum node based on classification labels
        _subject = prev_result.get("subject") or problem.subject
        _unit_major = prev_result.get("unit_major") or problem.unit_major
        _unit_minor = prev_result.get("unit_minor") or problem.unit_minor
        if _subject:
            node = await find_curriculum_node(
                session, _subject, _unit_major, _unit_minor, curriculum_year=2015,
            )
            problem.curriculum_node_id = node.id if node else None

        problem.analysis_status = AnalysisStatus.analyzing
        await session.commit()

    merged = {**prev_result, "problem_id": problem_id}
    return merged


async def _identify_exam_source(
    task: Any,
    problem_id: str,
    stem_latex: str,
    stem_text: str,
    problem_number: str,
) -> dict[str, Any] | None:
    """Call GPT to identify exam source only."""
    client = get_openai_client()

    user_prompt = EXAM_SOURCE_USER_PROMPT.format(
        stem_latex=stem_latex,
        stem_text=stem_text,
        problem_number=problem_number,
    )

    try:
        response = await client.chat.completions.create(
            model=settings.ai_model,
            messages=[
                {"role": "system", "content": EXAM_SOURCE_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            response_format={"type": "json_object"},
            temperature=0.1,
            max_completion_tokens=200,
        )
    except (RateLimitError, APITimeoutError, APIConnectionError) as exc:
        logger.warning("OpenAI API error for exam source %s: %s — retrying", problem_id, exc)
        raise task.retry(exc=exc)

    content = response.choices[0].message.content or "{}"
    analysis = json.loads(content)
    return analysis.get("exam_source")
