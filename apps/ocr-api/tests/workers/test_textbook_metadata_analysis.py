"""Tests for textbook metadata analysis post-processing."""

from app.workers.textbook_metadata_analysis import (
    TextbookMetadataAnalysisResult,
    _postprocess_textbook_metadata_result,
)
from app.workers.unified_analysis import CurriculumClassificationResult


def test_postprocess_textbook_metadata_clears_ai_solution_fields() -> None:
    parsed = TextbookMetadataAnalysisResult(
        classification_reasoning="지수와 로그의 성질을 활용하는 문제다.",
        classification_2015=CurriculumClassificationResult(
            subject="수학I",
            unit_major="지수함수와 로그함수",
            unit_minor="로그함수",
            unit_sub=None,
            confidence=0.92,
        ),
        classification_2022=CurriculumClassificationResult(
            subject="대수",
            unit_major="지수함수와 로그함수",
            unit_minor="로그함수",
            unit_sub=None,
            confidence=0.88,
        ),
        difficulty_refined=3.4,
        solution_tags=["직접계산", "없는태그"],
        required_concepts=["로그함수", "지수함수"],
        estimated_time_sec=150,
    )

    result = _postprocess_textbook_metadata_result("problem-1", parsed)

    assert result["analysis_mode"] == "textbook_metadata_v1"
    assert result["subject"] == "수학I"
    assert result["classification_confidence"] == 0.92
    assert result["solution_tags"] == ["직접계산"]
    assert result["required_concepts"] == ["로그함수", "지수함수"]
    assert result["solution_strategy"] is None
    assert result["solution_steps"] == []
    assert result["common_mistakes"] == []
    assert result["solution_confidence"] is None
    assert result["answer"] is None
