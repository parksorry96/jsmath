"""Tests for OCR choice parsing helpers."""

from app.workers.choice_parser import resolve_stem_and_choices


def test_resolve_stem_and_choices_handles_out_of_order_line_choices() -> None:
    stem = "\n".join([
        "1. 값은?",
        "(2) 2",
        "(4) 4",
        "(1) 1",
        "(3) 3",
        "(5) 5",
    ])

    cleaned_latex, cleaned_text, choices = resolve_stem_and_choices(stem, stem)

    assert cleaned_text == "1. 값은?"
    assert choices is not None
    assert [choice["position"] for choice in choices] == [1, 2, 3, 4, 5]
    assert [choice["content_text"] for choice in choices] == ["1", "2", "3", "4", "5"]
    assert "(2) 2" not in cleaned_latex


def test_resolve_stem_and_choices_strips_embedded_image_markdown_from_choices() -> None:
    stem = "\n".join([
        "25. 확통 문제",
        "(1) 1/2",
        "(2) 2/3",
        "(3) 3/4",
        "(4) 4/5",
        "![](https://cdn.mathpix.com/cropped/example.png)",
        "(5) 5/6",
    ])

    _, cleaned_text, choices = resolve_stem_and_choices(stem, stem)

    assert "![](" not in cleaned_text
    assert choices is not None
    assert len(choices) == 5
    assert all("![](" not in choice["content_text"] for choice in choices)


def test_resolve_stem_and_choices_ignores_stray_choice_lines_outside_main_block() -> None:
    stem = "\n".join([
        "10. 어떤 값은?",
        "설명이 이어진다.",
        "(3) 0",
        "본문이 계속된다.",
        "정답을 고르시오.",
        "(1) 11",
        "(2) 12",
        "(3) 13",
        "(5) 15",
        "(4) 14",
        "[4점]",
        "(4) 99",
        "(5) 100",
    ])

    _, cleaned_text, choices = resolve_stem_and_choices(stem, stem)

    assert cleaned_text == "10. 어떤 값은?\n설명이 이어진다.\n본문이 계속된다.\n정답을 고르시오."
    assert choices is not None
    assert [choice["position"] for choice in choices] == [1, 2, 3, 4, 5]
    assert [choice["content_text"] for choice in choices] == ["11", "12", "13", "14", "15"]
