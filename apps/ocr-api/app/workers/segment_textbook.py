"""Celery task: segment textbook OCR output into individual math problems.

Extended version of segment_problems.py with textbook-specific patterns:
- Korean labeled problems (예제, 유제, 대표문제, etc.)
- 3-4 digit standalone numbers (쎈 0001, RPM 001)
- Sub-problem nesting under parent
- Section/chapter header detection
- Concept block skipping (정리, 정의, 공식, etc.)
- Number range up to 2000 (쎈 has 1700+ problems)
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
import logging
import re
from typing import Callable

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.celery_app import celery
from app.database import worker_session
from app.models.job import JobStatus, OcrJobTracking
from app.models.ocr import OcrLine, OcrPage
from app.schemas.problem import BBox
from app.workers.choice_parser import resolve_stem_and_choices

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class NormalizedStemLine:
    text: str
    latex: str

# Line types to skip
_SKIP_LINE_TYPES = {"page_info", "page_header", "page_footer"}

# Problem number patterns (ORDER MATTERS — specific first)
_PROBLEM_PATTERNS = [
    # 1. Korean labeled problems (most specific)
    re.compile(
        r"^\s*(?P<label>예제|유제|대표문제|확인문제|기본문제|심화문제|연습문제|문제|Exercise|Problem|Q)\s*(?P<num>\d{1,3})"
    ),
    # 2. 3-4 digit standalone (쎈 0001, RPM 001)
    re.compile(r"^\s*(?P<num>\d{3,4})\s*[.\s]"),
    # 3. Standard N. (not decimals)
    re.compile(r"^\s*(?P<num>\d{1,3})\s*\.(?!\d)"),
    # 4. Circled numbers
    re.compile(r"^\s*(?P<num>[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳])"),
    # 5. Bracketed [N]
    re.compile(r"^\s*\[(?P<num>\d{1,3})\]"),
]

# Sub-problem patterns (NOT independent problems — nest under parent)
_SUB_PROBLEM_PATTERNS = [
    re.compile(r"^\s*\((\d{1,2})\)\s"),   # (1), (2)
    re.compile(r"^\s*(\d{1,2})\)\s"),      # 1), 2)
]

# Section headers (NOT problems — skip these)
_SECTION_PATTERNS = [
    re.compile(r"^\s*\[?\s*유형\s*\d{1,3}\s*\]?"),  # [유형 01]
    re.compile(r"(?:제\s*\d+\s*(?:장|단원|절)|Chapter\s*\d+|단원\s*\d+|§\s*\d+)", re.IGNORECASE),
]

# Chapter/section detection for metadata
_CHAPTER_PATTERNS = [
    re.compile(r"^\s*제\s*(\d+)\s*장"),
    re.compile(r"^\s*Chapter\s+(\d+)", re.IGNORECASE),
    re.compile(r"^\s*(\d+)\s*단원"),
    re.compile(r"^\s*§\s*(\d+)"),
    re.compile(r"^\s*제\s*(\d+)\s*절"),
    re.compile(r"^\s*Section\s+(\d+)", re.IGNORECASE),
    re.compile(r"^\s*\[?\s*유형\s*(\d{1,3})\s*\]?"),  # [유형 01] is a section
]

# Concept block keywords (SKIP these — not problems)
_CONCEPT_KEYWORDS = re.compile(
    r"^\s*\[?\s*(?:정리|정의|공식|참고|NOTE|개념|성질|증명|보기|공식\s*정리)\s*\]?",
    re.IGNORECASE,
)

# Circled number mapping for display
_CIRCLED_MAP = {c: str(i + 1) for i, c in enumerate("①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳")}

# Label -> category mapping
_LABEL_CATEGORY = {
    "예제": "example",
    "유제": "practice",
    "대표문제": "representative",
    "확인문제": "check",
    "기본문제": "basic",
    "심화문제": "advanced",
    "연습문제": "exercise",
    "문제": "problem",
    "Exercise": "exercise",
    "Problem": "problem",
    "Q": "problem",
}

# Choice marker for multiple choice detection
_CHOICE_PATTERN = re.compile(r"^\s*[①②③④⑤]\s*")
_CHOICE_PATTERN_ASCII = re.compile(r"^\s*[\(（][1-5][\)）]\s*")
_QUESTION_PROMPT_PATTERN = re.compile(
    r"(?:값은[？?]|구하시오|옳은 것은|고른 것은|개수는|최댓값은|최솟값은|나머지는|합은|적당한 것은)"
)
_POINT_SUFFIX_PATTERN = re.compile(r"[（(]\d+\s*점[)）]")
_TEXTBOOK_COLUMN_BOUNDARY_X = 1000

# Written solution keywords
_WRITTEN_KEYWORDS = re.compile(r"풀이\s*과정|서술하|서술형|설명하")

# Number range: 1 ~ 2000 (쎈 has 1700+)
_MAX_PROBLEM_NUMBER = 2000

# ─── EBS Item Code Pattern ───
_ITEM_CODE_PATTERN = re.compile(r"\[(\d{5}-\d{4})\]")

# ─── Section Transition Patterns (EBS 수능특강) ───
_SECTION_TRANSITIONS = [
    (re.compile(r"^\s*Level\s*1\b", re.IGNORECASE), "level1"),
    (re.compile(r"^\s*Level\s*2\b", re.IGNORECASE), "level2"),
    (re.compile(r"^\s*Level\s*3\b", re.IGNORECASE), "level3"),
    (re.compile(r"^\s*Level\s*$", re.IGNORECASE), "level_pending"),  # "Level" alone (number on next line or header)
    (re.compile(r"^\s*유제\s*$"), "practice"),
    (re.compile(r"^\s*대표\s*기출\s*문제"), "past_exam"),
    (re.compile(r"^\s*대표기출문제\s*$"), "past_exam"),  # No spaces variant
    (re.compile(r"^\s*한눈에\s*보는\s*정답"), "quick_answer"),
    (re.compile(r"^\s*정답과\s*풀이\s*$"), "answer_detail"),  # Exact match only (exclude footer "정답과 풀이 2쪽")
]

_EXAMPLE_PATTERN = re.compile(r"^\s*예제\s*(\d{1,2})\s*(.*)")
_PAST_EXAM_YEAR_PATTERN = re.compile(r"(\d{4}학년도\s*(?:수능|6월모의평가|9월모의평가|교육청모의고사))")
_PROBLEM_LABEL_PATTERN = re.compile(
    r"^\s*(예제|유제|대표문제|확인문제|기본문제|심화문제|연습문제|문제|Exercise|Problem|Q)\b"
)

_EXAM_HEADER_PATTERN = re.compile(
    r"^\s*(?P<num>\d{1,4})"
    r"(?P<prefix>\s*(?:[★☆*✭✦✧⋆•·※]|\S{1,6}){0,4}\s*)"
    r"(?P<year>20\d{2})\s*(?:학년도|년)\s*"
    r"(?P<tail>.*)$"
)

_EXAM_HEADER_ITEM_PATTERNS = [
    re.compile(
        r"^(?P<body>.*?)(?P<exam_num>\d{1,2})\s*(?:번|문항)"
        r"(?:\((?P<audience>[^)]{1,12})\))?"
        r"(?:\s*(?P<form>[가나다라마바사]|[AB]형))?"
        r"(?P<rest>\s*.*)$"
    ),
    re.compile(
        r"^(?P<body>.*?)(?P<form>[AB]형)\s*(?P<exam_num>\d{1,2})\s*(?:번|문항)"
        r"(?:\((?P<audience>[^)]{1,12})\))?"
        r"(?P<rest>\s*.*)$"
    ),
    re.compile(
        r"^(?P<body>.*?)(?P<exam_num>\d{1,2})\s*(?P<form>[가나다라마바사])"
        r"(?P<rest>\s*.*)$"
    ),
]

_EXAM_SOURCE_PATTERNS = [
    (re.compile(r"경찰\s*대?"), "경찰대"),
    (re.compile(r"사관\s*학교"), "사관학교"),
    (re.compile(r"수능"), "수능"),
    (re.compile(r"학평"), "학평"),
    (re.compile(r"모평|모의평가|교육청"), "모평"),
]

_INLINE_BLOCK_PATTERNS = [
    re.compile(r"^\s*잠깐이?\s*$", re.IGNORECASE),
    re.compile(r"^\s*길잡이"),  # hint block (may have content on same line)
    re.compile(r"^\s*풀이\s"),  # "풀이 " followed by content (not standalone)
    re.compile(r"^\s*풀이\s*$"),  # standalone "풀이"
    re.compile(r"^\s*[답달뎔]\s*[①②③④⑤\d(]"),  # "답 ④" or "답 (3)" — includes OCR variants 달/뎔
    re.compile(r"^\s*출제\s*의도"),
    re.compile(r"^\s*출제\s*경향"),
    re.compile(r"^\s*출제의도"),
    re.compile(r"^\s*출제경향"),
    re.compile(r"^\s*출제\s*$"),  # "출제" alone (next line: "경향" or "의도")
    re.compile(r"^\s*경향\s*$"),  # "경향" alone (continuation)
]


def _match_item_code(text: str) -> str | None:
    """Extract EBS item code like [26008-0001] from text."""
    m = _ITEM_CODE_PATTERN.search(text)
    return m.group(1) if m else None


def _match_section_transition(text: str) -> tuple[str, str] | None:
    """Check if text signals a section transition. Returns (section_type, label) or None."""
    stripped = text.strip()
    for pattern, section_type in _SECTION_TRANSITIONS:
        if pattern.match(stripped):
            return (section_type, stripped)
    return None


def _match_example_start(text: str) -> tuple[str, str] | None:
    """Check if text starts an example (예제 N). Returns (number, display) or None."""
    m = _EXAMPLE_PATTERN.match(text.strip())
    if m:
        num = m.group(1)
        return (num, f"예제 {num}")
    return None


def _match_past_exam_year(text: str) -> str | None:
    """Extract exam year label like '2023학년도 수능'. Returns label or None."""
    m = _PAST_EXAM_YEAR_PATTERN.search(text)
    return m.group(1) if m else None


def _is_inline_block(text: str) -> bool:
    """Check if text starts an inline block (잠깐의, 풀이, 답, 출제의도, 출제경향)."""
    stripped = text.strip()
    return any(p.match(stripped) for p in _INLINE_BLOCK_PATTERNS)


@celery.task(
    bind=True,
    name="task.textbook.segment",
    max_retries=2,
    default_retry_delay=10,
    acks_late=True,
)
def segment_textbook(
    self,
    prev_result: dict | None = None,
    *,
    ocr_job_id: str | None = None,
) -> dict:
    """Segment textbook OCR lines into individual problems."""
    if prev_result:
        ocr_job_id = ocr_job_id or prev_result.get("ocr_job_id")
    if not ocr_job_id:
        raise ValueError("ocr_job_id is required")

    problem_pages = prev_result.get("problem_pages") if prev_result else None
    answer_pages = prev_result.get("answer_pages") if prev_result else None
    has_quick_answers = prev_result.get("has_quick_answers", False) if prev_result else False
    quick_answer_pages = prev_result.get("quick_answer_pages") if prev_result else None

    result = asyncio.run(_segment(ocr_job_id, problem_pages, answer_pages, has_quick_answers))
    # Forward quick_answer_pages for match_answers
    if quick_answer_pages is not None:
        result["quick_answer_pages"] = quick_answer_pages
    return result


async def _segment(
    ocr_job_id: str,
    problem_pages: list[int] | None,
    answer_pages: list[int] | None,
    has_quick_answers: bool,
) -> dict:
    async with worker_session() as session:
        job_result = await session.execute(
            select(OcrJobTracking).where(OcrJobTracking.id == ocr_job_id)
        )
        job = job_result.scalar_one()
        job.status = JobStatus.segmenting
        await session.commit()

        query = (
            select(OcrPage)
            .where(OcrPage.ocr_job_id == ocr_job_id)
            .options(selectinload(OcrPage.lines))
            .order_by(OcrPage.page_number)
        )
        pages_result = await session.execute(query)
        pages = pages_result.scalars().all()

    # Filter to problem pages only
    if problem_pages:
        pages = [p for p in pages if problem_pages[0] <= p.page_number <= problem_pages[1]]

    from app.services.redis_events import notify_progress

    total_pages = len(pages)
    report_interval = max(1, total_pages // 20) if total_pages > 0 else 1
    last_reported = 0

    def report_progress(processed_pages: int) -> None:
        nonlocal last_reported
        if processed_pages < total_pages and processed_pages - last_reported < report_interval:
            return

        last_reported = processed_pages
        notify_progress(
            ocr_job_id,
            "segmentation",
            current=processed_pages,
            total=total_pages,
            message=f"교재 문제 분할 중 ({processed_pages}/{total_pages} 페이지)",
        )

    segments = _rule_based_segment(pages, progress_callback=report_progress)

    notify_progress(
        ocr_job_id, "segmentation",
        current=total_pages, total=total_pages,
        message=f"교재 문제 분할 완료 ({len(segments)}문제)",
    )

    logger.info(
        "Textbook segmentation found %d problems for job %s",
        len(segments),
        ocr_job_id,
    )

    return {
        "ocr_job_id": ocr_job_id,
        "problem_count": len(segments),
        "segments": segments,
        "problem_pages": problem_pages,
        "answer_pages": answer_pages,
        "has_quick_answers": has_quick_answers,
    }


def _is_noise_line(line: OcrLine) -> bool:
    """Check if a line is noise."""
    text = line.text.strip()
    if line.line_type in _SKIP_LINE_TYPES:
        if (
            _extract_exam_header_metadata(text) is None
            and _is_section_header(text) is False
            and _match_chapter(text) is None
            and _match_problem_start(text) is None
        ):
            return True
    if not text:
        return True
    if re.match(r"^\d{1,3}$", text):
        return True
    return False


def _is_concept_block(text: str) -> bool:
    """Check if a line starts a concept block (should be skipped)."""
    return bool(_CONCEPT_KEYWORDS.match(text))


def _is_section_header(text: str) -> bool:
    """Check if a line is a section header (not a problem)."""
    for pattern in _SECTION_PATTERNS:
        if pattern.match(text):
            return True
    return False


def _match_chapter(text: str) -> str | None:
    """Try to detect chapter/section from a line. Returns chapter name or None."""
    for pattern in _CHAPTER_PATTERNS:
        m = pattern.match(text)
        if m:
            return text.strip()
    return None


def _match_sub_problem(text: str) -> str | None:
    """Check if a line starts a sub-problem. Returns sub-number or None."""
    for pattern in _SUB_PROBLEM_PATTERNS:
        m = pattern.match(text)
        if m:
            return m.group(1)
    return None


def _match_problem_start(text: str) -> tuple[str, str, str | None] | None:
    """Try to match a problem start pattern.

    Returns (problem_number, display_number, problem_category) or None.
    """
    exam_header = _extract_exam_header_metadata(text)
    if exam_header is not None:
        raw_num = re.match(r"^\s*(\d{1,4})", text)
        if raw_num:
            normalized_num = str(int(raw_num.group(1)))
            return normalized_num, raw_num.group(1), None

    for i, pattern in enumerate(_PROBLEM_PATTERNS):
        m = pattern.match(text)
        if not m:
            continue

        if i == 0:  # Korean labeled: 예제 1, 유제 3, etc.
            label = m.group("label")
            num = m.group("num")
            category = _LABEL_CATEGORY.get(label)
            return num, f"{label} {num}", category

        if i == 1:  # 3-4 digit: 0001, 001
            num_str = m.group("num")
            num = int(num_str)
            if 1 <= num <= _MAX_PROBLEM_NUMBER:
                return str(num), num_str, None

        elif i == 2:  # N.
            num = int(m.group("num"))
            if 1 <= num <= _MAX_PROBLEM_NUMBER:
                return str(num), f"{num}.", None

        elif i == 3:  # Circled numbers
            circled = m.group("num")
            mapped = _CIRCLED_MAP.get(circled, circled)
            return mapped, circled, None

        elif i == 4:  # [N]
            num = int(m.group("num"))
            if 1 <= num <= _MAX_PROBLEM_NUMBER:
                return str(num), f"[{num}]", None

    return None


def _extract_problem_label(
    display_number: str | None,
    *,
    fallback: str | None = None,
) -> str | None:
    """Extract a human-readable label such as 예제 or 유제 from the display number."""
    if display_number:
        match = _PROBLEM_LABEL_PATTERN.match(display_number)
        if match:
            return match.group(1)
    return fallback


def _canonicalize_exam_source(text: str) -> str | None:
    normalized = re.sub(r"\s+", " ", text).strip()
    for pattern, source_type in _EXAM_SOURCE_PATTERNS:
        if pattern.search(normalized):
            return source_type
    return None


def _extract_exam_header_metadata(text: str) -> dict | None:
    stripped = text.strip()
    match = _EXAM_HEADER_PATTERN.match(stripped)
    if not match:
        return None

    year = int(match.group("year"))
    tail = match.group("tail") or ""
    item_match = None
    for pattern in _EXAM_HEADER_ITEM_PATTERNS:
        item_match = pattern.match(tail)
        if item_match:
            break
    if not item_match:
        return None

    prefix = re.sub(r"\s+", " ", match.group("prefix") or "").strip()
    body = re.sub(r"\s+", " ", item_match.group("body") or "").strip()
    item_groupdict = item_match.groupdict()
    audience = (item_groupdict.get("audience") or "").strip() or None
    form = (item_groupdict.get("form") or "").strip() or None
    raw_header = " ".join(
        part
        for part in [
            prefix,
            f"{year}학년도" if "학년도" in stripped else f"{year}년",
            body,
            f"{item_match.group('exam_num')}번"
            if "번" in tail or "문항" in tail
            else item_match.group("exam_num"),
            audience and f"({audience})",
            (
                form
                if form
                and form not in body
                else ""
            ),
        ]
        if part
    )
    source_type = _canonicalize_exam_source(raw_header)
    body_form_match = re.search(r"([AB]형|[가나다라마바사])", body)

    return {
        "raw": raw_header,
        "year": year,
        "sourceType": source_type,
        "sourceLabel": body or None,
        "examNumber": int(item_match.group("exam_num")),
        "audience": audience,
        "form": (form or (body_form_match.group(1) if body_form_match else "")).strip() or None,
        "rest": (item_match.group("rest") or "").strip(),
    }


def _strip_exam_header_prefix(text: str) -> str:
    metadata = _extract_exam_header_metadata(text)
    if metadata is None:
        return text.strip()
    return metadata["rest"]


def _strip_problem_header(text: str, *, allow_embedded_number: bool = False) -> str:
    """Remove only the leading problem label/number prefix from the first stem line."""
    exam_metadata = _extract_exam_header_metadata(text)
    if exam_metadata is not None:
        return exam_metadata["rest"]

    patterns = [
        re.compile(
            r"^\s*(?:예제|유제|대표문제|확인문제|기본문제|심화문제|연습문제|문제|Exercise|Problem|Q)\s*\d{1,3}\s*(?P<rest>.*)$"
        ),
        re.compile(r"^\s*\d{1,3}\s*$"),
        re.compile(r"^\s*\d{3,4}\s*[.\s]+\s*(?P<rest>.*)$"),
        re.compile(r"^\s*\d{1,3}\s*\.(?!\d)\s*(?P<rest>.*)$"),
        re.compile(r"^\s*[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳]\s*(?P<rest>.*)$"),
        re.compile(r"^\s*\[\d{1,3}\]\s*(?P<rest>.*)$"),
    ]

    if allow_embedded_number:
        patterns.append(
            re.compile(
                r"^\s*\$?\d{1,3}\s+(?!\\leq|\\geq|\\le(?![a-z])|\\ge(?![a-z])|[<>]|이상|이하)(?P<rest>.*)$"
            )
        )

    for pattern in patterns:
        match = pattern.match(text)
        if match:
            rest = match.groupdict().get("rest", "")
            cleaned = rest.strip()
            if cleaned:
                return _strip_exam_header_prefix(cleaned)
            return cleaned

    return _strip_exam_header_prefix(text.strip())


def _normalize_stem_lines(
    lines: list[OcrLine],
    *,
    allow_embedded_number: bool = False,
) -> list[NormalizedStemLine]:
    """Normalize stem lines by removing the leading problem prefix from the first line only."""
    normalized: list[NormalizedStemLine] = []
    for index, line in enumerate(lines):
        text = line.text
        latex = line.latex or line.text
        if index == 0:
            text = _strip_problem_header(text, allow_embedded_number=allow_embedded_number)
            latex = _strip_problem_header(latex, allow_embedded_number=allow_embedded_number)
            if not text and not latex:
                continue
        normalized.append(NormalizedStemLine(text=text, latex=latex or text))

    if normalized:
        return normalized

    return [NormalizedStemLine(text=line.text, latex=line.latex or line.text) for line in lines]


def _detect_problem_type(lines: list[OcrLine | NormalizedStemLine]) -> str:
    """Detect problem type from content."""
    all_text = " ".join(l.text for l in lines)
    for line in lines:
        if _CHOICE_PATTERN.match(line.text):
            return "multiple_choice"
    if _WRITTEN_KEYWORDS.search(all_text):
        return "written_solution"
    return "short_answer"


def _count_choice_lines(lines: list[OcrLine]) -> int:
    count = 0
    for line in lines:
        text = line.text.strip()
        if _CHOICE_PATTERN.match(text) or _CHOICE_PATTERN_ASCII.match(text):
            count += 1
    return count


def _looks_like_question_prompt(text: str) -> bool:
    stripped = text.strip()
    if not stripped:
        return False
    if _CHOICE_PATTERN.match(stripped) or _CHOICE_PATTERN_ASCII.match(stripped):
        return False
    return bool(_QUESTION_PROMPT_PATTERN.search(stripped) or _POINT_SUFFIX_PATTERN.search(stripped))


def _is_cross_column_textbook(current_lines: list[OcrLine], new_line: OcrLine) -> bool:
    if not current_lines or new_line.bbox_x is None:
        return False
    first_x = next((line.bbox_x for line in current_lines if line.bbox_x is not None), None)
    if first_x is None:
        return False
    return (first_x < _TEXTBOOK_COLUMN_BOUNDARY_X) != (
        new_line.bbox_x < _TEXTBOOK_COLUMN_BOUNDARY_X
    )


def _infer_next_display_number(problem_number: str | None, display_number: str | None) -> tuple[str | None, str | None]:
    if not problem_number or not problem_number.isdigit():
        return None, None

    next_number = str(int(problem_number) + 1)
    if display_number and display_number.isdigit():
        return next_number, next_number.zfill(len(display_number))
    if display_number and display_number.endswith("."):
        return next_number, f"{next_number}."
    if display_number and display_number.startswith("[") and display_number.endswith("]"):
        return next_number, f"[{next_number}]"
    return next_number, next_number


def _should_force_split_into_next_problem(current_lines: list[OcrLine], new_line: OcrLine) -> bool:
    if not current_lines:
        return False
    if _count_choice_lines(current_lines) < 4:
        return False
    if not _looks_like_question_prompt(new_line.text):
        return False

    last_y = next(
        (line.bbox_y for line in reversed(current_lines) if line.bbox_y is not None),
        None,
    )
    new_y = new_line.bbox_y

    if last_y is None or new_y is None:
        return True
    if new_y + 250 < last_y:
        return True
    if new_y - last_y > 220:
        return True
    if _is_cross_column_textbook(current_lines, new_line):
        return True

    return False


def _extract_choices(lines: list[OcrLine | NormalizedStemLine]) -> list[dict] | None:
    """Extract multiple choice options from lines."""
    choice_map = {"①": 1, "②": 2, "③": 3, "④": 4, "⑤": 5}
    choices = []
    for line in lines:
        m = _CHOICE_PATTERN.match(line.text)
        if m:
            label = m.group(0).strip()
            content = line.text[m.end():].strip()
            pos = choice_map.get(label, len(choices) + 1)
            choices.append({
                "position": pos,
                "label": label,
                "content_latex": line.latex or content,
                "content_text": content,
            })
    return choices if choices else None


def _compute_bbox(lines: list[OcrLine]) -> dict | None:
    """Compute union bounding box from lines."""
    xs, ys, x2s, y2s = [], [], [], []
    for line in lines:
        if line.bbox_x is not None and line.bbox_y is not None:
            xs.append(line.bbox_x)
            ys.append(line.bbox_y)
            x2s.append(line.bbox_x + (line.bbox_w or 0))
            y2s.append(line.bbox_y + (line.bbox_h or 0))
    if not xs:
        return None
    x = min(xs)
    y = min(ys)
    return {"x": x, "y": y, "w": max(x2s) - x, "h": max(y2s) - y}


def _build_segment(
    lines: list[OcrLine],
    sub_segments: list[dict],
    start_page: int,
    end_page: int,
    problem_number: str,
    display_number: str,
    chapter: str | None,
    section: str | None,
    problem_category: str | None,
) -> dict:
    """Build a segment dict from collected lines."""
    content_lines = [l for l in lines if not _is_noise_line(l)]
    if not content_lines:
        content_lines = lines

    exam_metadata = _extract_exam_header_metadata(content_lines[0].text) if content_lines else None

    normalized_lines = _normalize_stem_lines(content_lines)
    raw_stem_latex = "\n".join(l.latex for l in normalized_lines)
    raw_stem_text = "\n".join(l.text for l in normalized_lines)
    stem_latex, stem_text, choices = resolve_stem_and_choices(raw_stem_latex, raw_stem_text)
    problem_type = "multiple_choice" if choices else _detect_problem_type(normalized_lines)
    bbox = _compute_bbox(content_lines)

    segment: dict = {
        "problem_number": problem_number,
        "display_number": display_number,
        "problem_label": _extract_problem_label(display_number),
        "problem_type": problem_type,
        "start_page": start_page,
        "end_page": end_page,
        "chapter": chapter,
        "section": section,
        "problem_category": problem_category,
        "stem_latex": stem_latex,
        "stem_text": stem_text,
        "bbox": bbox,
        "choices": choices,
    }

    if exam_metadata:
        segment["exam_source"] = {
            "year": exam_metadata["year"],
            "type": exam_metadata["sourceType"],
            "label": exam_metadata["sourceLabel"],
            "number": exam_metadata["examNumber"],
            "audience": exam_metadata["audience"],
            "form": exam_metadata["form"],
            "raw": exam_metadata["raw"],
        }

    if sub_segments:
        segment["sub_problems"] = sub_segments

    return segment


def _has_ebs_item_codes(pages: list[OcrPage]) -> bool:
    """Check if any page contains EBS item codes like [26008-0001]."""
    for page in pages:
        for line in page.lines:
            if _match_item_code(line.text):
                return True
    return False


# ─── Answer extraction from inline "답" line ───
_ANSWER_EXTRACT = re.compile(r"^\s*[답달뎔]\s*(?:\((\d)\)|([①②③④⑤])|(\d+))")


def _extract_inline_answer(text: str) -> str | None:
    """Extract answer value from a '답 ④', '답 (3)', or '답 125' line."""
    m = _ANSWER_EXTRACT.match(text.strip())
    if not m:
        return None
    # group(1) = parenthesized digit, group(2) = circled number, group(3) = plain number
    return m.group(1) or m.group(2) or m.group(3)


# ─── Standalone local number (appears after item code) ───
_LOCAL_NUMBER_PATTERN = re.compile(r"^\s*(\d{1,3})\s*$")

# ─── EBS Chapter pattern: "01 지수와 로그" ───
_EBS_CHAPTER_PATTERN = re.compile(r"^\s*(0[1-9])\s+\S")

# ─── Leading number at start of text (problem number embedded in stem) ───
_LEADING_NUMBER = re.compile(
    r"^\$?(\d{1,3})\s+(?!\\leq|\\geq|\\le(?![a-z])|\\ge(?![a-z])|[<>]|이상|이하)"
)


def _extract_ebs_local_number(text: str) -> str | None:
    """Extract a local problem number from standalone or inline EBS problem labels."""
    stripped = text.strip()
    standalone = _LOCAL_NUMBER_PATTERN.match(stripped)
    if standalone:
        return str(int(standalone.group(1)))

    leading = _LEADING_NUMBER.match(stripped)
    if leading:
        return str(int(leading.group(1)))

    return None


def _has_nearby_item_code(
    lines: list[OcrLine],
    start_index: int,
    *,
    lookahead: int = 2,
) -> bool:
    """Check whether the current line or the next few lines include an EBS item code."""
    end_index = min(len(lines), start_index + lookahead + 1)
    return any(_match_item_code(lines[idx].text.strip()) is not None for idx in range(start_index, end_index))


def _is_ebs_concept_heading(
    line: OcrLine,
    lines: list[OcrLine],
    line_index: int,
) -> bool:
    """Detect chapter concept headings like '4 등차수열의 합' that are not problems."""
    text = line.text.strip()
    if not text or _has_nearby_item_code(lines, line_index):
        return False

    if _LEADING_NUMBER.match(text) is None:
        return False

    if line.line_number > 5 and (line.bbox_y is None or line.bbox_y > 420):
        return False

    return True


def _build_ebs_segment(
    stem_lines: list[OcrLine],
    start_page: int,
    end_page: int,
    *,
    item_code: str | None,
    section_type: str,
    section_label: str,
    local_number: str,
    display_number: str,
    chapter: str | None,
    inline_solution: str | None,
    inline_answer: str | None,
    inline_hint: str | None,
) -> dict:
    """Build an EBS segment dict from collected lines."""
    content_lines = [l for l in stem_lines if l.line_type not in _SKIP_LINE_TYPES]
    if not content_lines:
        content_lines = stem_lines

    exam_metadata = _extract_exam_header_metadata(content_lines[0].text) if content_lines else None

    normalized_lines = _normalize_stem_lines(
        content_lines,
        allow_embedded_number=section_type in ("practice", "level1", "level2", "level3"),
    )
    raw_stem_latex = "\n".join(l.latex for l in normalized_lines)
    raw_stem_text = "\n".join(l.text for l in normalized_lines)
    stem_latex, stem_text, choices = resolve_stem_and_choices(raw_stem_latex, raw_stem_text)
    problem_type = "multiple_choice" if choices else _detect_problem_type(normalized_lines)
    bbox = _compute_bbox(content_lines)

    segment = {
        "item_code": item_code,
        "section_type": section_type,
        "section_label": section_label,
        "local_number": local_number,
        "display_number": display_number,
        "problem_label": _extract_problem_label(display_number, fallback=section_label),
        "problem_number": local_number,
        "problem_type": problem_type,
        "start_page": start_page,
        "end_page": end_page,
        "chapter": chapter,
        "section": section_label,
        "problem_category": section_type,
        "stem_latex": stem_latex,
        "stem_text": stem_text,
        "bbox": bbox,
        "choices": choices,
        "inline_solution": inline_solution,
        "inline_answer": inline_answer,
        "inline_hint": inline_hint,
    }

    if exam_metadata:
        segment["exam_source"] = {
            "year": exam_metadata["year"],
            "type": exam_metadata["sourceType"],
            "label": exam_metadata["sourceLabel"],
            "number": exam_metadata["examNumber"],
            "audience": exam_metadata["audience"],
            "form": exam_metadata["form"],
            "raw": exam_metadata["raw"],
        }

    return segment


def _ebs_segment(
    pages: list[OcrPage],
    progress_callback: Callable[[int], None] | None = None,
) -> list[dict]:
    """Segment EBS 수능특강 textbook pages using section state machine."""
    segments: list[dict] = []

    # Current section state
    current_section_type: str | None = None
    current_section_label: str = ""
    current_chapter: str | None = None

    # Current problem accumulator
    current_item_code: str | None = None
    current_local_number: str | None = None
    current_display: str = ""
    current_stem_lines: list[OcrLine] = []
    current_page_start: int = 0
    current_inline_hint: str | None = None
    current_inline_solution: str | None = None
    current_inline_answer: str | None = None

    # Inline block accumulation for example/past_exam
    # Tracks which inline block we are currently in: "hint" | "solution" | None
    inline_block_mode: str | None = None
    inline_hint_parts: list[str] = []
    inline_solution_parts: list[str] = []

    # Stop processing after quick_answer or answer_detail sections
    stop_processing = False
    in_concept_block = False
    # Track last flushed local number per (chapter_prefix, section_type)
    # so practice numbering persists across multiple "유제" sub-sections in a chapter
    _last_flushed: dict[tuple[str, str], str] = {}

    def _last_key() -> tuple[str, str]:
        ch_prefix = (current_chapter or "")[:2]
        return (ch_prefix, current_section_type or "practice")

    def _flush_problem(end_page: int) -> None:
        """Flush the current problem into segments."""
        nonlocal current_item_code, current_local_number, current_display
        nonlocal current_stem_lines, current_inline_hint
        nonlocal current_inline_solution, current_inline_answer
        nonlocal inline_block_mode, inline_hint_parts, inline_solution_parts

        # Finalize any open inline blocks
        if inline_hint_parts:
            current_inline_hint = "\n".join(inline_hint_parts)
        if inline_solution_parts:
            current_inline_solution = "\n".join(inline_solution_parts)

        key = _last_key()
        if current_stem_lines and current_local_number is not None:
            segments.append(_build_ebs_segment(
                current_stem_lines,
                current_page_start,
                end_page,
                item_code=current_item_code,
                section_type=current_section_type or "practice",
                section_label=current_section_label,
                local_number=current_local_number,
                display_number=current_display,
                chapter=current_chapter,
                inline_solution=current_inline_solution,
                inline_answer=current_inline_answer,
                inline_hint=current_inline_hint,
            ))
            _last_flushed[key] = current_local_number
        elif current_stem_lines and current_item_code is not None:
            # Has item_code and content but no local_number —
            # infer from last flushed problem in this (chapter, type) group
            prev = _last_flushed.get(key)
            if prev is not None and prev.isdigit():
                inferred = str(int(prev) + 1)
            else:
                inferred = "1"
            segments.append(_build_ebs_segment(
                current_stem_lines,
                current_page_start,
                end_page,
                item_code=current_item_code,
                section_type=current_section_type or "practice",
                section_label=current_section_label,
                local_number=inferred,
                display_number=f"{current_section_label} {inferred}",
                chapter=current_chapter,
                inline_solution=current_inline_solution,
                inline_answer=current_inline_answer,
                inline_hint=current_inline_hint,
            ))
            _last_flushed[key] = inferred

        # Reset problem state
        current_item_code = None
        current_local_number = None
        current_display = ""
        current_stem_lines = []
        current_inline_hint = None
        current_inline_solution = None
        current_inline_answer = None
        inline_block_mode = None
        inline_hint_parts = []
        inline_solution_parts = []

    for page_index, page in enumerate(pages, start=1):
        if stop_processing:
            break

        sorted_lines = sorted(page.lines, key=lambda l: l.line_number)
        for line_index, line in enumerate(sorted_lines):
            if stop_processing:
                break

            # Skip page headers/footers — but allow structural EBS elements through
            # (EBS OCR marks 대표기출문제, Level, 유제, chapter names, 예제 as page_info)
            if line.line_type in _SKIP_LINE_TYPES:
                stripped_pi = line.text.strip()
                if not stripped_pi:
                    continue
                is_structural = (
                    _match_section_transition(stripped_pi) is not None
                    or (current_section_type == "past_exam" and _match_past_exam_year(stripped_pi))
                    or current_section_type == "level_pending"
                    or _EBS_CHAPTER_PATTERN.match(stripped_pi) is not None
                    or _EXAMPLE_PATTERN.match(stripped_pi) is not None
                    # Allow item codes through — they mark problem boundaries
                    or _match_item_code(stripped_pi) is not None
                    # Allow "답" lines through for inline answer capture on examples/past_exam
                    or (current_section_type in ("example", "past_exam")
                        and current_local_number is not None
                        and _is_inline_block(stripped_pi))
                )
                if not is_structural:
                    continue
            text = line.text.strip()
            if not text:
                continue

            # 1. Check for section transition
            transition = _match_section_transition(text)
            if transition:
                sec_type, sec_label = transition
                # Stop at answer sections
                if sec_type in ("quick_answer", "answer_detail"):
                    _flush_problem(page.page_number)
                    stop_processing = True
                    break

                # Handle "Level" alone — resolve from next line context
                if sec_type == "level_pending":
                    _flush_problem(page.page_number)
                    in_concept_block = False
                    # Will be resolved by the next line ("기초 연습" etc.)
                    current_section_type = "level_pending"
                    current_section_label = "Level"
                    continue

                # If section changes from example to practice (유제),
                # flush the current example first
                _flush_problem(page.page_number)
                in_concept_block = False
                current_section_type = sec_type
                current_section_label = sec_label
                continue

            # 1b. Resolve pending "Level" section from follow-up line
            #     OCR may produce "Level\n3 실력 완성" or "Level\n기초 연습"
            if current_section_type == "level_pending":
                # Strip leading digits (OCR may put "3 실력 완성" or "1 기초 연습")
                text_no_num = re.sub(r"^\d+\s*", "", text)
                if "기초" in text_no_num:
                    current_section_type = "level1"
                    current_section_label = "Level 1 기초 연습"
                    continue
                elif "기본" in text_no_num:
                    current_section_type = "level2"
                    current_section_label = "Level 2 기본 연습"
                    continue
                elif "실력" in text_no_num:
                    current_section_type = "level3"
                    current_section_label = "Level 3 실력 완성"
                    continue
                else:
                    # Line doesn't match any level descriptor — resolve to default
                    # but DON'T consume this line (fall through to normal processing)
                    current_section_type = "level1"
                    current_section_label = "Level 1"

            # 2. Check for 예제 N start
            example_match = _match_example_start(text)
            if example_match:
                _flush_problem(page.page_number)
                in_concept_block = False
                current_section_type = "example"
                current_section_label = "예제"
                num, display = example_match
                current_local_number = num
                current_display = display
                current_stem_lines = [line]
                current_page_start = page.page_number
                inline_block_mode = None
                continue

            # 2b. Check for past exam year as problem start (대표기출 section)
            if current_section_type == "past_exam":
                year_label = _match_past_exam_year(text)
                if year_label:
                    _flush_problem(page.page_number)
                    in_concept_block = False
                    current_local_number = year_label
                    current_display = year_label
                    current_page_start = page.page_number
                    inline_block_mode = None
                    continue

            # 3. Check for item code [XXXXX-XXXX]
            item_code = _match_item_code(text)
            if item_code:
                in_concept_block = False
                # Extract local number from the item code line itself
                # e.g. "$\mathbf{6}$\n[26008-0006]$" → number "6"
                code_line_number: str | None = None
                text_before_code = _ITEM_CODE_PATTERN.split(text)[0].strip()
                if text_before_code:
                    m_code_num = re.search(r"(\d{1,3})", text_before_code)
                    if m_code_num:
                        code_line_number = str(int(m_code_num.group(1)))

                if current_item_code is not None:
                    # Text-first ordering: check if tail lines belong to next problem.
                    # Walk backwards past choice lines, find a line with leading number.
                    next_problem_lines: list[OcrLine] = []
                    if current_stem_lines and current_local_number is not None:
                        cur_int = int(current_local_number) if current_local_number.isdigit() else 0
                        # Find split point: line starting with number > current
                        # Use lenient pattern (no space required) — sequential check prevents false positives
                        for i in range(len(current_stem_lines) - 1, max(0, len(current_stem_lines) - 6) - 1, -1):
                            sl_text = current_stem_lines[i].text.strip()
                            m_split = re.match(r"^\$?(\d{1,3})(?!\d)", sl_text)
                            if m_split:
                                candidate = int(m_split.group(1))
                                if cur_int < candidate <= cur_int + 3:
                                    next_problem_lines = current_stem_lines[i:]
                                    current_stem_lines = current_stem_lines[:i]
                                break
                    _flush_problem(page.page_number)
                    current_item_code = item_code
                    current_page_start = page.page_number
                    # Use number from this item code line
                    if code_line_number:
                        current_local_number = code_line_number
                        current_display = f"{current_section_label} {code_line_number}"
                    # Or carry over retroactive lines to the new problem
                    elif next_problem_lines:
                        current_stem_lines = next_problem_lines
                        next_number = _extract_ebs_local_number(next_problem_lines[0].text)
                        if next_number is not None:
                            current_local_number = next_number
                            current_display = f"{current_section_label} {current_local_number}"
                elif current_stem_lines and current_local_number is not None:
                    # Lines with local number accumulated before item code (text-first ordering)
                    # Attach item code to current problem
                    current_item_code = item_code
                elif current_stem_lines:
                    # Lines accumulated but no local number extracted yet
                    # Try to extract from accumulated lines
                    current_item_code = item_code
                    for sl in current_stem_lines:
                        extracted = _extract_ebs_local_number(sl.text)
                        if extracted is not None:
                            current_local_number = extracted
                            current_display = f"{current_section_label} {current_local_number}"
                            break
                else:
                    # Item code comes first (no accumulated text)
                    _flush_problem(page.page_number)
                    current_item_code = item_code
                    current_page_start = page.page_number
                continue

            # 4. Check for inline blocks (잠깐이, 풀이, 답) on example/past_exam
            if current_section_type in ("example", "past_exam") and current_local_number is not None:
                if _is_inline_block(text):
                    # Determine which inline block
                    stripped = text.strip()
                    if re.match(r"^\s*잠깐이?\s*$", stripped, re.IGNORECASE):
                        inline_block_mode = "hint"
                        continue
                    elif re.match(r"^\s*길잡이", stripped):
                        inline_block_mode = "hint"
                        # Capture content on same line after "길잡이"
                        hint_content = re.sub(r"^\s*길잡이\s*", "", stripped)
                        if hint_content:
                            inline_hint_parts.append(hint_content)
                        continue
                    elif re.match(r"^\s*풀이\s", stripped):
                        inline_block_mode = "solution"
                        # Capture content on same line after "풀이"
                        sol_content = re.sub(r"^\s*풀이\s+", "", stripped)
                        if sol_content:
                            inline_solution_parts.append(sol_content)
                        continue
                    elif re.match(r"^\s*풀이\s*$", stripped):
                        inline_block_mode = "solution"
                        continue
                    elif re.match(r"^\s*[답달뎔]\s*[①②③④⑤\d(]", stripped):
                        current_inline_answer = _extract_inline_answer(stripped)
                        inline_block_mode = None
                        continue
                    else:
                        # 출제의도, 출제경향 — skip content (don't leak into stem)
                        inline_block_mode = "skip"
                        continue

                # Accumulate into current inline block
                if inline_block_mode == "hint":
                    inline_hint_parts.append(text)
                    continue
                if inline_block_mode == "solution":
                    inline_solution_parts.append(text)
                    continue
                if inline_block_mode == "skip":
                    continue

            # 5. Check for EBS chapter headers ("01 지수와 로그") — before number extraction
            ebs_ch = _EBS_CHAPTER_PATTERN.match(text)
            if ebs_ch:
                _flush_problem(page.page_number)
                in_concept_block = False
                current_chapter = text.strip()
                # Reset section state — concept text follows chapter header
                current_section_type = None
                current_section_label = ""
                continue

            if _is_ebs_concept_heading(line, sorted_lines, line_index):
                _flush_problem(page.page_number)
                in_concept_block = True
                continue

            if in_concept_block:
                continue

            # 6. If we just got an item code but no local number yet, check for it
            if current_item_code is not None and current_local_number is None:
                # Try standalone number first (very reliable)
                extracted = _extract_ebs_local_number(text)
                if extracted is not None:
                    current_local_number = extracted
                    current_display = f"{current_section_label} {current_local_number}"
                    if _LEADING_NUMBER.match(text):
                        current_stem_lines.append(line)
                    continue
                # Try leading number embedded in text (e.g. "$1 \sqrt...")
                # Validate against sequence to avoid OCR false positives like "$1 a>1$"
                m2 = _LEADING_NUMBER.match(text)
                if m2:
                    candidate = int(m2.group(1))
                    prev = _last_flushed.get(_last_key())
                    prev_int = int(prev) if prev and prev.isdigit() else 0
                    if candidate >= prev_int:
                        current_local_number = str(candidate)
                        current_display = f"{current_section_label} {current_local_number}"
                        current_stem_lines.append(line)
                        continue
                    # else: false positive — fall through to accumulate without local_number

            # 7. Accumulate line into current problem stem
            if current_local_number is not None:
                # Check if this line starts a NEW problem (different leading number)
                # Only for practice/level sections where problems are number-delimited
                # Use strict pattern: bare number at line start (no $ prefix),
                # and number must be sequential (within +5 of current)
                if current_section_type in ("practice", "level1", "level2", "level3"):
                    standalone_new = _LOCAL_NUMBER_PATTERN.match(text)
                    if standalone_new and _has_nearby_item_code(sorted_lines, line_index):
                        new_num = str(int(standalone_new.group(1)))
                        cur_int = int(current_local_number) if current_local_number.isdigit() else 0
                        new_int = int(new_num)
                        if cur_int < new_int <= cur_int + 5:
                            _flush_problem(page.page_number)
                            current_local_number = new_num
                            current_display = f"{current_section_label} {current_local_number}"
                            current_stem_lines = [line]
                            current_page_start = page.page_number
                            inline_block_mode = None
                            continue
                    m_new = re.match(
                        r"^\$?(\d{1,3})\s+(?!\\leq|\\geq|\\le(?![a-z])|\\ge(?![a-z])|[<>]|이상|이하)", text
                    )
                    if m_new:
                        new_num = str(int(m_new.group(1)))
                        cur_int = int(current_local_number) if current_local_number.isdigit() else 0
                        new_int = int(new_num)
                        if cur_int < new_int <= cur_int + 5:
                            _flush_problem(page.page_number)
                            current_local_number = new_num
                            current_display = f"{current_section_label} {current_local_number}"
                            current_stem_lines = [line]
                            current_page_start = page.page_number
                            inline_block_mode = None
                            continue
                current_stem_lines.append(line)
            elif current_section_type in ("practice", "level1", "level2", "level3", "past_exam"):
                # Accumulate even without local number (text-first ordering)
                current_stem_lines.append(line)
                if current_page_start == 0:
                    current_page_start = page.page_number
                standalone = _LOCAL_NUMBER_PATTERN.match(text)
                if standalone and _has_nearby_item_code(sorted_lines, line_index):
                    candidate = int(standalone.group(1))
                    prev = _last_flushed.get(_last_key())
                    prev_int = int(prev) if prev and prev.isdigit() else 0
                    if candidate >= prev_int:
                        current_local_number = str(candidate)
                        current_display = f"{current_section_label} {current_local_number}"
                    continue
                # Try to extract local number from this line
                # Validate against sequence to avoid OCR false positives
                m3 = _LEADING_NUMBER.match(text)
                if m3:
                    candidate = int(m3.group(1))
                    prev = _last_flushed.get(_last_key())
                    prev_int = int(prev) if prev and prev.isdigit() else 0
                    if candidate >= prev_int:
                        current_local_number = str(candidate)
                        current_display = f"{current_section_label} {current_local_number}"

        if progress_callback:
            progress_callback(page_index)

    # Flush last problem
    last_page = pages[-1].page_number if pages else 0
    _flush_problem(last_page)

    return segments


def _rule_based_segment(
    pages: list[OcrPage],
    progress_callback: Callable[[int], None] | None = None,
) -> list[dict]:
    """Segment pages into problems using regex patterns.

    Detects EBS textbooks by checking for item codes and dispatches
    to the EBS-specific state machine if found.
    """
    # EBS detection: if item codes found, use EBS segmentation path
    if pages and _has_ebs_item_codes(pages):
        return _ebs_segment(pages, progress_callback=progress_callback)

    # ─── Original non-EBS segmentation logic ───
    segments: list[dict] = []
    current_lines: list[OcrLine] = []
    current_sub_segments: list[dict] = []
    current_sub_lines: list[OcrLine] = []
    current_sub_number: str | None = None
    current_page_start: int = 0
    current_number: str | None = None
    current_display: str | None = None
    current_chapter: str | None = None
    current_section: str | None = None
    current_category: str | None = None
    in_concept_block = False

    for page_index, page in enumerate(pages, start=1):
        sorted_lines = sorted(page.lines, key=lambda l: l.line_number)
        for line in sorted_lines:
            if _is_noise_line(line):
                continue

            text = line.text.strip()

            # Check for concept blocks — skip until next problem
            if _is_concept_block(text):
                in_concept_block = True
                continue

            # Check for section headers — update metadata, don't add to problems
            if _is_section_header(text):
                current_section = text.strip()
                continue

            # Check for chapter/section headers
            ch = _match_chapter(text)
            if ch:
                current_chapter = ch
                in_concept_block = False
                continue

            # Check for problem start
            match = _match_problem_start(text)
            if match:
                in_concept_block = False

                # Flush sub-problem lines
                if current_sub_number is not None and current_sub_lines:
                    current_sub_segments.append({
                        "sub_number": current_sub_number,
                        "text": "\n".join(l.text for l in current_sub_lines),
                        "latex": "\n".join(l.latex or l.text for l in current_sub_lines),
                    })
                    current_sub_number = None
                    current_sub_lines = []

                # Flush previous problem
                if current_lines and current_number is not None:
                    segments.append(_build_segment(
                        current_lines, current_sub_segments,
                        current_page_start, page.page_number,
                        current_number, current_display or "",
                        current_chapter, current_section,
                        current_category,
                    ))
                    current_sub_segments = []

                current_number, current_display, current_category = match
                current_lines = [line]
                current_page_start = page.page_number
                continue

            # If in a concept block, skip lines
            if in_concept_block:
                continue

            if (
                current_number is not None
                and _should_force_split_into_next_problem(current_lines, line)
            ):
                if current_sub_number is not None and current_sub_lines:
                    current_sub_segments.append({
                        "sub_number": current_sub_number,
                        "text": "\n".join(l.text for l in current_sub_lines),
                        "latex": "\n".join(l.latex or l.text for l in current_sub_lines),
                    })
                    current_sub_number = None
                    current_sub_lines = []

                if current_lines and current_number is not None:
                    segments.append(_build_segment(
                        current_lines, current_sub_segments,
                        current_page_start, page.page_number,
                        current_number, current_display or "",
                        current_chapter, current_section,
                        current_category,
                    ))
                    current_sub_segments = []

                inferred_number, inferred_display = _infer_next_display_number(
                    current_number,
                    current_display,
                )
                current_number = inferred_number
                current_display = inferred_display
                current_lines = [line]
                current_page_start = page.page_number
                continue

            # Check for sub-problem (only if inside a parent problem)
            if current_number is not None:
                sub_num = _match_sub_problem(text)
                if sub_num is not None:
                    # Flush previous sub-problem
                    if current_sub_number is not None and current_sub_lines:
                        current_sub_segments.append({
                            "sub_number": current_sub_number,
                            "text": "\n".join(l.text for l in current_sub_lines),
                            "latex": "\n".join(l.latex or l.text for l in current_sub_lines),
                        })
                    current_sub_number = sub_num
                    current_sub_lines = [line]
                    current_lines.append(line)
                    continue

                # Accumulate sub-problem lines
                if current_sub_number is not None:
                    current_sub_lines.append(line)

            # Accumulate into current problem (or discard if no current problem)
            if current_number is not None:
                current_lines.append(line)

        if progress_callback:
            progress_callback(page_index)

    # Flush last sub-problem
    if current_sub_number is not None and current_sub_lines:
        current_sub_segments.append({
            "sub_number": current_sub_number,
            "text": "\n".join(l.text for l in current_sub_lines),
            "latex": "\n".join(l.latex or l.text for l in current_sub_lines),
        })

    # Flush last problem
    if current_lines and current_number is not None:
        last_page = pages[-1].page_number if pages else 0
        segments.append(_build_segment(
            current_lines, current_sub_segments,
            current_page_start, last_page,
            current_number, current_display or "",
            current_chapter, current_section,
            current_category,
        ))

    return segments
