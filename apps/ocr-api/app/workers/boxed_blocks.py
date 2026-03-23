"""Heuristics for detecting exam-style boxed condition/view blocks from OCR lines."""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Sequence
from statistics import median
from typing import Any

_CHOICE_LINE_PATTERN = re.compile(
    r"^\s*(?:[①②③④⑤]|[\(（][1-5][\)）]|[1-5][.)])\s*"
)
_VIEW_ENTRY_PATTERN = re.compile(
    r"^\s*(?:[ㄱ-ㅎᄀ-ᄒ][.．]|[①②③④⑤]|[\(（][가-힣A-Z1-9][\)）])"
)
_CONDITION_ENTRY_PATTERN = re.compile(
    r"^\s*[\(（](?:가|나|다|라|마|바|사|아|자|차|[A-Z])[\)）]"
)


def _normalize_box_label(text: str) -> str:
    normalized = unicodedata.normalize("NFKC", text or "")
    normalized = re.sub(r"\s+", "", normalized)
    return normalized.strip("[]<>〈〉《》")


def _is_view_label(text: str) -> bool:
    return _normalize_box_label(text) == "보기"


def _is_choice_line(text: str) -> bool:
    return bool(_CHOICE_LINE_PATTERN.match(text))


def _is_condition_entry(text: str) -> bool:
    return bool(_CONDITION_ENTRY_PATTERN.match(text))


def _is_indented_continuation(
    entry_record: dict[str, Any],
    candidate_record: dict[str, Any],
    *,
    min_indent_delta: float = 12.0,
) -> bool:
    text = candidate_record["text"]
    if not text.strip():
        return False
    if _is_choice_line(text) or _is_view_label(text) or _is_condition_entry(text):
        return False

    entry_bbox = entry_record.get("bbox")
    candidate_bbox = candidate_record.get("bbox")
    if entry_bbox and candidate_bbox:
        return candidate_bbox["x"] >= entry_bbox["x"] + min_indent_delta

    return True


def _to_rect(
    x: float | None,
    y: float | None,
    w: float | None,
    h: float | None,
) -> dict[str, float] | None:
    if x is None or y is None:
        return None
    return {
        "x": float(x),
        "y": float(y),
        "w": float(w or 0),
        "h": float(h or 0),
    }


def _union_rect(rects: Sequence[dict[str, float]]) -> dict[str, float] | None:
    if not rects:
        return None
    x = min(rect["x"] for rect in rects)
    y = min(rect["y"] for rect in rects)
    max_x = max(rect["x"] + rect["w"] for rect in rects)
    max_y = max(rect["y"] + rect["h"] for rect in rects)
    return {"x": x, "y": y, "w": max_x - x, "h": max_y - y}


def _expand_rect(
    rect: dict[str, float] | None,
    *,
    pad_x: float,
    pad_top: float,
    pad_bottom: float,
) -> dict[str, float] | None:
    if rect is None:
        return None
    return {
        "x": max(0.0, rect["x"] - pad_x),
        "y": max(0.0, rect["y"] - pad_top),
        "w": rect["w"] + pad_x * 2,
        "h": rect["h"] + pad_top + pad_bottom,
    }


def _row_threshold(records: Sequence[dict[str, Any]]) -> float:
    heights = [max(record["bbox"]["h"], 1.0) for record in records if record.get("bbox")]
    if not heights:
        return 24.0
    return max(18.0, median(heights) * 0.85)


