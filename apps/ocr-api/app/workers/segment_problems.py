"""Celery task: segment OCR output into individual math problems.

Two-pass approach:
  1. Rule-based: regex patterns on OcrLine text to find problem boundaries.
  2. OpenAI correction: send candidate segments for merge/split validation.
"""

from __future__ import annotations

import asyncio
import logging
import re
import unicodedata
from dataclasses import dataclass
from typing import Any, Callable

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.celery_app import celery
from app.database import worker_session
from app.models.job import JobStatus, OcrJobTracking
from app.models.ocr import OcrLine, OcrPage
from app.schemas.problem import PROBLEM_NUMBER_PATTERNS, BBox, SegmentedProblem
from app.workers.boxed_blocks import build_boxed_layout
from app.workers.choice_parser import resolve_stem_and_choices

logger = logging.getLogger(__name__)

# Line types from Mathpix that are never problem content
_SKIP_LINE_TYPES = {"page_info", "page_header", "page_footer"}

# Noise text patterns to filter out (section headers, footers, instructions)
_NOISE_PATTERNS = re.compile(
    r"^\s*(?:\\?\$|[-○·※*])?\s*("
    r"5지선다형"
    r"|단답형"
    r"|서술형"
    r"|논술형"
    r"|\*?\s*확인\s*사항"
    r"|답안지의\s*해당란"
    r"|이어서"
    r"|수학\s*영역"
    r"|제\s*\d\s*교시"
    r"|학년도"
    r"|이\s*문제지에\s*관한"
    r"|홀수형"
    r"|짝수형"
    r"|선택과목"
    r"|선택한\s*과목"
    r"|과목인지\s*확인"
    r")\s*",
    re.IGNORECASE,
)

# Main problem patterns with negative lookahead to avoid matching decimals like "1.0"
# Accept both ASCII and full-width dots because Mathpix often emits "17．".
MAIN_PROBLEM_PATTERNS = [
    re.compile(r"^\s*(\d{1,3})\s*[\.．](?!\d)\s*"),
]

SUB_PROBLEM_PATTERNS = [
    re.compile(PROBLEM_NUMBER_PATTERNS[2]),  # "(1)"
    re.compile(PROBLEM_NUMBER_PATTERNS[3]),  # "1)"
    re.compile(PROBLEM_NUMBER_PATTERNS[4]),  # "(가)"
]

CHOICE_PATTERN = re.compile(PROBLEM_NUMBER_PATTERNS[6])  # ①②③④⑤
_BOUNDARY_SKIP_PATTERN = re.compile(r"^\s*(?:[①②③④⑤]|[\(（][1-5][\)）]|[1-5][.)])\s*")

_DEFAULT_COLUMN_BOUNDARY_X = 1000.0  # fallback x-px boundary between left/right columns
_MIN_COLUMN_GAP_X = 220.0  # minimum horizontal gap (px) to consider a column split
_MIN_LINES_PER_COLUMN = 4  # minimum lines required to treat a side as a column
_HEADER_SCAN_LINES = 10  # number of top lines scanned for page header detection
_REFERENCE_TABLE_KEYWORDS = ("표준정규분포표", "정규분포표")
_TABULAR_SUFFIX_PATTERN = re.compile(
    r"(?P<prefix>.*?)(?:\n(?P<table>\\begin\{tabular\}.*?\\end\{tabular\}))\s*$",
    re.DOTALL,
)


@dataclass
class ExamPageContext:
    page_number: int
    form: str | None = None
    section_subject: str | None = None
    is_common_page: bool | None = None
    academic_year: int | None = None
    exam_year: int | None = None
    exam_month: int | None = None
    exam_type: str | None = None


def _normalize_page_header_text(value: str) -> str:
    return unicodedata.normalize("NFKC", value).replace(" ", "")


def _extract_page_header(page: OcrPage) -> str:
    header_lines = sorted(page.lines, key=lambda line: line.line_number)[:_HEADER_SCAN_LINES]
    texts = [line.text.strip() for line in header_lines if line.text and line.text.strip()]
    return "\n".join(texts)


