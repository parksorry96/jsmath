"""Celery task: match answers from answer section to segmented problems.

Supports:
- Standard answer parsing (N. answer)
- Quick answer table parsing (0001③ 0002② format from 쎈/RPM)
- Two-phase matching: quick answers + detailed solutions
- Confidence scoring for match quality
"""

from __future__ import annotations

import asyncio
import logging
import re

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.celery_app import celery
from app.database import worker_session
from app.models.ocr import OcrLine, OcrPage

logger = logging.getLogger(__name__)

# Patterns for parsing answer entries (e.g., "1. ③", "2. 42", "3) answer text")
_ANSWER_NUM_PATTERNS = [
    re.compile(r"^\s*(\d{1,4})\s*[.)\]]\s*"),
    re.compile(r"^\s*\[(\d{1,4})\]\s*"),
    re.compile(r"^\s*\((\d{1,4})\)\s*"),
]

# Quick answer table pattern: "0001③ 0002② 0003①..."
_ANSWER_TABLE_PATTERN = re.compile(r"(\d{1,4})\s*([①②③④⑤]|\d+)")

# "빠른 정답" section header
_QUICK_ANSWER_HEADER = re.compile(r"빠른\s*정답", re.IGNORECASE)

# Detailed solution section header
_SOLUTION_HEADER = re.compile(
    r"^\s*(정답\s*(및|과)?\s*해설|해설|풀이|정답\s*(및|과)?\s*풀이)\s*$",
    re.IGNORECASE,
)

# Multiple choice answer pattern
_MC_ANSWER = re.compile(r"^[①②③④⑤]$")

# ─── EBS Quick Answer Table Patterns ───
_QA_CHAPTER_PATTERN = re.compile(r"^\s*(\d{2})\s+\S")

_QA_SECTION_MAP = {
    "유제": "practice",
    "Level 1": "level1", "Level 1 기초 연습": "level1",
    "Level 2": "level2", "Level 2 기본 연습": "level2",
    "Level 3": "level3", "Level 3 실력 완성": "level3",
}

_QA_PAIR_PATTERN = re.compile(r"(\d{1,2})\s+([①②③④⑤]|\d+)")


def _parse_ebs_quick_answer_table(
    pages: list,
) -> dict[tuple[str, str, str], str]:
    """Parse '한눈에 보는 정답' page into (chapter, section_type, number) -> answer map."""
    result: dict[tuple[str, str, str], str] = {}
    current_chapter: str | None = None
    current_section: str | None = None

    for page in pages:
        sorted_lines = sorted(page.lines, key=lambda l: l.line_number)
        for line in sorted_lines:
            text = line.text.strip()
            if not text:
                continue

            # Check chapter header
            cm = _QA_CHAPTER_PATTERN.match(text)
            if cm:
                current_chapter = cm.group(1)
                current_section = None
                continue

            # Check section label
            matched_section = False
            for label, stype in _QA_SECTION_MAP.items():
                if text.startswith(label):
                    current_section = stype
                    matched_section = True
                    break
            if matched_section:
                # Don't continue - the same line might have answers after the label
                # But for clean lines like just "유제", skip
                if text in _QA_SECTION_MAP:
                    continue

            # Parse answer pairs
            if current_chapter and current_section:
                for m in _QA_PAIR_PATTERN.finditer(text):
                    num = m.group(1)
                    ans = m.group(2)
                    result[(current_chapter, current_section, num)] = ans

    return result


@celery.task(
    bind=True,
    name="task.textbook.match_answers",
    max_retries=2,
    default_retry_delay=10,
    acks_late=True,
)
def match_answers(
    self,
    prev_result: dict | None = None,
    *,
    ocr_job_id: str | None = None,
) -> dict:
    """Match answers from answer section to problem segments."""
    if prev_result:
        ocr_job_id = ocr_job_id or prev_result.get("ocr_job_id")
    if not ocr_job_id:
        raise ValueError("ocr_job_id is required")

    segments = prev_result.get("segments", []) if prev_result else []
    answer_pages = prev_result.get("answer_pages") if prev_result else None
    has_quick_answers = prev_result.get("has_quick_answers", False) if prev_result else False

    return asyncio.run(
        _match(ocr_job_id, segments, answer_pages, has_quick_answers, prev_result)
    )


