"""Tests for EBS section detection — quick answer page."""

from tests.conftest import make_line, make_page
from app.workers.detect_sections import (
    _find_content_start,
    _find_quick_answer_page,
    _looks_like_answer_table_page,
)


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

    def test_detects_answer_table_page_without_explicit_header(self):
        page = make_page(384, [
            make_line("지수 / 문제편 p. 4 해설편 p. 2", line_number=1),
            make_line("\\begin{tabular}{|l|l|l|l|}", line_number=2, line_type="table"),
            make_line("001 (5) 002 (4) 003 (5) 004 (3) 005 (3)", line_number=3),
            make_line("006 (2) 007 (1) 008 (1) 009 4 010 (3)", line_number=4),
        ])

        assert _looks_like_answer_table_page(page) is True
        assert _find_quick_answer_page([page]) == 384

    def test_skips_table_of_contents_page_when_finding_content_start(self):
        pages = [
            make_page(4, [
                make_line("p. 159", line_number=1),
                make_line("p. 227", line_number=2),
                make_line("□", line_number=3),
                make_line("수열의 합", line_number=4),
                make_line("p. 289", line_number=5),
                make_line("p. 417", line_number=6),
                make_line("□", line_number=7),
            ]),
            make_page(6, [
                make_line("001 2016년 4월학평 나형 9번", line_number=1),
                make_line("16의 네제곱근 중 실수인 것을 a라 하자.", line_number=2),
            ]),
        ]

        assert _find_content_start(pages) == 6
