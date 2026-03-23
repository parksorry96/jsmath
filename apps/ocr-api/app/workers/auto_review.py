"""Celery task: auto-review analyzed problems.

Computes multi-factor composite confidence and determines whether to
auto-approve or keep as pending_review.

Composite confidence factors:
  - AI self-confidence (classification + solution confidence, weight 0.30)
  - Subject/unit consistency with required_concepts (weight 0.25)
  - Difficulty vs estimated_time correlation (weight 0.20)
  - Similar problem subject agreement (weight 0.25)
"""

from __future__ import annotations

import asyncio
import logging
import re
import unicodedata
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.celery_app import celery
from app.database import worker_session
from app.models.exam_meta import ExamQuestionMeta
from app.models.problem import (
    AnalysisStatus,
    Problem,
    ProblemType,
    QuestionFormat,
    ReviewStatus,
)
from app.models.similarity import ProblemSimilarity
from app.schemas.problem import CURRICULUM_TREE, SUBJECTS

logger = logging.getLogger(__name__)

AUTO_APPROVE_THRESHOLD = 0.85

# ─── Composite confidence weights ───
W_AI_CONFIDENCE = 0.30
W_SUBJECT_CONSISTENCY = 0.25
W_DIFFICULTY_TIME = 0.20
W_SIMILAR_AGREEMENT = 0.25

# Difficulty → expected estimated_time_sec ranges (inclusive)
_DIFFICULTY_TIME_RANGES: dict[int, tuple[int, int]] = {
    1: (30, 120),      # 기초
    2: (60, 180),      # 쉬움
    3: (90, 300),      # 보통
    4: (150, 420),     # 약간 어려움
    5: (240, 600),     # 어려움
    6: (360, 900),     # 최상
}

# Concept keywords that loosely map to each subject for consistency check
_SUBJECT_CONCEPT_KEYWORDS: dict[str, list[str]] = {
    "수학I": [
        "지수", "로그", "삼각함수", "사인", "코사인", "탄젠트",
        "수열", "등차", "등비", "귀납법", "시그마",
    ],
    "수학II": [
        "극한", "연속", "미분", "도함수", "접선", "증감", "극대", "극소",
        "최댓값", "최솟값", "적분", "부정적분", "정적분", "넓이",
    ],
    "확률과 통계": [
        "순열", "조합", "확률", "조건부", "독립", "시행",
        "확률분포", "이항분포", "정규분포", "표준편차", "추정",
    ],
    "미적분": [
        "급수", "수렴", "발산", "지수함수 미분", "로그함수 미분",
        "삼각함수 미분", "치환적분", "부분적분", "부피", "회전체",
    ],
    "기하": [
        "포물선", "타원", "쌍곡선", "이차곡선", "초점", "준선",
        "벡터", "내적", "공간좌표", "공간벡터", "직선의 방정식",
    ],
}

_COMMON_SUBJECTS = {"수학I", "수학II"}
_CIRCLED_CHOICE_TO_POSITION = {"①": 1, "②": 2, "③": 3, "④": 4, "⑤": 5}


def _compute_chapter_match(
    subject: str | None, unit_major: str | None, book_source: dict | None,
) -> float:
    """Factor: Does AI subject/unit align with textbook chapter?"""
    if not book_source or not book_source.get("chapter"):
        return 0.5  # neutral
    chapter = book_source["chapter"].lower()
    if subject and subject.lower() in chapter:
        return 1.0
    if unit_major and unit_major.lower() in chapter:
        return 0.9
    # Check reverse: chapter keywords in unit_major
    chapter_keywords = [w for w in chapter.split() if len(w) > 1]
    if unit_major and any(kw in unit_major for kw in chapter_keywords):
        return 0.8
    return 0.3  # likely mismatch


def _normalize_answer(answer: str) -> str:
    """Normalize answer text for comparison."""
    answer = unicodedata.normalize("NFKC", answer).strip()
    circled = {"①": "1", "②": "2", "③": "3", "④": "4", "⑤": "5"}
    for k, v in circled.items():
        answer = answer.replace(k, v)
    answer = answer.replace("\\left", "").replace("\\right", "")
    answer = re.sub(r"\\(?:mathrm|text)\{([^{}]+)\}", r"\1", answer)
    answer = re.sub(r"\\frac\{([^{}]+)\}\{([^{}]+)\}", r"\1/\2", answer)
    answer = answer.replace("$", "")
    answer = re.sub(r"^(?:정답|답|해답)\s*[:：]?\s*", "", answer)
    answer = re.sub(r"\s+", "", answer)
    match = re.fullmatch(r"\(?([1-5])\)?(?:번)?", answer)
    if match:
        return match.group(1)
    return answer.lower()


