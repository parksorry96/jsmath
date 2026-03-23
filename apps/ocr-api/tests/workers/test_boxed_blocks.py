"""Tests for exam-style boxed block detection."""

from app.workers.boxed_blocks import build_boxed_layout
from tests.conftest import make_line


def test_detects_condition_box_with_two_columns():
    lines = [
        make_line("1. 다음 조건을 만족시키는 것은?", line_number=1, bbox_x=100, bbox_y=100, bbox_w=420, bbox_h=28),
        make_line("(가) x+y=1", line_number=2, bbox_x=150, bbox_y=160, bbox_w=180, bbox_h=28),
        make_line("(나) x-y=3", line_number=3, bbox_x=380, bbox_y=160, bbox_w=180, bbox_h=28),
        make_line("(1) 1", line_number=4, bbox_x=140, bbox_y=230, bbox_w=60, bbox_h=24),
        make_line("(2) 2", line_number=5, bbox_x=240, bbox_y=230, bbox_w=60, bbox_h=24),
        make_line("(3) 3", line_number=6, bbox_x=340, bbox_y=230, bbox_w=60, bbox_h=24),
        make_line("(4) 4", line_number=7, bbox_x=440, bbox_y=230, bbox_w=60, bbox_h=24),
    ]

    layout = build_boxed_layout(source_lines=lines, display_lines=lines)

    assert layout is not None
    assert layout["x"] == 100
    assert layout["boxed_blocks"] is not None
    assert len(layout["boxed_blocks"]) == 1

    box = layout["boxed_blocks"][0]
    assert box["kind"] == "condition"
    assert box["column_count"] == 2
    assert [line["column"] for line in box["lines"]] == [0, 1]
    assert layout["structured_stem"] == [
        {
            "type": "text",
            "latex": "1. 다음 조건을 만족시키는 것은?",
            "text": "1. 다음 조건을 만족시키는 것은?",
        },
        {
            "type": "boxed_block",
            "box_index": 0,
        },
    ]


def test_detects_view_box_and_preserves_label():
    lines = [
        make_line("3. 보기에서 옳은 것을 고른 것은?", line_number=1, bbox_x=100, bbox_y=100, bbox_w=420, bbox_h=28),
        make_line("보기", line_number=2, bbox_x=150, bbox_y=160, bbox_w=40, bbox_h=22),
        make_line("ㄱ. x는 자연수이다.", line_number=3, bbox_x=150, bbox_y=192, bbox_w=220, bbox_h=24),
        make_line("ㄴ. y는 정수이다.", line_number=4, bbox_x=150, bbox_y=224, bbox_w=220, bbox_h=24),
        make_line("ㄷ. z는 무리수이다.", line_number=5, bbox_x=150, bbox_y=256, bbox_w=240, bbox_h=24),
        make_line("(1) ㄱ", line_number=6, bbox_x=140, bbox_y=320, bbox_w=54, bbox_h=24),
        make_line("(2) ㄱ, ㄴ", line_number=7, bbox_x=240, bbox_y=320, bbox_w=88, bbox_h=24),
        make_line("(3) ㄴ, ㄷ", line_number=8, bbox_x=360, bbox_y=320, bbox_w=88, bbox_h=24),
        make_line("(4) ㄱ, ㄴ, ㄷ", line_number=9, bbox_x=480, bbox_y=320, bbox_w=120, bbox_h=24),
    ]

    layout = build_boxed_layout(source_lines=lines, display_lines=lines)

    assert layout is not None
    assert layout["boxed_blocks"] is not None
    assert len(layout["boxed_blocks"]) == 1

    box = layout["boxed_blocks"][0]
    assert box["kind"] == "view"
    assert box["label"] == "보기"
    assert box["column_count"] == 1
    assert [line["text"] for line in box["lines"]] == [
        "보기",
        "ㄱ. x는 자연수이다.",
        "ㄴ. y는 정수이다.",
        "ㄷ. z는 무리수이다.",
    ]
    assert layout["structured_stem"] == [
        {
            "type": "text",
            "latex": "3. 보기에서 옳은 것을 고른 것은?",
            "text": "3. 보기에서 옳은 것을 고른 것은?",
        },
        {
            "type": "boxed_block",
            "box_index": 0,
        },
    ]


