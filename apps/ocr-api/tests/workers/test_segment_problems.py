"""Tests for general exam problem segmentation."""

from app.workers.segment_problems import (
    _annotate_exam_segments,
    _build_exam_page_contexts,
    _filter_dual_form_pages,
    _rule_based_segment,
)
from tests.conftest import make_line, make_page


class TestGeneralProblemSegmentation:
    def test_splits_inline_choices_and_marks_multiple_choice(self):
        pages = [
            make_page(1, [
                make_line("12. 함수 f(x)=x^2일 때 옳은 것은?", line_number=1),
                make_line("① f(1)=0  ② f(1)=1  ③ f(2)=2  ④ f(2)=3  ⑤ f(2)=4", line_number=2),
            ])
        ]

        segments = _rule_based_segment(pages)

        assert len(segments) == 1
        problem = segments[0]
        assert problem.problem_type == "multiple_choice"
        assert problem.choices is not None
        assert len(problem.choices) == 5
        assert [choice.label for choice in problem.choices] == ["①", "②", "③", "④", "⑤"]
        assert problem.choices[0].content_text == "f(1)=0"
        assert problem.choices[4].content_text == "f(2)=4"
        assert "① f(1)=0" not in problem.stem_text
        assert problem.stem_text == "12. 함수 f(x)=x^2일 때 옳은 것은?"

    def test_ignores_preface_lines_before_first_problem(self):
        pages = [
            make_page(1, [
                make_line("(8) 전라북도교육청", line_number=1, bbox_x=120, bbox_y=80),
                make_line("1. 두 수의 합은?", line_number=2, bbox_x=140, bbox_y=140),
                make_line("(1) 1", line_number=3, bbox_x=180, bbox_y=190),
                make_line("(2) 2", line_number=4, bbox_x=260, bbox_y=190),
                make_line("(3) 3", line_number=5, bbox_x=340, bbox_y=190),
                make_line("(4) 4", line_number=6, bbox_x=420, bbox_y=190),
                make_line("(5) 5", line_number=7, bbox_x=500, bbox_y=190),
            ])
        ]

        segments = _rule_based_segment(pages)

        assert len(segments) == 1
        assert segments[0].problem_number == "1"
        assert "(8) 전라북도교육청" not in segments[0].stem_text

    def test_keeps_right_column_choices_with_inferred_boundary(self):
        pages = [
            make_page(1, [
                make_line("1. 왼쪽 문제", line_number=1, bbox_x=150, bbox_y=120),
                make_line("(1) A", line_number=2, bbox_x=190, bbox_y=180),
                make_line("(2) B", line_number=3, bbox_x=280, bbox_y=180),
                make_line("(3) C", line_number=4, bbox_x=370, bbox_y=180),
                make_line("(4) D", line_number=5, bbox_x=460, bbox_y=180),
                make_line("(5) E", line_number=6, bbox_x=550, bbox_y=180),
                make_line("3．오른쪽 문제", line_number=7, bbox_x=1083, bbox_y=420),
                make_line("(1) 10", line_number=8, bbox_x=1116, bbox_y=500),
                make_line("(2) 20", line_number=9, bbox_x=1282, bbox_y=500),
                make_line("(3) 30", line_number=10, bbox_x=1444, bbox_y=500),
                make_line("(4) 40", line_number=11, bbox_x=1608, bbox_y=500),
                make_line("(5) 50", line_number=12, bbox_x=1772, bbox_y=500),
                make_line("4．다음 문제", line_number=13, bbox_x=1087, bbox_y=760),
            ])
        ]

        segments = _rule_based_segment(pages)

        assert [segment.problem_number for segment in segments] == ["1", "3", "4"]
        right_problem = segments[1]
        assert right_problem.problem_type == "multiple_choice"
        assert right_problem.choices is not None
        assert len(right_problem.choices) == 5
        assert [choice.content_text for choice in right_problem.choices] == [
            "10",
            "20",
            "30",
            "40",
            "50",
        ]

    def test_recognizes_fullwidth_problem_markers_across_pages(self):
        pages = [
            make_page(1, [
                make_line("16. 오른쪽 열 문제", line_number=1, bbox_x=1083, bbox_y=120),
                make_line("(1) 1", line_number=2, bbox_x=1116, bbox_y=180),
                make_line("(2) 2", line_number=3, bbox_x=1282, bbox_y=180),
                make_line("(3) 3", line_number=4, bbox_x=1444, bbox_y=180),
                make_line("(4) 4", line_number=5, bbox_x=1608, bbox_y=180),
                make_line("(5) 5", line_number=6, bbox_x=1772, bbox_y=180),
            ]),
            make_page(2, [
                make_line("17．왼쪽 열 문제", line_number=1, bbox_x=157, bbox_y=120),
                make_line("18．오른쪽 열 문제", line_number=2, bbox_x=1088, bbox_y=120),
            ]),
        ]

        segments = _rule_based_segment(pages)

        assert [segment.problem_number for segment in segments] == ["16", "17", "18"]
        assert "17．" not in segments[0].stem_text

    def test_column_boundary_ignores_wide_choice_spread_in_same_column(self):
        pages = [
            make_page(1, [
                make_line("8. 왼쪽 위 문제", line_number=1, bbox_x=157, bbox_y=120),
                make_line("9. 왼쪽 아래 문제", line_number=2, bbox_x=155, bbox_y=820),
                make_line("10. 오른쪽 문제", line_number=3, bbox_x=1088, bbox_y=120),
                make_line("오른쪽 열 설명", line_number=4, bbox_x=1116, bbox_y=180),
                make_line("(1) 30.02", line_number=5, bbox_x=1116, bbox_y=260),
                make_line("(2) 31.28", line_number=6, bbox_x=1392, bbox_y=260),
                make_line("(3) 32.02", line_number=7, bbox_x=1664, bbox_y=260),
                make_line("(4) 33.28", line_number=8, bbox_x=1116, bbox_y=308),
                make_line("(5) 34.02", line_number=9, bbox_x=1392, bbox_y=308),
            ])
        ]

        segments = _rule_based_segment(pages)

        assert [segment.problem_number for segment in segments] == ["8", "9", "10"]
        right_problem = segments[2]
        assert right_problem.problem_type == "multiple_choice"
        assert right_problem.choices is not None
        assert [choice.content_text for choice in right_problem.choices] == [
            "30.02",
            "31.28",
            "32.02",
            "33.28",
            "34.02",
        ]

    def test_ignores_confirmation_note_noise_lines(self):
        pages = [
            make_page(1, [
                make_line("30. 마지막 문제", line_number=1, bbox_x=1083, bbox_y=120),
                make_line("\\$ 확인 사항", line_number=2, bbox_x=1083, bbox_y=240),
                make_line("답안지의 해당란에 필요한 내용을 정확히 기입했는지 확인하시오.", line_number=3, bbox_x=1120, bbox_y=280),
            ])
        ]

        segments = _rule_based_segment(pages)

        assert len(segments) == 1
        assert "\\$ 확인 사항" not in segments[0].stem_text
        assert "답안지의 해당란" not in segments[0].stem_text

    def test_prefers_odd_form_when_both_odd_and_even_pages_exist(self):
        pages = [
            make_page(1, [
                make_line("2026학년도 대학수학능력시험 문제지", line_number=0),
                make_line("제 2 교시", line_number=1),
                make_line("수학 영역", line_number=2),
                make_line("홀수형", line_number=3),
                make_line("1. 홀수형 문제", line_number=4),
            ]),
            make_page(21, [
                make_line("2026학년도 대학수학능력시험 문제지", line_number=0),
                make_line("제 2 교시", line_number=1),
                make_line("수학 영역", line_number=2),
                make_line("짝수형", line_number=3),
                make_line("1. 짝수형 문제", line_number=4),
            ]),
        ]

        contexts = _build_exam_page_contexts(pages)
        filtered = _filter_dual_form_pages(pages, contexts, preferred_form="odd")

        assert [page.page_number for page in filtered] == [1]

    def test_annotates_suneung_segments_with_normalized_exam_metadata(self):
        pages = [
            make_page(9, [
                make_line("2026학년도 대학수학능력시험 문제지", line_number=0),
                make_line("제 2 교시", line_number=1),
                make_line("수학 영역(확률과 통계)", line_number=2),
                make_line("홀수형", line_number=3),
                make_line("23. 확통 문제", line_number=4),
            ]),
        ]

        contexts = _build_exam_page_contexts(pages)
        segments = _rule_based_segment(pages)
        annotated = _annotate_exam_segments(segments, contexts)

        assert len(annotated) == 1
        segment = annotated[0]
        assert segment.subject == "확률과 통계"
        assert segment.is_common is False
        assert segment.exam_source == {
            "type": "suneung",
            "form": "odd",
            "academicYear": 2026,
            "year": 2025,
            "month": 11,
            "isCommon": False,
            "number": 23,
            "subject": "확률과 통계",
        }

    def test_reads_left_column_continuation_before_right_column_next_problem(self):
        pages = [
            make_page(12, [
                make_line("수학 영역(확률과 통계)", line_number=1, bbox_x=180, bbox_y=80),
                make_line("홀수형", line_number=2, bbox_x=180, bbox_y=110),
                make_line("29. 확통 29번", line_number=6, bbox_x=180, bbox_y=220),
                make_line("사용하여 다음 시행을 한다.", line_number=7, bbox_x=180, bbox_y=260),
                make_line("주사위를 한 번 던져", line_number=8, bbox_x=180, bbox_y=300),
                make_line("구한 값이 $k$ 이다.", line_number=19, bbox_x=180, bbox_y=620),
                make_line("$1000 \\times k$ 의 값을 구하시오. [4점]", line_number=30, bbox_x=180, bbox_y=660),
                make_line("30. 확통 30번", line_number=22, bbox_x=1080, bbox_y=220),
                make_line("공 8 개가 있다.", line_number=23, bbox_x=1080, bbox_y=250),
                make_line("공을 주머니에 남김없이 나누어 넣을 때,", line_number=24, bbox_x=1080, bbox_y=285),
                make_line("다음 조건을 만족시키는 경우의 수를 구하시오.", line_number=25, bbox_x=1080, bbox_y=320),
                make_line("(단, 공끼리는 서로 구별하지 않는다.) [4점]", line_number=26, bbox_x=1080, bbox_y=355),
            ]),
        ]

        segments = _rule_based_segment(pages)

        assert [segment.problem_number for segment in segments] == ["29", "30"]
        assert "$1000 \\times k$ 의 값을 구하시오. [4점]" in segments[0].stem_text
        assert "$1000 \\times k$ 의 값을 구하시오. [4점]" not in segments[1].stem_text

    def test_moves_normal_distribution_table_back_to_previous_problem(self):
        pages = [
            make_page(12, [
                make_line("29. 정규분포 문제", line_number=1, bbox_x=180, bbox_y=220),
                make_line("오른쪽 표준정규분포표를 이용하여 구하시오. [4점]", line_number=2, bbox_x=180, bbox_y=260),
                make_line("30. 다음 문제", line_number=10, bbox_x=1080, bbox_y=220),
                make_line("조건을 만족시키는 경우의 수를 구하시오. [4점]", line_number=11, bbox_x=1080, bbox_y=260),
                make_line("\\begin{tabular}{|c|c|}", line_number=12, bbox_x=1080, bbox_y=520),
                make_line("\\hline$z$ & $P(0 \\leq Z \\leq z)$ \\\\", line_number=13, bbox_x=1080, bbox_y=560),
                make_line("\\hline 1.0 & 0.341 \\\\", line_number=14, bbox_x=1080, bbox_y=600),
                make_line("\\hline", line_number=15, bbox_x=1080, bbox_y=640),
                make_line("\\end{tabular}", line_number=16, bbox_x=1080, bbox_y=680),
            ]),
        ]

        segments = _rule_based_segment(pages)

        assert [segment.problem_number for segment in segments] == ["29", "30"]
        assert "\\begin{tabular}" in segments[0].stem_text
        assert "\\begin{tabular}" not in segments[1].stem_text
        assert "조건을 만족시키는 경우의 수를 구하시오. [4점]" in segments[1].stem_text