def _extract_choice_position(answer: str | None) -> int | None:
    if not answer:
        return None

    raw = unicodedata.normalize("NFKC", answer).strip()
    if not raw:
        return None

    for circled, position in _CIRCLED_CHOICE_TO_POSITION.items():
        if answer.strip().startswith(circled):
            return position

    cleaned = raw.replace("$", "").strip()
    cleaned = re.sub(r"^(?:정답|답)\s*[:：]?\s*", "", cleaned)
    match = re.match(r"^\(?\s*([1-5])\s*\)?(?:번)?(?:\b|(?=\s)|$)", cleaned)
    if not match:
        return None
    return int(match.group(1))


def _is_objective_problem(problem: Problem) -> bool:
    if len(problem.choices or []) >= 4:
        return True
    if problem.question_format == QuestionFormat.multiple_choice_5:
        return True
    return problem.problem_type == ProblemType.multiple_choice


def _candidate_exam_subjects(problem: Problem, exam_source: dict[str, Any]) -> list[str] | None:
    hinted_subject = str(exam_source.get("subject") or problem.subject or "").replace(" ", "")
    if not hinted_subject or hinted_subject in {subject.replace(" ", "") for subject in _COMMON_SUBJECTS}:
        return None

    alias_map = {
        "확률과통계": ["확률과통계", "확률과 통계"],
        "미적분": ["미적분"],
        "기하": ["기하"],
        "수학a": ["수학A", "수학(가)"],
        "수학b": ["수학B", "수학(나)"],
        "수학(가)": ["수학(가)", "수학A"],
        "수학(나)": ["수학(나)", "수학B"],
    }
    lowered = hinted_subject.lower()
    for key, candidates in alias_map.items():
        if key in lowered:
            return candidates

    return [str(exam_source.get("subject") or problem.subject)]


def _normalize_exam_type(raw_type: Any, exam_month: int | None) -> str | None:
    normalized = str(raw_type or "").strip().lower()
    if normalized in {"suneung", "수능"}:
        return "suneung"
    if normalized in {"mock_pyeongga", "평가원", "모의평가", "모평"}:
        return "mock_pyeongga"
    if normalized in {"mock_gyoyuk", "교육청", "학평", "학력평가"}:
        return "mock_gyoyuk"
    if exam_month == 11:
        return "suneung"
    if exam_month in {6, 9}:
        return "mock_pyeongga"
    return None


def _compute_answer_cross_check(ai_answer: str | None, problem: Problem) -> float:
    """Factor: Does AI answer match the answer key?"""
    if problem.answer_match_status != "matched" or not problem.answer_text:
        return 0.5  # neutral — no answer key
    ai_norm = _normalize_answer(ai_answer or "")
    book_norm = _normalize_answer(problem.answer_text)
    return 1.0 if ai_norm == book_norm else 0.0


def _has_reference_solution(problem: Problem) -> bool:
    return bool(
        (isinstance(problem.solution_text, str) and problem.solution_text.strip())
        or (isinstance(problem.solution_latex, str) and problem.solution_latex.strip())
    )


def _compute_reference_solution_signal(problem: Problem) -> float:
    return 1.0 if _has_reference_solution(problem) else 0.0