async def _match(
    ocr_job_id: str,
    segments: list[dict],
    answer_pages: list[int] | None,
    has_quick_answers: bool,
    prev_result: dict | None = None,
) -> dict:
    # Load EBS quick answer table if available
    quick_answer_pages_range = prev_result.get("quick_answer_pages") if prev_result else None
    ebs_answers: dict[tuple[str, str, str], str] = {}
    if quick_answer_pages_range:
        async with worker_session() as session:
            qa_pages_result = await session.execute(
                select(OcrPage)
                .where(
                    OcrPage.ocr_job_id == ocr_job_id,
                    OcrPage.page_number >= quick_answer_pages_range[0],
                    OcrPage.page_number <= quick_answer_pages_range[1],
                )
                .options(selectinload(OcrPage.lines))
                .order_by(OcrPage.page_number)
            )
            qa_pages = qa_pages_result.scalars().all()
        ebs_answers = _parse_ebs_quick_answer_table(qa_pages)

    # No answer section and no EBS answers — mark all as no_answer_key
    if not answer_pages and not ebs_answers:
        for seg in segments:
            # Check inline answers even when no answer section exists
            if seg.get("inline_answer"):
                seg["answer_text"] = seg["inline_answer"]
                seg["solution_text"] = seg.get("inline_solution")
                seg["solution_latex"] = seg.get("inline_solution")
                seg["answer_match_status"] = "inline"
                seg["match_confidence"] = 1.0
                continue
            seg["answer_text"] = None
            seg["solution_latex"] = None
            seg["solution_text"] = None
            seg["answer_match_status"] = "no_answer_key"
            seg["match_confidence"] = 0.0

        from app.services.redis_events import notify_progress

        matched_count = sum(1 for s in segments if s.get("answer_match_status") == "inline")
        notify_progress(
            ocr_job_id, "answer_matching",
            message="답안 섹션 없음" if matched_count == 0
            else f"인라인 답안 {matched_count}건 매칭",
        )

        return {
            "ocr_job_id": ocr_job_id,
            "segments": segments,
            "problem_count": len(segments),
            "matched_count": matched_count,
        }

    # Load answer section pages
    pages: list = []
    if answer_pages:
        async with worker_session() as session:
            pages_result = await session.execute(
                select(OcrPage)
                .where(
                    OcrPage.ocr_job_id == ocr_job_id,
                    OcrPage.page_number >= answer_pages[0],
                    OcrPage.page_number <= answer_pages[1],
                )
                .options(selectinload(OcrPage.lines))
                .order_by(OcrPage.page_number)
            )
            pages = pages_result.scalars().all()

    # Two-phase matching
    # Phase 1: Parse quick answer table (if present)
    quick_answers: dict[str, str] = {}
    # Phase 2: Parse detailed solutions
    solution_map: dict[str, dict] = {}

    if has_quick_answers and pages:
        quick_pages, solution_pages = _split_answer_sections(pages)
        quick_answers = _parse_quick_answer_table(quick_pages)
        solution_map = _parse_answer_section(solution_pages)
    elif pages:
        solution_map = _parse_answer_section(pages)

    # Phase 3: Merge — inline > EBS quick answer > legacy quick answer > solution
    matched_count = 0
    for seg in segments:
        # Check if inline answer exists (예제, 대표기출)
        if seg.get("inline_answer"):
            seg["answer_text"] = seg["inline_answer"]
            seg["solution_text"] = seg.get("inline_solution")
            seg["solution_latex"] = seg.get("inline_solution")
            seg["answer_match_status"] = "inline"
            seg["match_confidence"] = 1.0
            matched_count += 1
            continue

        # Try EBS quick answer table
        chapter = seg.get("chapter", "")
        chapter_num = chapter[:2] if chapter else ""
        section_type = seg.get("section_type", "")
        local_num = seg.get("local_number", "")
        ebs_key = (chapter_num, section_type, local_num)

        if ebs_key in ebs_answers:
            seg["answer_text"] = ebs_answers[ebs_key]
            seg["solution_text"] = None
            seg["solution_latex"] = None
            seg["answer_match_status"] = "matched"
            seg["match_confidence"] = 0.9
            matched_count += 1
            continue

        # Fall back to legacy number-based matching
        pnum = seg.get("problem_number")
        if not pnum:
            seg["answer_text"] = None
            seg["solution_latex"] = None
            seg["solution_text"] = None
            seg["answer_match_status"] = "unmatched"
            seg["match_confidence"] = 0.0
            continue

        answer_text = quick_answers.get(pnum)
        solution = solution_map.get(pnum, {})

        # If no quick answer, try answer from solution section
        if not answer_text and solution:
            answer_text = solution.get("answer_text")

        seg["answer_text"] = answer_text
        seg["solution_latex"] = solution.get("solution_latex")
        seg["solution_text"] = solution.get("solution_text")

        if answer_text or solution:
            seg["answer_match_status"] = "matched"
            seg["match_confidence"] = _compute_match_confidence(seg, answer_text)
            matched_count += 1
        else:
            seg["answer_match_status"] = "unmatched"
            seg["match_confidence"] = 0.0

    from app.services.redis_events import notify_progress

    notify_progress(
        ocr_job_id, "answer_matching",
        current=matched_count, total=len(segments),
        message=f"답안 매칭 {matched_count}/{len(segments)}",
    )

    logger.info(
        "Answer matching for job %s: %d/%d matched "
        "(ebs_answers=%d, quick_answers=%d, solutions=%d)",
        ocr_job_id, matched_count, len(segments),
        len(ebs_answers), len(quick_answers), len(solution_map),
    )

    return {
        "ocr_job_id": ocr_job_id,
        "segments": segments,
        "problem_count": len(segments),
        "matched_count": matched_count,
    }


