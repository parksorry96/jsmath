"""Tests for EBS section-aware answer matching."""
from app.workers.match_answers import (
    _canonicalize_answer_text,
    _parse_answer_section,
    _parse_ebs_quick_answer_table,
    _parse_quick_answer_table,
)
from tests.conftest import make_line, make_page


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


def test_parse_quick_answer_table_handles_dot_delimited_exam_summary_lines() -> None:
    pages = [make_page(1, [
        make_line("01. ③ 02. ② 03. ① 04. ④ 05. ⑤", line_number=1),
        make_line("16. ⑤ 17. ③ 18. ③ 19. ⑤ 20. ⑤", line_number=2),
        make_line("21. ② 22. 15 23. 8 24. 60 25. 160", line_number=3),
        make_line("11. (1) 12. (4) 13. (3)", line_number=4),
    ])]

    result = _parse_quick_answer_table(pages)

    assert result["1"] == "3"
    assert result["5"] == "5"
    assert result["16"] == "5"
    assert result["22"] == "15"
    assert result["11"] == "(1)"
    assert result["12"] == "(4)"


def test_parse_answer_section_skips_quick_answer_summary_and_keeps_first_solution_line() -> None:
    pages = [make_page(1, [
        make_line("01. ③ 02. ② 03. ① 04. ④ 05. ⑤", line_number=1),
        make_line("1. 풀이의 첫 줄", line_number=2),
        make_line("식을 정리한다.", line_number=3),
        make_line("③", line_number=4),
        make_line("2. 다음 풀이", line_number=5),
        make_line("답 (2)", line_number=6),
    ])]

    result = _parse_answer_section(pages)

    assert result["1"]["answer_text"] == "③"
    assert result["1"]["solution_text"] == "풀이의 첫 줄\n식을 정리한다."
    assert result["2"]["answer_text"] == "(2)"
    assert result["2"]["solution_text"] == "다음 풀이"


def test_canonicalize_answer_text_normalizes_multiple_choice_markers_only() -> None:
    assert _canonicalize_answer_text("(2)", "multiple_choice") == "②"
    assert _canonicalize_answer_text("답 3", "multiple_choice") == "③"
    assert _canonicalize_answer_text("2", "short_answer") == "2"