async def _compute_exam_answer_match(
    session: AsyncSession,
    problem: Problem,
    ai_answer: str | None,
) -> bool | None:
    linked_result = await session.execute(
        select(ExamQuestionMeta.correct_answer)
        .where(ExamQuestionMeta.problem_id == problem.id)
        .where(ExamQuestionMeta.correct_answer.isnot(None))
    )
    raw_answers = [row[0] for row in linked_result.all()]
    expected_answers = {
        _normalize_answer(answer)
        for answer in raw_answers
        if answer
    }
    if not expected_answers:
        exam_source = problem.exam_source if isinstance(problem.exam_source, dict) else None
        if not exam_source:
            return None

        exam_year = exam_source.get("year")
        exam_month = exam_source.get("month")
        question_number = exam_source.get("number")
        if not isinstance(exam_year, int) or not isinstance(exam_month, int) or not isinstance(question_number, int):
            return None

        exam_type = _normalize_exam_type(exam_source.get("type"), exam_month)
        if not exam_type:
            return None

        stmt = (
            select(ExamQuestionMeta.correct_answer)
            .where(ExamQuestionMeta.exam_year == exam_year)
            .where(ExamQuestionMeta.exam_month == exam_month)
            .where(ExamQuestionMeta.exam_type == exam_type)
            .where(ExamQuestionMeta.question_number == question_number)
            .where(ExamQuestionMeta.correct_answer.isnot(None))
        )

        is_common = exam_source.get("isCommon") is True or problem.subject in _COMMON_SUBJECTS
        subject_candidates = None if is_common else _candidate_exam_subjects(problem, exam_source)
        if subject_candidates:
            stmt = stmt.where(ExamQuestionMeta.subject.in_(subject_candidates))

        fallback_result = await session.execute(stmt)
        fallback_answers = [row[0] for row in fallback_result.all()]
        expected_answers = {
            _normalize_answer(answer)
            for answer in fallback_answers
            if answer
        }
        if not expected_answers:
            return None
        if subject_candidates is None and len(expected_answers) > 1:
            return None

    ai_norm = _normalize_answer(ai_answer or "")
    return ai_norm in expected_answers


def _compute_exam_structure_match(problem: Problem) -> bool | None:
    exam_source = problem.exam_source if isinstance(problem.exam_source, dict) else None
    if not exam_source:
        return None

    if exam_source.get("type") == "suneung" and exam_source.get("isCommon") is True:
        return problem.subject in {"수학I", "수학II"}

    expected_subject = exam_source.get("subject")
    if exam_source.get("type") == "suneung" and expected_subject:
        return problem.subject == expected_subject

    return None


def _clamp_confidence(raw_confidence: float | None) -> float | None:
    if raw_confidence is None:
        return None
    return max(0.0, min(1.0, raw_confidence))


def _compute_ai_confidence(
    classification_confidence: float | None,
    solution_confidence: float | None,
) -> float:
    """Factor 1: AI self-reported confidence.

    We keep classification and solution confidence separate in storage and
    average the available values only for auto-review scoring.
    """
    parts = [
        value
        for value in (
            _clamp_confidence(classification_confidence),
            _clamp_confidence(solution_confidence),
        )
        if value is not None
    ]
    if not parts:
        return 0.0
    return sum(parts) / len(parts)


def _compute_subject_consistency(
    subject: str | None,
    unit_major: str | None,
    required_concepts: list | None,
) -> float:
    """Factor 2: Do required_concepts align with the classified subject?

    Checks two things:
    - unit_major belongs to the subject's curriculum tree
    - At least one required concept keyword matches the subject
    """
    if not subject or subject not in SUBJECTS:
        return 0.0

    score = 0.0

    # Sub-check A: unit in curriculum tree (0.5 weight within this factor)
    subject_tree = CURRICULUM_TREE.get(subject, {})
    if unit_major and unit_major in subject_tree:
        score += 0.5
    elif not unit_major:
        score += 0.25  # partial credit: no unit is less bad than wrong unit

    # Sub-check B: concept keywords match subject (0.5 weight within this factor)
    if required_concepts and len(required_concepts) > 0:
        keywords = _SUBJECT_CONCEPT_KEYWORDS.get(subject, [])
        if keywords:
            concepts_lower = " ".join(str(c) for c in required_concepts).lower()
            matches = sum(1 for kw in keywords if kw in concepts_lower)
            if matches >= 2:
                score += 0.5
            elif matches == 1:
                score += 0.3
            # 0 matches → 0 added
        else:
            score += 0.25  # no keywords defined for subject
    else:
        score += 0.1  # no concepts at all is suspicious

    return score


