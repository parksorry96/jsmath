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
import logging
import re

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.celery_app import celery
from app.database import worker_session
from app.models.job import JobStatus, OcrJobTracking
from app.models.ocr import OcrLine, OcrPage
from app.schemas.problem import BBox

logger = logging.getLogger(__name__)

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

_INLINE_BLOCK_PATTERNS = [
    re.compile(r"^\s*잠깐이?\s*$", re.IGNORECASE),
    re.compile(r"^\s*풀이\s*$"),
    re.compile(r"^\s*답\s*[①②③④⑤\d]"),
    re.compile(r"^\s*출제\s*의도"),
    re.compile(r"^\s*출제\s*경향"),
    re.compile(r"^\s*출제의도"),
    re.compile(r"^\s*출제경향"),
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
        return (m.group(1), text.strip())
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

    return asyncio.run(_segment(ocr_job_id, problem_pages, answer_pages, has_quick_answers))


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

    segments = _rule_based_segment(pages)

    from app.services.redis_events import notify_progress

    notify_progress(
        ocr_job_id, "segmentation",
        current=len(segments), total=len(segments),
        message="교재 문제 분할 완료",
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
    if line.line_type in _SKIP_LINE_TYPES:
        return True
    text = line.text.strip()
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
                return str(num), text[:30].strip(), None

        elif i == 3:  # Circled numbers
            circled = m.group("num")
            mapped = _CIRCLED_MAP.get(circled, circled)
            return mapped, text[:30].strip(), None

        elif i == 4:  # [N]
            num = int(m.group("num"))
            if 1 <= num <= _MAX_PROBLEM_NUMBER:
                return str(num), text[:30].strip(), None

    return None


def _detect_problem_type(lines: list[OcrLine]) -> str:
    """Detect problem type from content."""
    all_text = " ".join(l.text for l in lines)
    for line in lines:
        if _CHOICE_PATTERN.match(line.text):
            return "multiple_choice"
    if _WRITTEN_KEYWORDS.search(all_text):
        return "written_solution"
    return "short_answer"


def _extract_choices(lines: list[OcrLine]) -> list[dict] | None:
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

    stem_latex = "\n".join(l.latex or l.text for l in content_lines)
    stem_text = "\n".join(l.text for l in content_lines)
    problem_type = _detect_problem_type(content_lines)
    bbox = _compute_bbox(content_lines)
    choices = _extract_choices(content_lines) if problem_type == "multiple_choice" else None

    segment: dict = {
        "problem_number": problem_number,
        "display_number": display_number,
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
_ANSWER_EXTRACT = re.compile(r"^\s*답\s*([①②③④⑤]|\d+)")


def _extract_inline_answer(text: str) -> str | None:
    """Extract answer value from a '답 ④' or '답 125' line."""
    m = _ANSWER_EXTRACT.match(text.strip())
    return m.group(1) if m else None


# ─── Standalone local number (appears after item code) ───
_LOCAL_NUMBER_PATTERN = re.compile(r"^\s*(\d{1,3})\s*$")

# ─── EBS Chapter pattern: "01 지수와 로그" ───
_EBS_CHAPTER_PATTERN = re.compile(r"^\s*(0[1-9])\s+\S")

# ─── Leading number at start of text (problem number embedded in stem) ───
_LEADING_NUMBER = re.compile(r"^\$?(\d{1,3})\s+")


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

    stem_latex = "\n".join(l.latex or l.text for l in content_lines)
    stem_text = "\n".join(l.text for l in content_lines)
    problem_type = _detect_problem_type(content_lines)
    bbox = _compute_bbox(content_lines)
    choices = _extract_choices(content_lines) if problem_type == "multiple_choice" else None

    return {
        "item_code": item_code,
        "section_type": section_type,
        "section_label": section_label,
        "local_number": local_number,
        "display_number": display_number,
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


def _ebs_segment(pages: list[OcrPage]) -> list[dict]:
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

    for page in pages:
        if stop_processing:
            break

        sorted_lines = sorted(page.lines, key=lambda l: l.line_number)
        for line in sorted_lines:
            if stop_processing:
                break

            # Skip page headers/footers but not empty/short lines (EBS uses them)
            if line.line_type in _SKIP_LINE_TYPES:
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
                    # Will be resolved by the next line ("기초 연습" etc.)
                    current_section_type = "level_pending"
                    current_section_label = "Level"
                    continue

                # If section changes from example to practice (유제),
                # flush the current example first
                _flush_problem(page.page_number)
                current_section_type = sec_type
                current_section_label = sec_label
                continue

            # 1b. Resolve pending "Level" section from follow-up line
            if current_section_type == "level_pending":
                lower = text.lower()
                if "기초" in text:
                    current_section_type = "level1"
                    current_section_label = "Level 1 기초 연습"
                elif "기본" in text:
                    current_section_type = "level2"
                    current_section_label = "Level 2 기본 연습"
                elif "실력" in text:
                    current_section_type = "level3"
                    current_section_label = "Level 3 실력 완성"
                else:
                    # Default to level1 if can't determine
                    current_section_type = "level1"
                    current_section_label = "Level 1"
                continue

            # 2. Check for 예제 N start
            example_match = _match_example_start(text)
            if example_match:
                _flush_problem(page.page_number)
                current_section_type = "example"
                current_section_label = "예제"
                num, display = example_match
                current_local_number = num
                current_display = display
                current_stem_lines = [line]
                current_page_start = page.page_number
                inline_block_mode = None
                continue

            # 3. Check for item code [XXXXX-XXXX]
            item_code = _match_item_code(text)
            if item_code:
                if current_item_code is not None:
                    # Previous item-code problem exists — flush it
                    _flush_problem(page.page_number)
                    current_item_code = item_code
                    current_page_start = page.page_number
                elif current_stem_lines and current_local_number is not None:
                    # Lines with local number accumulated before item code (text-first ordering)
                    # Attach item code to current problem
                    current_item_code = item_code
                elif current_stem_lines:
                    # Lines accumulated but no local number extracted yet
                    # Try to extract from accumulated lines
                    current_item_code = item_code
                    for sl in current_stem_lines:
                        num_m = _LEADING_NUMBER.match(sl.text.strip())
                        if num_m:
                            current_local_number = num_m.group(1)
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
                    elif re.match(r"^\s*풀이\s*$", stripped):
                        inline_block_mode = "solution"
                        continue
                    elif re.match(r"^\s*답\s*[①②③④⑤\d]", stripped):
                        current_inline_answer = _extract_inline_answer(stripped)
                        inline_block_mode = None
                        continue
                    else:
                        # 출제의도, 출제경향 — skip
                        inline_block_mode = None
                        continue

                # Accumulate into current inline block
                if inline_block_mode == "hint":
                    inline_hint_parts.append(text)
                    continue
                if inline_block_mode == "solution":
                    inline_solution_parts.append(text)
                    continue

            # 5. If we just got an item code but no local number yet, check for it
            if current_item_code is not None and current_local_number is None:
                # Try standalone number first
                m = _LOCAL_NUMBER_PATTERN.match(text)
                if m:
                    current_local_number = m.group(1)
                    current_display = f"{current_section_label} {current_local_number}"
                    continue
                # Try leading number embedded in text (e.g. "$1 \sqrt...")
                m2 = _LEADING_NUMBER.match(text)
                if m2:
                    current_local_number = m2.group(1)
                    current_display = f"{current_section_label} {current_local_number}"
                    current_stem_lines.append(line)
                    continue

            # 6. Check for EBS chapter headers ("01 지수와 로그")
            ebs_ch = _EBS_CHAPTER_PATTERN.match(text)
            if ebs_ch:
                current_chapter = text.strip()
                continue

            # 7. Accumulate line into current problem stem
            if current_local_number is not None:
                current_stem_lines.append(line)
            elif current_section_type in ("practice", "level1", "level2", "level3", "past_exam"):
                # Accumulate even without local number (text-first ordering)
                current_stem_lines.append(line)
                if current_page_start == 0:
                    current_page_start = page.page_number
                # Try to extract local number from this line
                m3 = _LEADING_NUMBER.match(text)
                if m3:
                    current_local_number = m3.group(1)
                    current_display = f"{current_section_label} {current_local_number}"

    # Flush last problem
    last_page = pages[-1].page_number if pages else 0
    _flush_problem(last_page)

    return segments


def _rule_based_segment(pages: list[OcrPage]) -> list[dict]:
    """Segment pages into problems using regex patterns.

    Detects EBS textbooks by checking for item codes and dispatches
    to the EBS-specific state machine if found.
    """
    # EBS detection: if item codes found, use EBS segmentation path
    if pages and _has_ebs_item_codes(pages):
        return _ebs_segment(pages)

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

    for page in pages:
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
