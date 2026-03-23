"""Tests for auto-review confidence helpers."""

import pytest

from app.models.problem import ProblemType, QuestionFormat
from app.workers.auto_review import (
    _compute_answer_cross_check,
    _compute_ai_confidence,
    _compute_exam_answer_match,
    _compute_exam_structure_match,
    _compute_reference_solution_signal,
    _extract_choice_position,
    _has_reference_solution,
    _is_objective_problem,
)


def test_compute_ai_confidence_averages_classification_and_solution() -> None:
    assert _compute_ai_confidence(0.9, 0.7) == 0.8


def test_compute_ai_confidence_uses_single_available_signal() -> None:
    assert _compute_ai_confidence(0.82, None) == 0.82
    assert _compute_ai_confidence(None, 0.64) == 0.64


def test_compute_ai_confidence_clamps_each_signal_before_averaging() -> None:
    assert _compute_ai_confidence(1.2, -0.2) == 0.5


def test_compute_exam_structure_match_requires_common_csat_questions_to_stay_in_common_subjects() -> None:
    class ProblemStub:
        exam_source = {"type": "suneung", "isCommon": True}
        subject = "기하"

    assert _compute_exam_structure_match(ProblemStub()) is False


def test_extract_choice_position_handles_prefixed_choice_answers() -> None:
    assert _extract_choice_position("③") == 3
    assert _extract_choice_position("③ $8$") == 3
    assert _extract_choice_position("(4)") == 4
    assert _extract_choice_position("$14$") is None


def test_compute_answer_cross_check_normalizes_parenthesized_choice_answers() -> None:
    class ProblemStub:
        answer_match_status = "matched"
        answer_text = "(2)"

    assert _compute_answer_cross_check("②", ProblemStub()) == 1.0


def test_is_objective_problem_uses_question_format_and_choices() -> None:
    class ProblemStub:
        question_format = QuestionFormat.multiple_choice_5
        problem_type = ProblemType.short_answer
        choices = []

    assert _is_objective_problem(ProblemStub()) is True

    class ProblemWithChoices:
        question_format = None
        problem_type = ProblemType.short_answer
        choices = [1, 2, 3, 4]

    assert _is_objective_problem(ProblemWithChoices()) is True


@pytest.mark.asyncio
async def test_compute_exam_answer_match_falls_back_to_exam_source_lookup() -> None:
    class ResultStub:
        def __init__(self, values: list[str]) -> None:
            self._values = values

        def all(self) -> list[tuple[str]]:
            return [(value,) for value in self._values]

    class SessionStub:
        def __init__(self) -> None:
            self._results = [
                ResultStub([]),
                ResultStub(["1", "1", "1"]),
            ]

        async def execute(self, _query):  # type: ignore[no-untyped-def]
            return self._results.pop(0)

    class ProblemStub:
        id = "problem-1"
        subject = "수학I"
        exam_source = {
            "year": 2025,
            "month": 11,
            "type": "suneung",
            "number": 8,
            "isCommon": True,
        }

    matched = await _compute_exam_answer_match(SessionStub(), ProblemStub(), "①")

    assert matched is True


def test_has_reference_solution_detects_text_or_latex() -> None:
    class ProblemStub:
        solution_text = "교재 해설"
        solution_latex = None

    assert _has_reference_solution(ProblemStub()) is True

    class LatexOnlyStub:
        solution_text = "   "
        solution_latex = "$x=1$"

    assert _has_reference_solution(LatexOnlyStub()) is True


def test_compute_reference_solution_signal_returns_zero_when_missing() -> None:
    class ProblemStub:
        solution_text = None
        solution_latex = None

    assert _compute_reference_solution_signal(ProblemStub()) == 0.0