def _compute_difficulty_time_correlation(
    difficulty_refined: float | None,
    estimated_time_sec: int | None,
) -> float:
    """Factor 3: Does difficulty correlate with estimated solve time?

    Harder problems should take longer. We check if the estimated time
    falls within the expected range for the given difficulty level.
    """
    if difficulty_refined is None or estimated_time_sec is None:
        return 0.5  # neutral when data is missing

    d = round(difficulty_refined)
    d = max(1, min(6, d))
    low, high = _DIFFICULTY_TIME_RANGES[d]

    if low <= estimated_time_sec <= high:
        return 1.0  # perfect correlation

    # Compute how far off we are (graceful degradation)
    if estimated_time_sec < low:
        deviation = low - estimated_time_sec
        tolerance = max(low, 60)  # at least 60s tolerance
    else:
        deviation = estimated_time_sec - high
        tolerance = max(high, 120)

    # Score decreases linearly with deviation
    return max(0.0, 1.0 - (deviation / tolerance))


async def _compute_similar_agreement(
    session: AsyncSession,
    problem_id: str,
    subject: str | None,
) -> float:
    """Factor 4: Do top similar problems share the same subject?

    If most similar problems agree on the subject, it's a good signal.
    """
    if not subject:
        return 0.0

    result = await session.execute(
        select(
            ProblemSimilarity.similar_problem_id,
            ProblemSimilarity.similarity_score,
        )
        .where(ProblemSimilarity.problem_id == problem_id)
        .order_by(ProblemSimilarity.similarity_score.desc())
        .limit(5)
    )
    rows = result.all()

    if not rows:
        return 0.5  # no similar problems found → neutral

    # Fetch subjects of similar problems
    similar_ids = [r[0] for r in rows]
    sub_result = await session.execute(
        select(Problem.id, Problem.subject)
        .where(Problem.id.in_(similar_ids))
        .where(Problem.subject.isnot(None))
    )
    similar_subjects = {r[0]: r[1] for r in sub_result.all()}

    if not similar_subjects:
        return 0.5  # similar problems have no classification yet

    # Weighted agreement: higher-similarity matches count more
    weighted_agree = 0.0
    weight_sum = 0.0
    for sim_id, sim_score in rows:
        if sim_id in similar_subjects:
            weighted_agree += sim_score * (1.0 if similar_subjects[sim_id] == subject else 0.0)
            weight_sum += sim_score

    if weight_sum == 0:
        return 0.5

    return weighted_agree / weight_sum


@celery.task(
    bind=True,
    name="task.analysis.auto_review",
    max_retries=2,
    default_retry_delay=5,
    acks_late=True,
)
def auto_review(
    self: Any,
    previous_result: dict[str, Any] | None = None,
    *,
    problem_id: str | None = None,
) -> dict[str, Any]:
    """Auto-review a problem after all analysis stages complete."""
    if previous_result and isinstance(previous_result, dict):
        problem_id = problem_id or previous_result.get("problem_id")
    if not problem_id:
        raise ValueError("problem_id is required")

    return asyncio.run(_review(problem_id))