def _annotate_grid_positions(
    records: Sequence[dict[str, Any]],
) -> tuple[list[dict[str, Any]], int]:
    if not records:
        return [], 1

    threshold = _row_threshold(records)
    sorted_records = sorted(
        records,
        key=lambda record: (
            record["bbox"]["y"] + record["bbox"]["h"] / 2,
            record["bbox"]["x"],
        ),
    )

    rows: list[list[dict[str, Any]]] = []
    for record in sorted_records:
        center_y = record["bbox"]["y"] + record["bbox"]["h"] / 2
        if not rows:
            rows.append([record])
            continue

        last_row = rows[-1]
        row_center = median(
            item["bbox"]["y"] + item["bbox"]["h"] / 2 for item in last_row
        )
        if abs(center_y - row_center) <= threshold:
            last_row.append(record)
        else:
            rows.append([record])

    column_count = max(len(row) for row in rows)
    annotated: list[dict[str, Any]] = []
    for row_index, row in enumerate(rows):
        ordered = sorted(row, key=lambda record: record["bbox"]["x"])
        for column_index, record in enumerate(ordered):
            annotated.append({
                **record,
                "row": row_index,
                "column": column_index,
            })

    return annotated, max(column_count, 1)


def _build_text_block(records: Sequence[dict[str, Any]]) -> dict[str, str] | None:
    if not records:
        return None
    latex = "\n".join(record["latex"] for record in records if record["latex"]).strip()
    text = "\n".join(record["text"] for record in records if record["text"]).strip()
    if not latex and not text:
        return None
    return {
        "type": "text",
        "latex": latex or text,
        "text": text or latex,
    }


def _choice_position(text: str) -> int | None:
    stripped = text.strip()
    if not stripped:
        return None

    circled_map = {"①": 1, "②": 2, "③": 3, "④": 4, "⑤": 5}
    marker = stripped[0]
    if marker in circled_map:
        return circled_map[marker]

    match = re.match(r"^\s*[\(（]?([1-5])[\)）.]?\s*", stripped)
    if match:
        return int(match.group(1))

    return None


def _find_choice_block_start(records: Sequence[dict[str, Any]]) -> int:
    positions = [
        {
            "index": index,
            "position": _choice_position(record["text"]),
        }
        for index, record in enumerate(records)
    ]

    for offset, item in enumerate(positions):
        if item["position"] != 1:
            continue

        expected = 1
        matched = 0
        for candidate in positions[offset:]:
            if candidate["position"] == expected:
                matched += 1
                expected += 1
                if expected > 5:
                    break
                continue
            if matched > 0:
                break

        if matched >= 4:
            return item["index"]

    return len(records)


def _build_boxed_block(
    *,
    kind: str,
    label: str | None,
    records: Sequence[dict[str, Any]],
    line_start: int,
    line_end: int,
    pad_x: float,
    pad_top: float,
    pad_bottom: float,
) -> dict[str, Any] | None:
    positioned_records = [record for record in records if record.get("bbox")]
    if not positioned_records:
        return None
    annotated, column_count = _annotate_grid_positions(positioned_records)
    rects = [record["bbox"] for record in annotated if record.get("bbox")]
    content_bbox = _union_rect(rects)
    bbox = _expand_rect(
        content_bbox,
        pad_x=pad_x,
        pad_top=pad_top,
        pad_bottom=pad_bottom,
    )
    if bbox is None:
        return None

    return {
        "kind": kind,
        "label": label,
        "style": "csat_box",
        "layout": "grid" if column_count > 1 else "stacked",
        "column_count": column_count,
        "line_start": line_start,
        "line_end": line_end,
        "bbox": bbox,
        "content_bbox": content_bbox,
        "lines": [
            {
                "text": record["text"],
                "latex": record["latex"],
                "bbox": record["bbox"],
                "row": record["row"],
                "column": record["column"],
                "line_index": record["line_index"],
            }
            for record in sorted(
                annotated,
                key=lambda record: (record["row"], record["column"], record["line_index"]),
            )
        ],
    }


def _build_view_block(
    records: Sequence[dict[str, Any]],
    start_index: int,
    stop_index: int,
) -> tuple[dict[str, Any], int] | None:
    current = records[start_index]
    if not _is_view_label(current["text"]):
        return None

    block_records = [current]
    end_index = start_index
    current_entry: dict[str, Any] | None = None
    entry_count = 0
    for index in range(start_index + 1, stop_index):
        candidate = records[index]
        text = candidate["text"]
        if _is_choice_line(text):
            break
        if _VIEW_ENTRY_PATTERN.match(text):
            block_records.append(candidate)
            end_index = index
            current_entry = candidate
            entry_count += 1
            continue
        if current_entry is not None and _is_indented_continuation(current_entry, candidate):
            block_records.append(candidate)
            end_index = index
            continue
        break

    if entry_count == 0:
        return None

    block = _build_boxed_block(
        kind="view",
        label="보기",
        records=block_records,
        line_start=start_index,
        line_end=end_index,
        pad_x=18.0,
        pad_top=16.0,
        pad_bottom=18.0,
    )
    if block is None:
        return None
    return block, end_index


