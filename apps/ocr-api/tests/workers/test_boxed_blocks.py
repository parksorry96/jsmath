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