def _detect_page_subject(normalized_header: str) -> str | None:
    if re.search(r"(?:확률과통계|확률통계|학률과통계)", normalized_header):
        return "확률과 통계"
    if "미적분" in normalized_header:
        return "미적분"
    if "기하" in normalized_header:
        return "기하"
    return None


def _classify_exam_page(page: OcrPage) -> ExamPageContext:
    header = _extract_page_header(page)
    normalized_header = _normalize_page_header_text(header)
    form: str | None = None
    if "홀수형" in normalized_header:
        form = "odd"
    elif "짝수형" in normalized_header:
        form = "even"

    exam_type = "suneung" if ("대학수학능력시험" in normalized_header or "수능" in normalized_header) else None
    academic_year_match = re.search(r"(20\d{2})학년도", normalized_header)
    academic_year = (
        int(academic_year_match.group(1))
        if academic_year_match
        else None
    )

    section_subject = _detect_page_subject(normalized_header)
    is_common_page: bool | None = None
    if exam_type == "suneung":
        is_common_page = section_subject is None and "수학영역" in normalized_header

    exam_month = 11 if exam_type == "suneung" else None
    exam_year = academic_year - 1 if academic_year and exam_month else None

    return ExamPageContext(
        page_number=page.page_number,
        form=form,
        section_subject=section_subject,
        is_common_page=is_common_page,
        academic_year=academic_year,
        exam_year=exam_year,
        exam_month=exam_month,
        exam_type=exam_type,
    )


def _build_exam_page_contexts(pages: list[OcrPage]) -> dict[int, ExamPageContext]:
    contexts: dict[int, ExamPageContext] = {}
    last_form: str | None = None
    last_subject: str | None = None
    last_academic_year: int | None = None
    last_exam_year: int | None = None
    last_exam_month: int | None = None
    last_exam_type: str | None = None

    for page in sorted(pages, key=lambda item: item.page_number):
        context = _classify_exam_page(page)
        if context.form is None:
            context.form = last_form
        if context.exam_type is None:
            context.exam_type = last_exam_type
        if context.academic_year is None:
            context.academic_year = last_academic_year
        if context.exam_year is None:
            context.exam_year = last_exam_year
        if context.exam_month is None:
            context.exam_month = last_exam_month

        if context.is_common_page is True:
            context.section_subject = None
        elif context.section_subject is None:
            context.section_subject = last_subject

        contexts[page.page_number] = context

        if context.form is not None:
            last_form = context.form
        if context.section_subject is not None:
            last_subject = context.section_subject
        if context.academic_year is not None:
            last_academic_year = context.academic_year
        if context.exam_year is not None:
            last_exam_year = context.exam_year
        if context.exam_month is not None:
            last_exam_month = context.exam_month
        if context.exam_type is not None:
            last_exam_type = context.exam_type

    return contexts


def _filter_dual_form_pages(
    pages: list[OcrPage],
    page_contexts: dict[int, ExamPageContext],
    *,
    preferred_form: str = "odd",
) -> list[OcrPage]:
    available_forms = {
        context.form
        for context in page_contexts.values()
        if context.form in {"odd", "even"}
    }
    if preferred_form not in available_forms or len(available_forms) < 2:
        return pages
    return [
        page
        for page in pages
        if page_contexts.get(page.page_number, ExamPageContext(page.page_number)).form != {
            "odd": "even",
            "even": "odd",
        }.get(preferred_form, "odd")
    ]


def _annotate_exam_segments(
    segments: list[SegmentedProblem],
    page_contexts: dict[int, ExamPageContext],
) -> list[SegmentedProblem]:
    for segment in segments:
        context = page_contexts.get(segment.start_page)
        if not context or not context.exam_type:
            continue

        question_number = None
        if segment.problem_number and segment.problem_number.isdigit():
            question_number = int(segment.problem_number)

        is_common = (
            context.is_common_page
            if context.is_common_page is not None
            else (
                context.exam_type == "suneung"
                and question_number is not None
                and question_number <= 22
            )
        )

        exam_source: dict[str, Any] = {
            "type": context.exam_type,
            "form": context.form,
            "academicYear": context.academic_year,
            "year": context.exam_year,
            "month": context.exam_month,
            "isCommon": is_common,
        }
        if question_number is not None:
            exam_source["number"] = question_number
        if context.section_subject and not is_common:
            exam_source["subject"] = context.section_subject
            segment.subject = context.section_subject

        segment.is_common = is_common
        segment.exam_source = exam_source

    return segments


