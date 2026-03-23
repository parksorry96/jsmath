"""Utilities for extracting multiple-choice options from OCR stem content."""

from __future__ import annotations

import re
from dataclasses import dataclass

_CIRCLED_LABELS = {
    1: "①",
    2: "②",
    3: "③",
    4: "④",
    5: "⑤",
}

_CIRCLED_TO_POSITION = {label: position for position, label in _CIRCLED_LABELS.items()}

_CHOICE_PREFIX_PATTERN = re.compile(
    r"^\s*(?:\\textcircled\{\s*[1-5]\s*\}|\\circled\{\s*[1-5]\s*\}|\(\s*[1-5]\s*\)|（\s*[1-5]\s*）|[1-5][.)]|[①②③④⑤])\s*",
    re.UNICODE,
)

_INLINE_CHOICE_PATTERN = re.compile(
    r"(^|\s)(?P<marker>\\textcircled\{\s*[1-5]\s*\}|\\circled\{\s*[1-5]\s*\}|\(\s*[1-5]\s*\)|（\s*[1-5]\s*）|[①②③④⑤]|[1-5][.)])",
    re.MULTILINE | re.UNICODE,
)
_IMAGE_MARKDOWN_LINE_PATTERN = re.compile(r"^\s*!\[[^\]]*\]\([^)]+\)\s*$", re.MULTILINE)
_BARE_URL_LINE_PATTERN = re.compile(r"^\s*https?://\S+\s*$", re.MULTILINE)
_STANDALONE_SCORE_LINE_PATTERN = re.compile(r"^\s*\[\s*\d+\s*점\s*\]\s*$", re.UNICODE)


@dataclass(frozen=True)
class ParsedChoice:
    position: int
    label: str
    content: str


@dataclass(frozen=True)
class ChoiceSplitResult:
    stem: str
    choices: list[ParsedChoice]


def normalize_line_endings(content: str | None) -> str:
    normalized = (content or "").replace("\r\n", "\n").replace("\r", "\n").strip()
    normalized = _IMAGE_MARKDOWN_LINE_PATTERN.sub("", normalized)
    normalized = _BARE_URL_LINE_PATTERN.sub("", normalized)
    normalized = re.sub(r"\n{3,}", "\n\n", normalized)
    return normalized.strip()


def strip_choice_prefix(content: str | None) -> str:
    normalized = normalize_line_endings(content)
    if not normalized:
        return ""

    stripped = _CHOICE_PREFIX_PATTERN.sub("", normalized).strip()
    return stripped or normalized


def _position_from_marker(marker: str) -> int:
    if marker in _CIRCLED_TO_POSITION:
        return _CIRCLED_TO_POSITION[marker]

    digit_match = re.fullmatch(
        r"\\textcircled\{\s*([1-5])\s*\}|\\circled\{\s*([1-5])\s*\}|\(\s*([1-5])\s*\)|（\s*([1-5])\s*）|([1-5])[.)]",
        marker,
    )
    if not digit_match:
        return 0

    for group_index in range(1, 6):
        if digit_match.group(group_index):
            return int(digit_match.group(group_index))

    return 0


def _match_position(match: re.Match[str]) -> int:
    return _position_from_marker(match.group("marker"))


def _is_leading_problem_number_stem_line(line: str, line_index: int) -> bool:
    return line_index == 0 and re.match(r"^\s*[1-5]\.(?!\d)\s*\S", line) is not None


def parse_inline_choices(content: str | None) -> ChoiceSplitResult | None:
    """Split a stem into prompt + 4~5 sequential objective choices, if present."""
    normalized = normalize_line_endings(content)
    if not normalized:
        return None

    matches = [
        {
            "index": match.start("marker"),
            "end": match.end("marker"),
            "position": _match_position(match),
        }
        for match in _INLINE_CHOICE_PATTERN.finditer(normalized)
    ]

    if len(matches) < 4:
        return None

    for start_index, start_match in enumerate(matches):
        if start_match["position"] != 1:
            continue

        sequence: list[dict[str, int]] = []
        expected_position = 1
        for candidate in matches[start_index:]:
            candidate_position = candidate["position"]
            if candidate_position == expected_position:
                sequence.append(candidate)
                expected_position += 1
                if expected_position > 5:
                    break
                continue

            if sequence:
                break

        if len(sequence) < 4:
            continue

        stem = normalized[: sequence[0]["index"]].strip()
        if not stem:
            continue

        choices: list[ParsedChoice] = []
        for idx, current in enumerate(sequence):
            next_index = sequence[idx + 1]["index"] if idx + 1 < len(sequence) else len(normalized)
            content_text = strip_choice_prefix(normalized[current["end"]:next_index])
            if not content_text:
                choices = []
                break

            position = current["position"]
            choices.append(
                ParsedChoice(
                    position=position,
                    label=_CIRCLED_LABELS.get(position, f"({position})"),
                    content=content_text,
                )
            )

        if len(choices) >= 4:
            return ChoiceSplitResult(stem=stem, choices=choices)

    return None


