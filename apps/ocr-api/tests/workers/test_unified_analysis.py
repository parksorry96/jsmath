"""Tests for dual-curriculum classification post-processing."""

from app.workers.unified_analysis import (
    BatchItemResult,
    CurriculumClassificationResult,
    _normalize_curriculum_classification,
    _postprocess_batch_item,
)


def test_normalize_curriculum_classification_clears_invalid_subject() -> None:
    classification = CurriculumClassificationResult(
        subject="없는과목",
        unit_major="임의 단원",
        unit_minor="임의 중단원",
        unit_sub="임의 소단원",
        confidence=0.18,
    )

    result = _normalize_curriculum_classification(
        classification,
        curriculum_year=2022,
        allowed_subjects=["공통수학1", "공통수학2"],
    )

    assert result == {
        "curriculumYear": 2022,
        "subject": None,
        "unitMajor": None,
        "unitMinor": None,
        "unitSub": None,
        "curriculumNodeId": None,
        "confidence": 0.18,
    }


def test_postprocess_batch_item_keeps_2015_and_2022_classifications_separate() -> None:
    item = BatchItemResult(
        problem_id="prob-1",
        classification_reasoning="문제의 핵심은 지수함수와 로그함수의 성질이다.",
        classification_2015=CurriculumClassificationResult(
            subject="수학I",
            unit_major="지수함수와 로그함수",
            unit_minor="로그함수",
            unit_sub=None,
            confidence=0.91,
        ),
        classification_2022=CurriculumClassificationResult(
            subject="대수",
            unit_major="지수함수와 로그함수",
            unit_minor="로그함수",
            unit_sub=None,
            confidence=0.88,
        ),
        difficulty_refined=3.4,
        is_common=True,
        solution_tags=["직접계산"],
        solution_strategy="로그의 성질을 이용해 식을 정리한다.",
        required_concepts=["로그함수"],
        solution_steps=[{"step": 1, "description": "식을 정리한다.", "concept": "로그함수"}],
        estimated_time_sec=120,
        common_mistakes=["로그의 밑을 혼동한다."],
        solution_confidence=0.86,
        answer="$2$",
        exam_source=None,
    )

    result = _postprocess_batch_item(item)

    assert result["subject"] == "수학I"
    assert result["unit_major"] == "지수함수와 로그함수"
    assert result["classification_confidence"] == 0.91
    assert result["classification_2015"]["subject"] == "수학I"
    assert result["classification_2022"]["subject"] == "대수"
    assert result["classification_2022"]["confidence"] == 0.88