async def _review(problem_id: str) -> dict[str, Any]:
    checks = []
    factors = {}

    async with worker_session() as session:
        result = await session.execute(
            select(Problem)
            .options(selectinload(Problem.choices))
            .where(Problem.id == problem_id)
        )
        problem = result.scalar_one_or_none()
        if not problem:
            raise ValueError(f"Problem {problem_id} not found")

        is_textbook = bool(problem.book_source)
        has_reference_solution = _has_reference_solution(problem)
        ai_answer = problem.answer_latex if is_textbook else problem.answer_text

        # ─── Hard checks (must pass for auto-approve) ───

        # Check 1: Subject is valid CSAT subject
        subject_valid = problem.subject in SUBJECTS
        checks.append(("subject_valid", subject_valid))

        # Check 2: Unit matches subject in curriculum tree
        unit_matches = False
        if problem.subject and problem.unit_major:
            subject_tree = CURRICULUM_TREE.get(problem.subject, {})
            unit_matches = problem.unit_major in subject_tree
        checks.append(("unit_matches_subject", unit_matches))

        # Check 3: explanation metadata exists
        if has_reference_solution:
            checks.append(("has_reference_solution", has_reference_solution))
        else:
            has_strategy = bool(problem.solution_strategy)
            checks.append(("has_solution_strategy", has_strategy))

        # Check 4: Required concepts populated
        has_concepts = bool(problem.required_concepts and len(problem.required_concepts) > 0)
        checks.append(("has_required_concepts", has_concepts))

        # Check 5: Difficulty is reasonable
        difficulty_ok = (
            problem.difficulty_refined is not None
            and 1.0 <= problem.difficulty_refined <= 6.0
        )
        checks.append(("difficulty_in_range", difficulty_ok))

        if _is_objective_problem(problem):
            has_objective_choices = len(problem.choices or []) >= 4
            checks.append(("objective_choices_present", has_objective_choices))

            choice_position = _extract_choice_position(ai_answer)
            valid_choice_positions = {choice.position for choice in problem.choices or []}
            answer_format_ok = choice_position is not None and (
                not valid_choice_positions or choice_position in valid_choice_positions
            )
            checks.append(("objective_answer_format_ok", answer_format_ok))

        exam_structure_match = _compute_exam_structure_match(problem)
        if exam_structure_match is not None:
            checks.append(("exam_structure_match", exam_structure_match))

        if not is_textbook:
            exam_answer_match = await _compute_exam_answer_match(session, problem, ai_answer)
            if exam_answer_match is not None:
                checks.append(("exam_answer_match", exam_answer_match))

        # ─── Multi-factor composite confidence ───

        factors["classification_confidence"] = round(
            _clamp_confidence(problem.classification_confidence) or 0.0, 4
        )
        factors["solution_confidence"] = round(
            _clamp_confidence(problem.solution_confidence) or 0.0, 4
        )

        f_ai = _compute_ai_confidence(
            problem.classification_confidence,
            problem.solution_confidence,
        )
        factors["ai_confidence"] = f_ai

        f_subject = _compute_subject_consistency(
            problem.subject, problem.unit_major, problem.required_concepts,
        )
        factors["subject_consistency"] = f_subject

        f_time = _compute_difficulty_time_correlation(
            problem.difficulty_refined, problem.estimated_time_sec,
        )
        factors["difficulty_time_correlation"] = f_time

        f_similar = await _compute_similar_agreement(
            session, problem_id, problem.subject,
        )
        factors["similar_agreement"] = f_similar

        if is_textbook:
            f_chapter = _compute_chapter_match(
                problem.subject, problem.unit_major, problem.book_source,
            )
            factors["chapter_match"] = f_chapter

            f_reference_solution = _compute_reference_solution_signal(problem)
            factors["reference_solution"] = f_reference_solution

            has_answer_key = problem.answer_match_status == "matched"
            if has_answer_key:
                composite = (
                    0.20 * f_ai
                    + 0.15 * f_subject
                    + 0.10 * f_time
                    + 0.15 * f_similar
                    + 0.20 * f_chapter
                    + 0.20 * f_reference_solution
                )
                threshold = 0.80
            else:
                composite = (
                    0.25 * f_ai
                    + 0.20 * f_subject
                    + 0.10 * f_time
                    + 0.15 * f_similar
                    + 0.15 * f_chapter
                    + 0.15 * f_reference_solution
                )
                threshold = 0.85
        else:
            composite = (
                W_AI_CONFIDENCE * f_ai
                + W_SUBJECT_CONSISTENCY * f_subject
                + W_DIFFICULTY_TIME * f_time
                + W_SIMILAR_AGREEMENT * f_similar
            )
            threshold = AUTO_APPROVE_THRESHOLD

        factors["composite"] = round(composite, 4)

        # Check 6: Composite confidence above threshold
        confidence_ok = composite >= threshold
        checks.append(("confidence_above_threshold", confidence_ok))

        # ─── Decision ───

        all_passed = all(passed for _, passed in checks)
        failed_checks = [name for name, passed in checks if not passed]

        if all_passed:
            problem.review_status = ReviewStatus.auto_approved
            decision = "auto_approved"
        else:
            problem.review_status = ReviewStatus.pending_review
            decision = "pending_review"

        # Preserve model confidences and store review confidence separately.
        problem.review_confidence = composite

        # Mark analysis as complete
        problem.analysis_status = AnalysisStatus.completed
        problem.analyzed_at = datetime.now(timezone.utc)
        await session.commit()

    logger.info(
        "Auto-review for %s: %s (composite=%.3f, factors=%s, failed=%s)",
        problem_id,
        decision,
        composite,
        {k: round(v, 3) for k, v in factors.items()},
        failed_checks or "none",
    )

    return {
        "problem_id": problem_id,
        "decision": decision,
        "checks": {name: passed for name, passed in checks},
        "confidence_factors": {k: round(v, 4) for k, v in factors.items()},
        "failed_checks": failed_checks,
    }
