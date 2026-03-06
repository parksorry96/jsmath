"""Tests for EBS textbook segmentation patterns."""
import pytest

from app.workers.segment_textbook import (
    _match_item_code,
    _match_section_transition,
    _match_example_start,
    _match_past_exam_year,
    _is_inline_block,
)


class TestItemCodePattern:
    def test_standard_code(self):
        assert _match_item_code("[26008-0001]") == "26008-0001"

    def test_code_with_surrounding_text(self):
        assert _match_item_code("  [26008-0123]  ") == "26008-0123"

    def test_no_code(self):
        assert _match_item_code("regular text") is None

    def test_partial_code(self):
        assert _match_item_code("[26008]") is None

    def test_code_in_problem_line(self):
        assert _match_item_code("[26008-0001]") == "26008-0001"


class TestSectionTransition:
    def test_level_1(self):
        result = _match_section_transition("Level 1 기초 연습")
        assert result == ("level1", "Level 1 기초 연습")

    def test_level_2(self):
        result = _match_section_transition("Level 2 기본 연습")
        assert result == ("level2", "Level 2 기본 연습")

    def test_level_3(self):
        result = _match_section_transition("Level 3 실력 완성")
        assert result == ("level3", "Level 3 실력 완성")

    def test_practice_header(self):
        result = _match_section_transition("유제")
        assert result == ("practice", "유제")

    def test_past_exam_header(self):
        result = _match_section_transition("대표 기출 문제")
        assert result == ("past_exam", "대표 기출 문제")

    def test_quick_answer_header(self):
        result = _match_section_transition("한눈에 보는 정답")
        assert result == ("quick_answer", "한눈에 보는 정답")

    def test_regular_text(self):
        assert _match_section_transition("일반 텍스트") is None

    def test_chapter_header(self):
        assert _match_section_transition("01 지수와 로그") is None


class TestExampleStart:
    def test_standard_example(self):
        result = _match_example_start("예제 1 거듭제곤근")
        assert result == ("1", "예제 1 거듭제곤근")

    def test_example_number_only(self):
        result = _match_example_start("예제 3")
        assert result == ("3", "예제 3")

    def test_not_example(self):
        assert _match_example_start("유제 1") is None


class TestPastExamYear:
    def test_suneung(self):
        assert _match_past_exam_year("2023학년도 수능") == "2023학년도 수능"

    def test_mock_exam(self):
        assert _match_past_exam_year("2025학년도 수능") == "2025학년도 수능"

    def test_regular_text(self):
        assert _match_past_exam_year("일반 텍스트") is None


class TestInlineBlock:
    def test_jamkani(self):
        assert _is_inline_block("잠깐이") is True

    def test_puri(self):
        assert _is_inline_block("풀이") is True

    def test_answer_marker(self):
        assert _is_inline_block("답 ④") is True
        assert _is_inline_block("답 125") is True

    def test_exam_intent(self):
        assert _is_inline_block("출제 의도") is True

    def test_exam_trend(self):
        assert _is_inline_block("출제 경향") is True

    def test_regular_text(self):
        assert _is_inline_block("일반 수학 문제 텍스트") is False
