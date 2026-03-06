"""Integration test: EBS 수능특강 segmentation with section state machine."""
import pytest
from tests.conftest import make_line, make_page
from app.workers.segment_textbook import _rule_based_segment


def _build_ebs_chapter_pages():
    """Build mock OCR pages simulating a minimal EBS 수능특강 chapter."""
    pages = []

    # Page 5: 예제 1 + 잠깐의 + 풀이 + 유제 1,2
    pages.append(make_page(5, [
        make_line("예제 1 거듭제곤근", line_number=1),
        make_line("³√(27/³√27) × ⁵√9의 값은?", line_number=2),
        make_line("① ³√3  ② √3  ③ 1  ④ 3  ⑤ 9", line_number=3),
        make_line("잠깐이", line_number=4),
        make_line("a>0, b>0이고 m, n이 2 이상의 자연수일 때", line_number=5),
        make_line("풀이", line_number=6),
        make_line("³√27=³√3³=3, ⁵√9=⁵√3²=³√3이므로", line_number=7),
        make_line("답 ④", line_number=8),
        make_line("유제", line_number=9),
        make_line("[26008-0001]", line_number=10),
        make_line("1", line_number=11),
        make_line("⁵√(-3.2)×10⁶의 값은?", line_number=12),
        make_line("① -20  ② -16  ③ -12  ④ -8  ⑤ -4", line_number=13),
        make_line("[26008-0002]", line_number=14),
        make_line("2", line_number=15),
        make_line("8 이하의 자연수 a, b에 대하여", line_number=16),
        make_line("① 2  ② 3  ③ 4  ④ 5  ⑤ 6", line_number=17),
    ]))

    # Page 14: Level 1 기초 연습
    pages.append(make_page(14, [
        make_line("Level 1 기초 연습", line_number=1),
        make_line("[26008-0011]", line_number=2),
        make_line("1", line_number=3),
        make_line("⁴√81 × ⁶√8의 값은?", line_number=4),
        make_line("① √2  ② √3  ③ 2  ④ √5  ⑤ √6", line_number=5),
        make_line("[26008-0012]", line_number=6),
        make_line("2", line_number=7),
        make_line("두 양수 a, b에 대하여 (a+b)⁻¹=2일 때", line_number=8),
        make_line("① 1/36  ② 1/18  ③ 1/12  ④ 1/9  ⑤ 5/36", line_number=9),
    ]))

    return pages


class TestEbsSegmentation:
    def test_detects_example(self):
        pages = _build_ebs_chapter_pages()
        segments = _rule_based_segment(pages)
        examples = [s for s in segments if s.get("section_type") == "example"]
        assert len(examples) == 1
        assert examples[0]["display_number"] == "예제 1 거듭제곤근"
        assert examples[0]["inline_answer"] == "④"

    def test_detects_practice_with_item_codes(self):
        pages = _build_ebs_chapter_pages()
        segments = _rule_based_segment(pages)
        practice = [s for s in segments if s.get("section_type") == "practice"]
        assert len(practice) == 2
        assert practice[0]["item_code"] == "26008-0001"
        assert practice[1]["item_code"] == "26008-0002"

    def test_detects_level1_with_item_codes(self):
        pages = _build_ebs_chapter_pages()
        segments = _rule_based_segment(pages)
        level1 = [s for s in segments if s.get("section_type") == "level1"]
        assert len(level1) == 2
        assert level1[0]["item_code"] == "26008-0011"
        assert level1[1]["item_code"] == "26008-0012"

    def test_number_reset_distinguished(self):
        """유제 1번과 Level1 1번이 별도 문제로 구분되는지 확인."""
        pages = _build_ebs_chapter_pages()
        segments = _rule_based_segment(pages)
        ones = [s for s in segments if s.get("local_number") == "1"]
        # 예제1, 유제1, Level1-1 = 3 separate problems
        assert len(ones) == 3
        types = {s["section_type"] for s in ones}
        assert types == {"example", "practice", "level1"}

    def test_total_problem_count(self):
        pages = _build_ebs_chapter_pages()
        segments = _rule_based_segment(pages)
        # 1 예제 + 2 유제 + 2 Level1 = 5
        assert len(segments) == 5

    def test_inline_solution_captured(self):
        pages = _build_ebs_chapter_pages()
        segments = _rule_based_segment(pages)
        examples = [s for s in segments if s.get("section_type") == "example"]
        assert examples[0]["inline_solution"] is not None
        assert "³√27" in examples[0]["inline_solution"]

    def test_inline_hint_captured(self):
        pages = _build_ebs_chapter_pages()
        segments = _rule_based_segment(pages)
        examples = [s for s in segments if s.get("section_type") == "example"]
        assert examples[0]["inline_hint"] is not None
