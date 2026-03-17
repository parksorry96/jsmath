"""Integration test: EBS 수능특강 segmentation with section state machine."""
from app.workers.segment_textbook import _rule_based_segment
from tests.conftest import make_line, make_page


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
        assert examples[0]["display_number"] == "예제 1"
        assert examples[0]["inline_answer"] == "④"
        assert examples[0]["stem_text"].split("\n", 1)[0] == "거듭제곤근"
        assert not examples[0]["stem_text"].startswith("예제 1")

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

    def test_multiple_choice_choices_are_split_out_of_stem(self):
        pages = _build_ebs_chapter_pages()
        segments = _rule_based_segment(pages)
        example = next(s for s in segments if s.get("section_type") == "example")

        assert example["problem_type"] == "multiple_choice"
        assert example["choices"] is not None
        assert len(example["choices"]) == 5
        assert [choice["label"] for choice in example["choices"]] == ["①", "②", "③", "④", "⑤"]
        assert example["choices"][0]["content_text"] == "³√3"
        assert example["choices"][4]["content_text"] == "9"
        assert "① ³√3" not in example["stem_text"]
        assert example["stem_text"] == "거듭제곤근\n³√(27/³√27) × ⁵√9의 값은?"

    def test_skips_concept_headings_and_keeps_standalone_problem_numbers(self):
        pages = [
            make_page(1, [
                make_line("유제", line_number=1),
                make_line("[26008-0001]", line_number=2),
                make_line("1", line_number=3),
                make_line("첫 번째 문제", line_number=4),
                make_line("[26008-0002]", line_number=5),
                make_line("2", line_number=6),
                make_line("두 번째 문제", line_number=7),
            ]),
            make_page(2, [
                make_line("4 등차수열의 합", line_number=1),
                make_line("개념 설명", line_number=2),
            ]),
            make_page(3, [
                make_line("유제", line_number=1),
                make_line("3", line_number=2),
                make_line("[26008-0003]", line_number=3),
                make_line("세 번째 문제", line_number=4),
                make_line("4 네 번째 문제", line_number=5),
                make_line("[26008-0004]", line_number=6),
                make_line("네 번째 문제 이어짐", line_number=7),
            ]),
            make_page(4, [
                make_line("5 수열의 합과 일반항 사이의 관계", line_number=1),
                make_line("개념 설명", line_number=2),
            ]),
            make_page(5, [
                make_line("유제", line_number=1),
                make_line("5 다섯 번째 문제", line_number=2),
                make_line("[26008-0005]", line_number=3),
                make_line("다섯 번째 문제 이어짐", line_number=4),
                make_line("6 여섯 번째 문제", line_number=5),
                make_line("[26008-0006]", line_number=6),
                make_line("여섯 번째 문제 이어짐", line_number=7),
            ]),
        ]

        segments = _rule_based_segment(pages)
        practice = [s for s in segments if s.get("section_type") == "practice"]

        assert [s["local_number"] for s in practice] == ["1", "2", "3", "4", "5", "6"]
        assert practice[2]["item_code"] == "26008-0003"
        assert practice[2]["stem_text"].split("\n", 1)[0] == "세 번째 문제"
        assert practice[3]["stem_text"].split("\n", 1)[0] == "네 번째 문제"
        assert practice[4]["stem_text"].split("\n", 1)[0] == "다섯 번째 문제"