def test_detects_multiline_condition_box_and_keeps_tail_text():
    lines = [
        make_line("27. 다음 조건을 만족시키는 값을 구하시오.", line_number=1, bbox_x=100, bbox_y=100, bbox_w=420, bbox_h=28),
        make_line("(가) x+y=1", line_number=2, bbox_x=150, bbox_y=160, bbox_w=180, bbox_h=28),
        make_line("또, x는 자연수이다.", line_number=3, bbox_x=210, bbox_y=192, bbox_w=220, bbox_h=24),
        make_line("(나) x-y=3", line_number=4, bbox_x=150, bbox_y=228, bbox_w=180, bbox_h=28),
        make_line("또, y는 정수이다.", line_number=5, bbox_x=210, bbox_y=260, bbox_w=220, bbox_h=24),
        make_line("조건을 만족하는 순서쌍의 개수를 구하시오.", line_number=6, bbox_x=120, bbox_y=320, bbox_w=300, bbox_h=24),
    ]

    layout = build_boxed_layout(source_lines=lines, display_lines=lines)

    assert layout is not None
    assert layout["boxed_blocks"] is not None
    assert len(layout["boxed_blocks"]) == 1
    box = layout["boxed_blocks"][0]
    assert box["kind"] == "condition"
    assert [line["text"] for line in box["lines"]] == [
        "(가) x+y=1",
        "또, x는 자연수이다.",
        "(나) x-y=3",
        "또, y는 정수이다.",
    ]
    assert layout["structured_stem"] == [
        {
            "type": "text",
            "latex": "27. 다음 조건을 만족시키는 값을 구하시오.",
            "text": "27. 다음 조건을 만족시키는 값을 구하시오.",
        },
        {
            "type": "boxed_block",
            "box_index": 0,
        },
        {
            "type": "text",
            "latex": "조건을 만족하는 순서쌍의 개수를 구하시오.",
            "text": "조건을 만족하는 순서쌍의 개수를 구하시오.",
        },
    ]


def test_detects_fullwidth_view_label_with_multiline_entries():
    lines = [
        make_line("17. 보기에서 옳은 것만 고르시오.", line_number=1, bbox_x=100, bbox_y=100, bbox_w=420, bbox_h=28),
        make_line("〈보 기〉", line_number=2, bbox_x=150, bbox_y=160, bbox_w=80, bbox_h=22),
        make_line("ᄀ．첫째 조건이다.", line_number=3, bbox_x=150, bbox_y=192, bbox_w=220, bbox_h=24),
        make_line("자세한 설명이 이어진다.", line_number=4, bbox_x=210, bbox_y=224, bbox_w=240, bbox_h=24),
        make_line("ㄴ．둘째 조건이다.", line_number=5, bbox_x=150, bbox_y=256, bbox_w=220, bbox_h=24),
        make_line("（1）ᄀ", line_number=6, bbox_x=140, bbox_y=320, bbox_w=54, bbox_h=24),
        make_line("（2）ㄴ", line_number=7, bbox_x=240, bbox_y=320, bbox_w=54, bbox_h=24),
        make_line("（3）ᄀ，ㄴ", line_number=8, bbox_x=340, bbox_y=320, bbox_w=88, bbox_h=24),
        make_line("（4）없음", line_number=9, bbox_x=460, bbox_y=320, bbox_w=80, bbox_h=24),
    ]

    layout = build_boxed_layout(source_lines=lines, display_lines=lines)

    assert layout is not None
    assert layout["boxed_blocks"] is not None
    assert len(layout["boxed_blocks"]) == 1
    box = layout["boxed_blocks"][0]
    assert box["kind"] == "view"
    assert box["label"] == "보기"
    assert [line["text"] for line in box["lines"]] == [
        "〈보 기〉",
        "ᄀ．첫째 조건이다.",
        "자세한 설명이 이어진다.",
        "ㄴ．둘째 조건이다.",
    ]