def _split_answer_sections(
    pages: list[OcrPage],
) -> tuple[list[OcrPage], list[OcrPage]]:
    """Split pages into quick-answer pages and detailed-solution pages.

    The quick answer table usually comes first, followed by detailed solutions.
    """
    solution_start_idx = len(pages)

    for i, page in enumerate(pages):
        if i == 0:
            continue  # First page is likely the quick answer header page
        sorted_lines = sorted(page.lines, key=lambda l: l.line_number)
        for line in sorted_lines[:5]:
            text = line.text.strip()
            if _SOLUTION_HEADER.match(text):
                solution_start_idx = i
                break
        if solution_start_idx < len(pages):
            break

    return pages[:solution_start_idx], pages[solution_start_idx:]


def _parse_quick_answer_table(pages: list[OcrPage]) -> dict[str, str]:
    """Parse '0001③ 0002② 0003①...' format from quick answer tables."""
    answers: dict[str, str] = {}
    for page in pages:
        sorted_lines = sorted(page.lines, key=lambda l: l.line_number)
        for line in sorted_lines:
            text = line.text or ""
            if line.line_type in ("page_info", "page_header", "page_footer"):
                continue
            for m in _ANSWER_TABLE_PATTERN.finditer(text):
                num = str(int(m.group(1)))  # normalize: "0001" -> "1"
                ans = m.group(2)
                answers[num] = ans
    return answers


def _parse_answer_section(pages: list[OcrPage]) -> dict[str, dict]:
    """Parse answer section lines into a map of problem_number -> answer data."""
    answer_map: dict[str, dict] = {}
    current_number: str | None = None
    current_lines: list[OcrLine] = []

    for page in pages:
        sorted_lines = sorted(page.lines, key=lambda l: l.line_number)
        for line in sorted_lines:
            text = line.text.strip()
            if not text:
                continue
            if line.line_type in ("page_info", "page_header", "page_footer"):
                continue

            # Try to match a new answer entry
            matched_num = _match_answer_number(text)
            if matched_num is not None:
                # Flush previous entry
                if current_number is not None and current_lines:
                    answer_map[current_number] = _build_answer_entry(current_lines)
                current_number = matched_num
                current_lines = [line]
            elif current_number is not None:
                current_lines.append(line)

    # Flush last entry
    if current_number is not None and current_lines:
        answer_map[current_number] = _build_answer_entry(current_lines)

    return answer_map


def _match_answer_number(text: str) -> str | None:
    """Try to extract a problem number from an answer line."""
    for pattern in _ANSWER_NUM_PATTERNS:
        m = pattern.match(text)
        if m:
            return str(int(m.group(1)))  # normalize
    return None


def _build_answer_entry(lines: list[OcrLine]) -> dict:
    """Build an answer entry from collected lines."""
    # First line likely contains the answer itself
    first_text = lines[0].text.strip()
    # Strip the number prefix from first line
    for pattern in _ANSWER_NUM_PATTERNS:
        m = pattern.match(first_text)
        if m:
            first_text = first_text[m.end():].strip()
            break

    answer_text = first_text
    solution_parts_latex = []
    solution_parts_text = []

    # Remaining lines are the solution/explanation
    for line in lines[1:]:
        solution_parts_latex.append(line.latex or line.text)
        solution_parts_text.append(line.text)

    return {
        "answer_text": answer_text,
        "solution_latex": "\n".join(solution_parts_latex) if solution_parts_latex else None,
        "solution_text": "\n".join(solution_parts_text) if solution_parts_text else None,
    }


def _compute_match_confidence(segment: dict, answer_text: str | None) -> float:
    """Compute confidence score for a problem-answer match."""
    if not answer_text:
        return 0.3  # has solution but no direct answer

    score = 0.5  # number matched

    # Multiple choice answer matches expected type
    problem_type = segment.get("problem_type", "")
    if problem_type == "multiple_choice" and _MC_ANSWER.match(answer_text):
        score += 0.3

    # Short numeric answer for short_answer type
    if problem_type == "short_answer" and re.match(r"^-?\d+\.?\d*$", answer_text):
        score += 0.2

    return min(1.0, score)