def _build_condition_block(
    records: Sequence[dict[str, Any]],
    start_index: int,
    stop_index: int,
) -> tuple[dict[str, Any], int] | None:
    current = records[start_index]
    if not _is_condition_entry(current["text"]):
        return None

    block_records = [current]
    end_index = start_index
    current_entry = current
    entry_count = 1
    for index in range(start_index + 1, stop_index):
        candidate = records[index]
        text = candidate["text"]
        if _is_choice_line(text) or _is_view_label(text):
            break
        if _is_condition_entry(text):
            block_records.append(candidate)
            end_index = index
            current_entry = candidate
            entry_count += 1
            continue
        if _is_indented_continuation(current_entry, candidate):
            block_records.append(candidate)
            end_index = index
            continue
        break

    if entry_count < 2:
        return None

    block = _build_boxed_block(
        kind="condition",
        label=None,
        records=block_records,
        line_start=start_index,
        line_end=end_index,
        pad_x=22.0,
        pad_top=14.0,
        pad_bottom=18.0,
    )
    if block is None:
        return None
    return block, end_index


def build_boxed_layout(
    *,
    source_lines: Sequence[Any],
    display_lines: Sequence[Any],
) -> dict[str, Any] | None:
    """Return exam-style box metadata embedded into the existing bbox payload."""
    if not source_lines or len(source_lines) != len(display_lines):
        return None

    records: list[dict[str, Any]] = []
    for index, (source_line, display_line) in enumerate(zip(source_lines, display_lines, strict=True)):
        bbox = _to_rect(
            getattr(source_line, "bbox_x", None),
            getattr(source_line, "bbox_y", None),
            getattr(source_line, "bbox_w", None),
            getattr(source_line, "bbox_h", None),
        )
        records.append({
            "line_index": index,
            "text": getattr(display_line, "text", "") or "",
            "latex": getattr(display_line, "latex", None) or getattr(display_line, "text", "") or "",
            "bbox": bbox,
        })

    region = _union_rect([record["bbox"] for record in records if record.get("bbox")])
    if region is None:
        return None

    stop_index = _find_choice_block_start(records)

    boxed_blocks: list[dict[str, Any]] = []
    cursor = 0
    while cursor < stop_index:
        view_match = _build_view_block(records, cursor, stop_index)
        if view_match is not None:
            block, end_index = view_match
            boxed_blocks.append(block)
            cursor = end_index + 1
            continue

        condition_match = _build_condition_block(records, cursor, stop_index)
        if condition_match is not None:
            block, end_index = condition_match
            boxed_blocks.append(block)
            cursor = end_index + 1
            continue

        cursor += 1

    if not boxed_blocks:
        return region

    structured_stem: list[dict[str, Any]] = []
    pointer = 0
    stem_records = records[:stop_index]
    for box_index, block in enumerate(boxed_blocks):
        before = [
            record
            for record in stem_records
            if pointer <= record["line_index"] < block["line_start"]
        ]
        text_block = _build_text_block(before)
        if text_block is not None:
            structured_stem.append(text_block)
        structured_stem.append({
            "type": "boxed_block",
            "box_index": box_index,
        })
        pointer = block["line_end"] + 1

    tail = [
        record
        for record in stem_records
        if record["line_index"] >= pointer
    ]
    text_block = _build_text_block(tail)
    if text_block is not None:
        structured_stem.append(text_block)

    return {
        **region,
        "boxed_blocks": boxed_blocks,
        "structured_stem": structured_stem,
    }
