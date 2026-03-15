"""Utilities for extracting multiple-choice options from OCR stem content."""

from __future__ import annotations

from dataclasses import dataclass
import re

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
    return (content or "").replace("\r\n", "\n").replace("\r", "\n").strip()


def strip_choice_prefix(content: str | None) -> str:
    normalized = normalize_line_endings(content)
    if not normalized:
        return ""

    stripped = _CHOICE_PREFIX_PATTERN.sub("", normalized).strip()
    return stripped or normalized


def _match_position(match: re.Match[str]) -> int:
    marker = match.group("marker")
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


def resolve_stem_and_choices(
    stem_latex: str | None,
    stem_text: str | None,
) -> tuple[str, str, list[dict] | None]:
    """Return cleaned stems plus parsed objective choices, if the stem contains them."""
    normalized_latex = normalize_line_endings(stem_latex)
    normalized_text = normalize_line_endings(stem_text)

    latex_split = parse_inline_choices(normalized_latex)
    text_split = parse_inline_choices(normalized_text)
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