def _sort_page_lines_for_reading_order(lines: list[OcrLine]) -> list[OcrLine]:
    sorted_lines = sorted(lines, key=lambda line: line.line_number)
    positioned_lines = [
        line
        for line in sorted_lines
        if line.bbox_x is not None and line.bbox_y is not None and not _is_noise_line(line)
    ]
    if len(positioned_lines) < _MIN_LINES_PER_COLUMN * 2:
        return sorted_lines

    boundary_x = _infer_column_boundary(positioned_lines)
    left_count = sum(1 for line in positioned_lines if line.bbox_x is not None and line.bbox_x < boundary_x)
    right_count = len(positioned_lines) - left_count
    if left_count < _MIN_LINES_PER_COLUMN or right_count < _MIN_LINES_PER_COLUMN:
        return sorted_lines

    def sort_key(line: OcrLine) -> tuple[float, float, float, int]:
        if line.bbox_x is None or line.bbox_y is None:
            return (0.0, float(line.line_number), 0.0, line.line_number)
        column = 0.0 if line.bbox_x < boundary_x else 1.0
        return (column, float(line.bbox_y), float(line.bbox_x), line.line_number)

    return sorted(sorted_lines, key=sort_key)


def _infer_column_boundary(lines: list[OcrLine]) -> float:
    """Infer a per-page column boundary from OCR x-positions.

    Exam PDFs are usually two-column, but a fixed global boundary is brittle:
    right-column answer choices often spread horizontally past 1400px, while
    the actual gutter sits much closer to ~700-1000px depending on render size.
    """
    xs = sorted(
        float(line.bbox_x)
        for line in lines
        if (
            line.bbox_x is not None
            and not _is_noise_line(line)
            and not _BOUNDARY_SKIP_PATTERN.match(line.text)
        )
    )
    if len(xs) < _MIN_LINES_PER_COLUMN * 2:
        return _DEFAULT_COLUMN_BOUNDARY_X

    best_gap = 0.0
    boundary = _DEFAULT_COLUMN_BOUNDARY_X
    for index, (left_x, right_x) in enumerate(zip(xs, xs[1:], strict=False)):
        gap = right_x - left_x
        left_count = index + 1
        right_count = len(xs) - left_count
        if (
            gap >= _MIN_COLUMN_GAP_X
            and left_count >= _MIN_LINES_PER_COLUMN
            and right_count >= _MIN_LINES_PER_COLUMN
            and gap > best_gap
        ):
            best_gap = gap
            boundary = (left_x + right_x) / 2.0

    return boundary


def _is_noise_line(line: OcrLine) -> bool:
    """Check if a line is noise (page info, headers, footers, instructions)."""
    if line.line_type in _SKIP_LINE_TYPES:
        return True
    text = line.text.strip()
    if not text:
        return True
    # Pure page numbers (just digits, up to 3 chars)
    if re.match(r"^\d{1,3}$", text):
        return True
    if _NOISE_PATTERNS.match(text):
        return True
    # Orphan continuation of noise lines (e.g., "하시오." on its own line)
    if len(text) <= 5 and text.endswith("시오."):
        return True
    return False


def _is_main_problem_start(text: str) -> re.Match | None:
    """Check if a line starts a new main problem."""
    for pattern in MAIN_PROBLEM_PATTERNS:
        m = pattern.match(text)
        if m:
            return m
    return None


def _is_sub_problem_start(text: str) -> re.Match | None:
    """Check if a line starts a sub-problem."""
    for pattern in SUB_PROBLEM_PATTERNS:
        m = pattern.match(text)
        if m:
            return m
    return None


