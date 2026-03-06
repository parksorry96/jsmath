"""Tests for EBS section detection — quick answer page."""

from tests.conftest import make_line, make_page
from app.workers.detect_sections import _find_quick_answer_page


class TestQuickAnswerDetection:
    def test_finds_quick_answer_page(self):
        pages = [
            make_page(100, [make_line("Level 3 실력 완성", line_number=1)]),
            make_page(101, [make_line("대표 기출 문제", line_number=1)]),
            make_page(102, [make_line("한눈에 보는 정답", line_number=1)]),
            make_page(103, [make_line("memo", line_number=1)]),
            make_page(105, [make_line("정답과 풀이", line_number=1)]),
        ]
        assert _find_quick_answer_page(pages) == 102

    def test_no_quick_answer(self):
        pages = [
            make_page(100, [make_line("정답 및 해설", line_number=1)]),
        ]
        assert _find_quick_answer_page(pages) is None
