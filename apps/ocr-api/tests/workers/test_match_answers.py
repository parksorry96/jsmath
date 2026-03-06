"""Tests for EBS section-aware answer matching."""
from tests.conftest import make_line, make_page
from app.workers.match_answers import _parse_ebs_quick_answer_table


class TestEbsQuickAnswerParsing:
    def test_parse_practice_section(self):
        pages = [make_page(102, [
            make_line("01 지수와 로그", line_number=1),
            make_line("유제", line_number=2),
            make_line("1 ① 2 ③ 3 125 4 ④ 5 ① 6 ② 7 ⑤ 8 ③", line_number=3),
            make_line("9 ③ 10 ①", line_number=4),
            make_line("Level 1 기초 연습", line_number=5),
            make_line("1 ⑤ 2 ⑤ 3 ② 4 ⑤ 5 100 6 5 7 ⑤ 8 ⑤", line_number=6),
        ])]
        result = _parse_ebs_quick_answer_table(pages)
        # Key = (chapter, section_type, local_number)
        assert result[("01", "practice", "1")] == "①"
        assert result[("01", "practice", "3")] == "125"
        assert result[("01", "practice", "10")] == "①"
        assert result[("01", "level1", "1")] == "⑤"
        assert result[("01", "level1", "5")] == "100"

    def test_multiple_chapters(self):
        pages = [make_page(102, [
            make_line("01 지수와 로그", line_number=1),
            make_line("유제", line_number=2),
            make_line("1 ① 2 ③", line_number=3),
            make_line("02 지수함수와 로그함수", line_number=4),
            make_line("유제", line_number=5),
            make_line("1 ② 2 ③", line_number=6),
        ])]
        result = _parse_ebs_quick_answer_table(pages)
        assert result[("01", "practice", "1")] == "①"
        assert result[("02", "practice", "1")] == "②"