def _detect_problem_type(lines: list[OcrLine]) -> str:
    """Detect problem type based on content patterns."""
    all_text = " ".join(line.text for line in lines)
    for line in lines:
        if CHOICE_PATTERN.match(line.text):
            return "multiple_choice"
    if re.search(r"풀이\s*과정|서술하|설명하", all_text):
        return "written_solution"
    return "short_answer"


def _split_tabular_suffix(content: str) -> tuple[str, str | None]:
    if not content:
        return "", None
    match = _TABULAR_SUFFIX_PATTERN.match(content.strip())
    if not match:
        return content.strip(), None
    prefix = match.group("prefix").rstrip()
    table = match.group("table").strip()
    return prefix, table


def _relocate_reference_tables(segments: list[SegmentedProblem]) -> list[SegmentedProblem]:
    """Move trailing reference tables back to the previous problem when needed.

    OCR reading order sometimes attaches a right-side 표준정규분포표 to the next
    problem instead of the current one. When the previous problem explicitly
    references a normal-distribution table, relocate only the trailing tabular
    suffix from the next problem.
    """
    for index in range(1, len(segments)):
        previous = segments[index - 1]
        current = segments[index]
        if not any(keyword in previous.stem_text for keyword in _REFERENCE_TABLE_KEYWORDS):
            continue

        cleaned_current_latex, moved_latex = _split_tabular_suffix(current.stem_latex)
        cleaned_current_text, moved_text = _split_tabular_suffix(current.stem_text)
        if not moved_latex and not moved_text:
            continue

        previous.stem_latex = (
            f"{previous.stem_latex.rstrip()}\n{(moved_latex or moved_text or '').strip()}".strip()
        )
        previous.stem_text = (
            f"{previous.stem_text.rstrip()}\n{(moved_text or moved_latex or '').strip()}".strip()
        )
        current.stem_latex = cleaned_current_latex
        current.stem_text = cleaned_current_text

    return segments


@celery.task(
    bind=True,
    name="task.problem.segment",
    max_retries=2,
    default_retry_delay=10,
    retry_backoff=True,
    acks_late=True,
)
def segment_problems(
    self: Any,
    parse_result: dict[str, Any] | None = None,
    *,
    ocr_job_id: str | None = None,
) -> dict[str, Any]:
    """Segment OCR lines into individual problems."""
    if parse_result:
        ocr_job_id = parse_result["ocr_job_id"]
    if not ocr_job_id:
        raise ValueError("ocr_job_id is required")

    return asyncio.run(_segment(self, ocr_job_id))


async def _segment(task: Any, ocr_job_id: str) -> dict[str, Any]:
    async with worker_session() as session:
        # Idempotency: skip if job already past segmenting stage
        job_result = await session.execute(
            select(OcrJobTracking).where(OcrJobTracking.id == ocr_job_id)
        )
        job = job_result.scalar_one()
        if job.status in (JobStatus.completed, JobStatus.cropping, JobStatus.classifying):
            logger.info("Skipping segmentation for job %s — already at status %s", ocr_job_id, job.status.value)
            return {"ocr_job_id": ocr_job_id, "problem_count": job.problem_count or 0, "segments": [], "skipped": True}
        job.status = JobStatus.segmenting
        await session.commit()

        # Fetch all pages with lines
        pages_result = await session.execute(
            select(OcrPage)
            .where(OcrPage.ocr_job_id == ocr_job_id)
            .options(selectinload(OcrPage.lines))
            .order_by(OcrPage.page_number)
        )
        pages = pages_result.scalars().all()

    page_contexts = _build_exam_page_contexts(pages)
    filtered_pages = _filter_dual_form_pages(pages, page_contexts, preferred_form="odd")

    if len(filtered_pages) != len(pages):
        logger.info(
            "Filtered dual-form exam pages for job %s: kept %d/%d pages (preferred_form=odd)",
            ocr_job_id,
            len(filtered_pages),
            len(pages),
        )

    from app.services.redis_events import notify_progress
    total_pages = len(filtered_pages)
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
            message=f"문제 분할 중 ({processed_pages}/{total_pages} 페이지)",
        )

    # Pass 1: Rule-based segmentation
    segments = _rule_based_segment(filtered_pages, progress_callback=report_progress)
    segments = _annotate_exam_segments(segments, page_contexts)

    notify_progress(
        ocr_job_id,
        "segmentation",
        current=total_pages,
        total=total_pages,
        message=f"문제 분할 완료 ({len(segments)}문제)",
    )

    logger.info(
        "Rule-based segmentation found %d problems for job %s",
        len(segments),
        ocr_job_id,
    )

    # TODO: Pass 2 -- OpenAI correction for edge cases (after math-expert discussion)
    # segments = await _openai_correct(segments)

    return {
        "ocr_job_id": ocr_job_id,
        "problem_count": len(segments),
        "segments": [s.model_dump() for s in segments],
    }


