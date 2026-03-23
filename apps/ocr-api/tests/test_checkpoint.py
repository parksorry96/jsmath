"""Tests for pipeline checkpoint stage ordering."""

from app.services.checkpoint import get_stage_order


def test_get_stage_order_includes_answer_matching_for_exam_with_answers() -> None:
    assert get_stage_order("exam_with_answers") == [
        "ocr_submit",
        "ocr_poll",
        "parse_results",
        "segment_problems",
        "match_answers",
        "finalize",
    ]
