"""Tests for EBS textbook segmentation patterns."""
import pytest

from tests.conftest import make_line, make_page
from app.workers.segment_textbook import (
    _extract_exam_header_metadata,
    _match_item_code,
    _match_section_transition,
    _match_example_start,
    _match_past_exam_year,
    _is_inline_block,
    _match_problem_start,
    _rule_based_segment,
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
        assert result == ("1", "예제 1")

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


class TestProblemStartMetadata:
    def test_extracts_exam_header_metadata(self):
        result = _extract_exam_header_metadata(
            "005 ★☆☆ 2014년 6월학평 A형 7번(고2) 자연수 n에 대하여"
        )

        assert result is not None
        assert result["year"] == 2014
        assert result["sourceType"] == "학평"
        assert result["examNumber"] == 7
        assert result["audience"] == "고2"
        assert result["form"] == "A형"
        assert result["rest"] == "자연수 n에 대하여"

    def test_past_exam_header_without_space_after_number_starts_problem(self):
        assert _match_problem_start("154★★★ 2018학년도 경찰대 19번") == ("154", "154", None)

    def test_numeric_display_number_keeps_only_prefix(self):
        assert _match_problem_start("12. 함수 f(x)=x^2일 때") == ("12", "12.", None)

    def test_bracket_display_number_keeps_only_prefix(self):
        assert _match_problem_start("[7] 다음 중 옳은 것은?") == ("7", "[7]", None)

    def test_generic_stem_removes_problem_number_prefix(self):
        pages = [
            make_page(3, [
                make_line("12. 함수 f(x)=x^2일 때", line_number=1),
                make_line("f(2)의 값을 구하시오.", line_number=2),
            ])
        ]

        segments = _rule_based_segment(pages)

        assert len(segments) == 1
        assert segments[0]["display_number"] == "12."
        assert segments[0]["stem_text"] == "함수 f(x)=x^2일 때\nf(2)의 값을 구하시오."

    def test_splits_past_exam_headers_and_removes_header_metadata_from_stem(self):
        pages = [
            make_page(1, [
                make_line("154★★★ 2018학년도 경찰대 19번", line_number=1, line_type="page_info"),
                make_line("정수 d는 다음 조건을 만족시키는 등차수열 {a_n}의 공차이다.", line_number=2),
                make_line("(가) a_1=-2016", line_number=3),
                make_line("155★★★ 2023학년도 경찰대 5번", line_number=4, line_type="page_info"),
                make_line("자연수 n에 대하여 다항식 P(x)의 값을 구하여라.", line_number=5),
            ])
        ]

        segments = _rule_based_segment(pages)

        assert len(segments) == 2
        assert segments[0]["problem_number"] == "154"
        assert segments[0]["stem_text"].startswith("정수 d는 다음 조건을 만족시키는 등차수열")
        assert "2018학년도 경찰대 19번" not in segments[0]["stem_text"]
        assert segments[0]["exam_source"] == {
            "year": 2018,
            "type": "경찰대",
            "label": "경찰대",
            "number": 19,
            "audience": None,
            "form": None,
            "raw": "★★★ 2018학년도 경찰대 19번",
        }
        assert segments[1]["problem_number"] == "155"
        assert segments[1]["stem_text"] == "자연수 n에 대하여 다항식 P(x)의 값을 구하여라."

    def test_force_splits_headerless_followup_problem_after_choice_block(self):
        pages = [
            make_page(13, [
                make_line("057 ★仼舟 2003년 견혐명 1번", line_number=1, line_type="page_info", bbox_x=1140, bbox_y=2109),
                make_line("$4^{1-\\sqrt{3}} \\times 2^{2 \\sqrt{3}-1}$ 의 값은？（2점）", line_number=2, bbox_x=1137, bbox_y=2196),
                make_line("（1）$\\frac{1}{4}$", line_number=3, bbox_x=1135, bbox_y=2279),
                make_line("（2）$\\frac{1}{2}$", line_number=4, bbox_x=1417, bbox_y=2284),
                make_line("（3） 1", line_number=5, bbox_x=1698, bbox_y=2298),
                make_line("（4） 2", line_number=6, bbox_x=1140, bbox_y=2367),
                make_line("（5） 4", line_number=7, bbox_x=1417, bbox_y=2367),
                make_line("$3^{2 \\sqrt{2}} \\times 9^{1-\\sqrt{2}}$ 의 값은? (2점)", line_number=8, bbox_x=1135, bbox_y=286),
                make_line("(1) $\\frac{1}{9}$", line_number=9, bbox_x=1135, bbox_y=397),
                make_line("(2) $\\frac{1}{3}$", line_number=10, bbox_x=1417, bbox_y=397),
                make_line("(3) 1", line_number=11, bbox_x=1698, bbox_y=413),
                make_line("(4) 3", line_number=12, bbox_x=1135, bbox_y=484),
                make_line("(5) 9", line_number=13, bbox_x=1417, bbox_y=484),
            ])
        ]

        segments = _rule_based_segment(pages)

        assert len(segments) == 2
        assert segments[0]["problem_number"] == "57"
        assert segments[0]["stem_text"] == "$4^{1-\\sqrt{3}} \\times 2^{2 \\sqrt{3}-1}$ 의 값은？（2점）"
        assert segments[1]["problem_number"] == "58"
        assert segments[1]["display_number"] == "058"
        assert segments[1]["stem_text"] == "$3^{2 \\sqrt{2}} \\times 9^{1-\\sqrt{2}}$ 의 값은? (2점)"