def parse_line_choices(content: str | None) -> ChoiceSplitResult | None:
    """Split a stem into prompt + 4~5 choice lines, even if OCR reordered them."""
    normalized = normalize_line_endings(content)
    if not normalized:
        return None

    lines = [line.strip() for line in normalized.split("\n") if line.strip()]
    if len(lines) < 5:
        return None

    choice_starts: list[dict[str, int]] = []
    for line_index, line in enumerate(lines):
        if _is_leading_problem_number_stem_line(line, line_index):
            continue
        match = _CHOICE_PREFIX_PATTERN.match(line)
        if not match:
            continue
        position = _position_from_marker(match.group(0).strip())
        if position == 0:
            continue
        choice_starts.append({"line_index": line_index, "position": position})

    if len(choice_starts) < 4:
        return None

    best_window: dict[str, object] | None = None
    for start_index in range(len(choice_starts)):
        unique_by_position: dict[int, dict[str, int]] = {}
        for end_index in range(start_index, len(choice_starts)):
            candidate = choice_starts[end_index]
            unique_by_position.setdefault(candidate["position"], candidate)
            ordered_positions = sorted(unique_by_position)
            unique_count = len(ordered_positions)
            has_minimum_sequence = unique_count >= 4 and ordered_positions[:4] == [1, 2, 3, 4]
            if not has_minimum_sequence:
                continue

            span = choice_starts[end_index]["line_index"] - choice_starts[start_index]["line_index"]
            duplicate_count = end_index - start_index + 1 - unique_count
            non_choice_between = span - (end_index - start_index)
            score = unique_count * 100 - span * 5 - duplicate_count * 30 - non_choice_between * 10
            starts = sorted(unique_by_position.values(), key=lambda item: item["line_index"])
            candidate_window = {
                "score": score,
                "span": span,
                "unique_count": unique_count,
                "starts": starts,
            }

            if best_window is None:
                best_window = candidate_window
                continue

            if score > int(best_window["score"]):
                best_window = candidate_window
                continue

            if (
                score == int(best_window["score"])
                and unique_count > int(best_window["unique_count"])
            ):
                best_window = candidate_window
                continue

            if (
                score == int(best_window["score"])
                and unique_count == int(best_window["unique_count"])
                and span < int(best_window["span"])
            ):
                best_window = candidate_window

    if best_window is None:
        return None

    starts = list(best_window["starts"])
    if len(starts) < 4:
        return None

    all_choice_start_lines = {item["line_index"] for item in choice_starts}
    first_choice_line = starts[0]["line_index"]
    stem_lines = [
        line
        for line_index, line in enumerate(lines[:first_choice_line])
        if line_index not in all_choice_start_lines or _is_leading_problem_number_stem_line(line, line_index)
    ]
    if not stem_lines:
        return None

    next_boundary_by_line: dict[int, int] = {}
    for index, current in enumerate(choice_starts):
        next_boundary_by_line[current["line_index"]] = (
            choice_starts[index + 1]["line_index"] if index + 1 < len(choice_starts) else len(lines)
        )

    choices: list[ParsedChoice] = []
    for start in starts:
        current_line_index = start["line_index"]
        next_boundary = next_boundary_by_line.get(current_line_index, len(lines))
        parts = [strip_choice_prefix(lines[current_line_index])]
        for continuation_line in lines[current_line_index + 1:next_boundary]:
            if _STANDALONE_SCORE_LINE_PATTERN.match(continuation_line):
                continue
            parts.append(continuation_line)
        content_text = " ".join(part for part in parts if part).strip()
        if not content_text:
            continue
        position = start["position"]
        choices.append(
            ParsedChoice(
                position=position,
                label=_CIRCLED_LABELS.get(position, f"({position})"),
                content=content_text,
            )
        )

    choices.sort(key=lambda choice: choice.position)
    if len(choices) < 4:
        return None

    return ChoiceSplitResult(stem="\n".join(stem_lines).strip(), choices=choices)


def resolve_stem_and_choices(
    stem_latex: str | None,
    stem_text: str | None,
) -> tuple[str, str, list[dict] | None]:
    """Return cleaned stems plus parsed objective choices, if the stem contains them."""
    normalized_latex = normalize_line_endings(stem_latex)
    normalized_text = normalize_line_endings(stem_text)

    latex_split = parse_line_choices(normalized_latex) or parse_inline_choices(normalized_latex)
    text_split = parse_line_choices(normalized_text) or parse_inline_choices(normalized_text)
    derived_count = len(latex_split.choices) if latex_split else len(text_split.choices) if text_split else 0

    if derived_count < 4:
        return normalized_latex, normalized_text, None

    choices: list[dict] = []
    for index in range(derived_count):
        latex_choice = latex_split.choices[index].content if latex_split else ""
        text_choice = text_split.choices[index].content if text_split else ""
        position = (
            latex_split.choices[index].position
            if latex_split
            else text_split.choices[index].position
            if text_split
            else index + 1
        )
        content_latex = strip_choice_prefix(latex_choice)
        content_text = strip_choice_prefix(text_choice)
        if not content_latex and not content_text:
            continue

        choices.append(
            {
                "position": position,
                "label": _CIRCLED_LABELS.get(position, f"({position})"),
                "content_latex": content_latex or content_text,
                "content_text": content_text or content_latex,
            }
        )

    if len(choices) < 4:
        return normalized_latex, normalized_text, None

    cleaned_latex = (
        latex_split.stem
        if latex_split
        else text_split.stem
        if text_split and (not normalized_latex or normalized_latex == normalized_text)
        else normalized_latex
    )
    cleaned_text = text_split.stem if text_split else normalized_text

    return (
        cleaned_latex,
        cleaned_text,
        choices,
    )
