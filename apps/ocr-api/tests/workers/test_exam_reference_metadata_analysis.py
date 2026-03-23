"""Tests for exam reference metadata analysis post-processing."""

from app.workers.exam_reference_metadata_analysis import (
    ExamReferenceMetadataAnalysisResult,
    _postprocess_exam_reference_metadata_result,
)
from app.workers.unified_analysis import CurriculumClassificationResult


def test_postprocess_exam_reference_metadata_clears_ai_solution_fields() -> None:
    parsed = ExamReferenceMetadataAnalysisResult(
        classification_reasoning="미분계수와 접선 개념이 핵심이다.",
        classification_2015=CurriculumClassificationResult(
            subject="수학II",
            unit_major="미분",
            unit_minor="접선의 방정식",
            unit_sub=None,
            confidence=0.89,
        ),
        classification_2022=CurriculumClassificationResult(
            subject="미적분I",
            unit_major="미분",
            unit_minor="도함수의 활용",
            unit_sub=None,
            confidence=0.84,
        ),
        difficulty_refined=3.8,
        solution_tags=["미분활용"],
        required_concepts=["미분계수", "접선의 방정식"],
        estimated_time_sec=180,
    )

    result = _postprocess_exam_reference_metadata_result("problem-1", parsed)

    assert result["analysis_mode"] == "exam_reference_metadata_v1"
    assert result["subject"] == "수학II"
    assert result["solution_tags"] == ["미분활용"]
    assert result["required_concepts"] == ["미분계수", "접선의 방정식"]
    assert result["solution_strategy"] is None
    assert result["solution_steps"] == []
    assert result["common_mistakes"] == []
    assert result["solution_confidence"] is None
    assert result["answer"] is None
