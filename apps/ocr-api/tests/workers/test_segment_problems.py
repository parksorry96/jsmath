"""Tests for general exam problem segmentation."""

from app.workers.segment_problems import _rule_based_segment
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
