"""Celery task: segment OCR output into individual math problems.

Two-pass approach:
  1. Rule-based: regex patterns on OcrLine text to find problem boundaries.
  2. OpenAI correction: send candidate segments for merge/split validation.
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
from app.schemas.problem import BBox, PROBLEM_NUMBER_PATTERNS, SegmentedProblem

logger = logging.getLogger(__name__)

# Line types from Mathpix that are never problem content
_SKIP_LINE_TYPES = {"page_info", "page_header", "page_footer"}

# Noise text patterns to filter out (section headers, footers, instructions)
_NOISE_PATTERNS = re.compile(
    r"^\s*[-○·※*]?\s*("
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
# Only use the "N." format — the "N 한글" format causes too many false positives
# (e.g., "1 개 더 많을 확률은?" misdetected as problem 1)
MAIN_PROBLEM_PATTERNS = [
    re.compile(r"^\s*(\d{1,3})\s*\.(?!\d)\s*"),  # "1." but NOT "1.0"
]

SUB_PROBLEM_PATTERNS = [
    re.compile(PROBLEM_NUMBER_PATTERNS[2]),  # "(1)"
    re.compile(PROBLEM_NUMBER_PATTERNS[3]),  # "1)"
    re.compile(PROBLEM_NUMBER_PATTERNS[4]),  # "(가)"
]

CHOICE_PATTERN = re.compile(PROBLEM_NUMBER_PATTERNS[6])  # ①②③④⑤

# Two-column layout: if a line's x is this far from the problem's avg x,
# it's likely from a different column and should be skipped.
_COLUMN_X_THRESHOLD = 600


def _is_cross_column(current_lines: list[OcrLine], new_line: OcrLine) -> bool:
    """Check if new_line is from a different column than current_lines."""
    if not current_lines or new_line.bbox_x is None:
        return False
    xs = [l.bbox_x for l in current_lines if l.bbox_x is not None]
    if not xs:
        return False
    avg_x = sum(xs) / len(xs)
    return abs(new_line.bbox_x - avg_x) > _COLUMN_X_THRESHOLD


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


@celery.task(
    bind=True,
    name="task.problem.segment",
    max_retries=2,
    default_retry_delay=10,
    retry_backoff=True,
    acks_late=True,
)
def segment_problems(
    self,
    parse_result: dict | None = None,
    *,
    ocr_job_id: str | None = None,
) -> dict:
    """Segment OCR lines into individual problems."""
    if parse_result:
        ocr_job_id = parse_result["ocr_job_id"]
    if not ocr_job_id:
        raise ValueError("ocr_job_id is required")

    return asyncio.run(_segment(self, ocr_job_id))


async def _segment(task, ocr_job_id: str) -> dict:
    async with worker_session() as session:
        # Update status
        job_result = await session.execute(
            select(OcrJobTracking).where(OcrJobTracking.id == ocr_job_id)
        )
        job = job_result.scalar_one()
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

    # Pass 1: Rule-based segmentation
    segments = _rule_based_segment(pages)

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


def _rule_based_segment(pages: list[OcrPage]) -> list[SegmentedProblem]:
    """First pass: rule-based segmentation using regex patterns on OCR lines."""
    segments: list[SegmentedProblem] = []
    current_lines: list[OcrLine] = []
    current_page_start: int = 0
    current_problem_number: str | None = None
    current_display_number: str | None = None

    for page in pages:
        sorted_lines = sorted(page.lines, key=lambda l: l.line_number)
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
                # Skip lines from a different column (two-column PDF layout)
                if _is_cross_column(current_lines, line):
                    continue
                current_lines.append(line)

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

    return segments


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

    stem_latex = "\n".join(line.latex or line.text for line in content_lines)
    stem_text = "\n".join(line.text for line in content_lines)
    problem_type = _detect_problem_type(content_lines)
    bbox = _compute_bbox(content_lines)

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
    )