def _rule_based_segment(
    pages: list[OcrPage],
    progress_callback: Callable[[int], None] | None = None,
) -> list[SegmentedProblem]:
    """First pass: rule-based segmentation using regex patterns on OCR lines."""
    segments: list[SegmentedProblem] = []
    current_lines: list[OcrLine] = []
    current_page_start: int = 0
    current_problem_number: str | None = None
    current_display_number: str | None = None

    for page_index, page in enumerate(pages, start=1):
        sorted_lines = _sort_page_lines_for_reading_order(page.lines)
        for line in sorted_lines:
            # Skip noise lines (page_info, headers, footers, etc.)
            if _is_noise_line(line):
                continue

            match = _is_main_problem_start(line.text)
            if match:
                matched_num = int(match.group(1)) if match.lastindex else 0

                # Only accept problem numbers in 1-50 range
                if 1 <= matched_num <= 50:
                    # Flush previous problem
                    if current_lines:
                        segments.append(_build_segment(
                            current_lines,
                            current_page_start,
                            page.page_number,
                            current_problem_number,
                            current_display_number,
                        ))

                    # Start new problem
                    current_lines = [line]
                    current_page_start = page.page_number
                    current_problem_number = str(matched_num)
                    current_display_number = line.text[:20].strip()
                else:
                    current_lines.append(line)
            else:
                # Ignore preface/orphan text before the first detected problem.
                if not current_lines and current_problem_number is None:
                    continue
                current_lines.append(line)

        if progress_callback:
            progress_callback(page_index)

    # Flush last problem
    if current_lines and current_problem_number is not None:
        last_page = pages[-1].page_number if pages else 0
        segments.append(_build_segment(
            current_lines,
            current_page_start,
            last_page,
            current_problem_number,
            current_display_number,
        ))

    return _relocate_reference_tables(segments)


def _compute_bbox(lines: list[OcrLine]) -> BBox | None:
    """Compute union bounding box from lines that have bbox data."""
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
    return BBox(x=x, y=y, w=max(x2s) - x, h=max(y2s) - y)


def _build_segment(
    lines: list[OcrLine],
    start_page: int,
    end_page: int,
    problem_number: str | None,
    display_number: str | None,
) -> SegmentedProblem:
    """Build a SegmentedProblem from a group of OCR lines."""
    # Filter out any remaining noise that slipped through
    content_lines = [l for l in lines if not _is_noise_line(l)]
    if not content_lines:
        content_lines = lines  # fallback

    raw_stem_latex = "\n".join(line.latex or line.text for line in content_lines)
    raw_stem_text = "\n".join(line.text for line in content_lines)
    stem_latex, stem_text, choices = resolve_stem_and_choices(raw_stem_latex, raw_stem_text)
    problem_type = "multiple_choice" if choices else _detect_problem_type(content_lines)
    bbox = build_boxed_layout(
        source_lines=content_lines,
        display_lines=content_lines,
    )

    return SegmentedProblem(
        problem_number=problem_number,
        display_number=display_number,
        problem_type=problem_type,
        start_page=start_page,
        end_page=end_page,
        start_line=0,
        end_line=len(content_lines) - 1,
        stem_latex=stem_latex,
        stem_text=stem_text,
        bbox=bbox,
        choices=choices,
    )
