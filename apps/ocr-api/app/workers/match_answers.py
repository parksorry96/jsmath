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
_QA_CHAPTER_PATTERN = re.compile(r"^\s*(0[1-9])\s+\S")

_QA_SECTION_MAP = {
    "유제": "practice",
    "Level 1": "level1", "Level 1 기초 연습": "level1",
    "Level 2": "level2", "Level 2 기본 연습": "level2",
    "Level 3": "level3", "Level 3 실력 완성": "level3",
}

# Patterns for answer pairs in quick answer table
# Formats: "1 (1)", "3125", "1 ①", "5100", "1 (5)"
_QA_PAIR_PATTERN = re.compile(r"(\d{1,2})\s+([①②③④⑤]|\d+)")
_QA_PAREN_PAIR_PATTERN = re.compile(r"(\d{1,2})\s*\((\d)\)")  # "1 (5)" or "1(5)"
_QA_SINGLE_LINE_PATTERN = re.compile(r"^(\d{1,2})\s*\((\d)\)\s*$")  # standalone "1 (5)"
# Concatenated cell: OCR drops space/parens → "65" = prob 6 ans 5, "3125" = prob 3 ans 125
# Prefer 1-digit problem number (sections rarely exceed 12 problems)
_QA_CONCAT_CELL_1 = re.compile(r"^(\d)(\d+)$")   # "3125" → prob 3, ans 125
_QA_CONCAT_CELL_2 = re.compile(r"^(\d{2})(\d+)$") # fallback: "102" → prob 10, ans 2

# ─── EBS Solution Section Patterns ───
# Chapter header: "01 지수와 로그"
_SOL_CHAPTER_PATTERN = re.compile(r"^\s*(0[1-9])\s+\S")
# Section labels in solution section
_SOL_SECTION_MAP = {
    "유제": "practice",
    "Level 1": "level1", "Level 1 기초 연습": "level1",
    "Level 2": "level2", "Level 2 기본 연습": "level2",
    "Level 3": "level3", "Level 3 실력 완성": "level3",
    "대표 기출": "past_exam", "대표기출": "past_exam",
}
# Problem number at start of solution: "$1 ...", "1 조건", "$3 \frac{..."
_SOL_PROBLEM_START = re.compile(r"^\$?(\d{1,2})\s+")
# No-space problem start for lines without $ prefix:
# "N(content..." or "Ncontent..." where N is a single digit (1-9)
# Only match when not currently inside a problem (used after flush/answer)
_SOL_PROBLEM_START_NOSPACE = re.compile(r"^\$?(\d)(.+)$")
# Standalone number on a line: "1", "2", "$3" (problem number alone, content on next line)
_SOL_STANDALONE_NUM = re.compile(r"^\$?(\d{1,2})\s*$")
# Answer line marking end of a solution: "답 (3)", "답 125", "답 (5)"
_SOL_ANSWER_LINE = re.compile(r"^(?:답|뎝|달|뎔)\s+(.+)$")


def _clean_latex_table(text: str) -> str:
    """Strip LaTeX table markup to extract plain-text cell content."""
    # Remove \begin{tabular}..., \end{tabular}, \hline, column specs
    cleaned = re.sub(r"\\begin\{tabular\}\{[^}]*\}", "", text)
    cleaned = re.sub(r"\\end\{tabular\}", "", cleaned)
    cleaned = re.sub(r"\\hline", "", cleaned)
    cleaned = re.sub(r"\\multicolumn\{\d+\}\{[^}]*\}\{([^}]*)\}", r"\1", cleaned)
    # Remove \mathbf{N} → N
    cleaned = re.sub(r"\\mathbf\{(\d+)\}", r"\1", cleaned)
    # Remove remaining LaTeX: $, \, {, }
    cleaned = re.sub(r"[$\\{}]", "", cleaned)
    # Split on & (table column separator) and \\\\ (row separator)
    cleaned = re.sub(r"\\\\", " ", cleaned)
    cleaned = re.sub(r"&", " ", cleaned)
    # Collapse whitespace
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned


def _parse_answer_cells(
    text: str,
    result: dict[tuple[str, str, str], str],
    current_chapter: str,
    current_section: str,
) -> None:
    """Parse answer pairs from a text string into the result dict."""
    # Try parenthesized format first: "1 (5)", "4 (4)"
    paren_matched = False
    for m in _QA_PAREN_PAIR_PATTERN.finditer(text):
        num = m.group(1)
        ans = f"({m.group(2)})"
        result[(current_chapter, current_section, num)] = ans
        paren_matched = True

    if not paren_matched:
        # Try spaced pair: "1 ①", "3 125"
        pair_matched = False
        for m in _QA_PAIR_PATTERN.finditer(text):
            num = m.group(1)
            ans = m.group(2)
            result[(current_chapter, current_section, num)] = ans
            pair_matched = True

        # Fallback: concatenated cell where OCR dropped space/parens
        # Prefer 1-digit prob number: "3125" → prob 3, ans 125
        if not pair_matched:
            cm = _QA_CONCAT_CELL_1.match(text)
            if cm:
                result[(current_chapter, current_section, cm.group(1))] = cm.group(2)
            else:
                cm2 = _QA_CONCAT_CELL_2.match(text)
                if cm2:
                    result[(current_chapter, current_section, cm2.group(1))] = cm2.group(2)


def _parse_ebs_quick_answer_table(
    pages: list,
) -> dict[tuple[str, str, str], str]:
    """Parse '한눈에 보는 정답' page into (chapter, section_type, number) -> answer map."""
    result: dict[tuple[str, str, str], str] = {}
    current_chapter: str | None = None
    current_section: str | None = None
    pending_level: bool = False  # "Level" alone on a line

    for page in pages:
        sorted_lines = sorted(page.lines, key=lambda l: l.line_number)
        for line in sorted_lines:
            text = line.text.strip()
            if not text:
                continue

            # Parse LaTeX table lines — extract plain-text cells for answer pairs
            if line.line_type == "table" and "\\begin{tabular}" in text:
                cleaned = _clean_latex_table(text)
                # Extract section labels from cleaned table content
                for label, stype in _QA_SECTION_MAP.items():
                    if label in cleaned:
                        current_section = stype
                # Check for Level N subheaders
                level_m = re.search(r"Level\s*(\d)\s*(기초|기본|실력)", cleaned)
                if level_m:
                    lvl_map = {"기초": "level1", "기본": "level2", "실력": "level3"}
                    current_section = lvl_map.get(level_m.group(2), current_section)
                # Parse answer pairs from cleaned text
                if current_chapter and current_section:
                    _parse_answer_cells(cleaned, result, current_chapter, current_section)
                continue

            # Skip non-content lines
            if text.startswith("www.") or text.startswith("본문") or text.startswith("\\"):
                continue

            # Check chapter header
            cm = _QA_CHAPTER_PATTERN.match(text)
            if cm:
                current_chapter = cm.group(1)
                current_section = None
                pending_level = False
                continue

            # Handle pending "Level" from previous line
            if pending_level:
                pending_level = False
                text_no_num = re.sub(r"^\d+\s*", "", text)
                if "기초" in text_no_num:
                    current_section = "level1"
                elif "기본" in text_no_num:
                    current_section = "level2"
                elif "실력" in text_no_num:
                    current_section = "level3"
                continue

            # Check section label
            if text.startswith("Level") and text.strip() == "Level":
                pending_level = True
                continue

            matched_section = False
            for label, stype in _QA_SECTION_MAP.items():
                if text.startswith(label):
                    current_section = stype
                    matched_section = True
                    break
            if matched_section:
                if text in _QA_SECTION_MAP:
                    continue

            # Parse answer pairs from simple_cell and text lines
            if current_chapter and current_section:
                _parse_answer_cells(text, result, current_chapter, current_section)

    return result


def _parse_ebs_solution_section(
    pages: list,
) -> dict[tuple[str, str, str], dict]:
    """Parse '정답과 풀이' pages into (chapter, section_type, number) -> solution map.

    Structure per chapter:
    - Chapter header: "01 지수와 로그"
    - Section header: "유제" / "Level 2 기본 연습" etc.
    - Answer summary block: short lines like "1 (4)", "2 (3)" right after section header
    - Per problem: starts with "$N content..." (long line), ends with "답 (N)" or "답 N"
    """
    result: dict[tuple[str, str, str], dict] = {}
    current_chapter: str | None = None
    current_section: str | None = None
    current_number: str | None = None
    current_lines: list = []
    in_summary_block = False  # True when reading answer summary after section header
    pending_level = False  # True when "Level" appeared alone on previous line
    pending_problem: str | None = None  # Problem number alone on a line, waiting for content
    summary_max_num = 0  # Highest problem number seen in current summary block

    # Pattern for short answer summary lines: "1 (4)", "3125", "7 (4) 8 (5)"
    _SUMMARY_LINE = re.compile(
        r"^[\d\s()\[\]①②③④⑤]+$"
    )
    # Extract leading number from summary line
    _SUMMARY_NUM = re.compile(r"^(\d{1,2})")

    def _flush():
        nonlocal current_number, current_lines
        if current_chapter and current_section and current_number and current_lines:
            key = (current_chapter, current_section, current_number)
            # Skip if all we have is a single short "답" line (just the answer, no solution)
            real_content = [
                ln for ln in current_lines
                if not _SOL_ANSWER_LINE.match(ln.text.strip())
            ]
            if real_content:
                latex_parts = []
                text_parts = []
                for ln in current_lines:
                    latex_parts.append(getattr(ln, "latex", None) or ln.text)
                    text_parts.append(ln.text)
                result[key] = {
                    "solution_latex": "\n".join(latex_parts),
                    "solution_text": "\n".join(text_parts),
                }
        current_number = None
        current_lines = []

    for page in pages:
        sorted_lines = sorted(page.lines, key=lambda l: l.line_number)

        for line in sorted_lines:
            text = line.text.strip()
            if not text:
                continue
            if line.line_type in ("page_header", "page_footer"):
                continue
            # Skip page info unless it contains answer lines
            if line.line_type == "page_info":
                if not _SOL_ANSWER_LINE.match(text):
                    continue

            # Chapter header
            cm = _SOL_CHAPTER_PATTERN.match(text)
            if cm:
                _flush()
                current_chapter = cm.group(1)
                current_section = None
                in_summary_block = False
                pending_level = False
                pending_problem = None
                continue

            # Handle pending "Level" from previous line
            # e.g., line 1: "Level", line 2: "3 실력 완성"
            if pending_level:
                pending_level = False
                text_no_num = re.sub(r"^\d+\s*", "", text)
                if "기초" in text_no_num:
                    _flush()
                    current_section = "level1"
                    in_summary_block = True; summary_max_num = 0
                    continue
                elif "기본" in text_no_num:
                    _flush()
                    current_section = "level2"
                    in_summary_block = True; summary_max_num = 0
                    continue
                elif "실력" in text_no_num:
                    _flush()
                    current_section = "level3"
                    in_summary_block = True; summary_max_num = 0
                    continue

            # "Level" alone on a line — wait for next line
            if text.strip() == "Level":
                pending_level = True
                continue

            # Section header — check both direct text and table content
            matched_section = False
            check_text = text
            # For table lines, also check cleaned content for section labels
            if line.line_type == "table":
                check_text = _clean_latex_table(text)
            for label, stype in _SOL_SECTION_MAP.items():
                if label in check_text:
                    _flush()
                    current_section = stype
                    in_summary_block = True; summary_max_num = 0
                    matched_section = True
                    break
            # Also detect OCR-garbled "Level" in tables: "ㄱovel", "Lovel", etc.
            if not matched_section and line.line_type == "table":
                cleaned = _clean_latex_table(text)
                if "기초" in cleaned and "연습" in cleaned:
                    _flush()
                    current_section = "level1"
                    in_summary_block = True; summary_max_num = 0
                    matched_section = True
                elif "기본" in cleaned and "연습" in cleaned:
                    _flush()
                    current_section = "level2"
                    in_summary_block = True; summary_max_num = 0
                    matched_section = True
                elif "실력" in cleaned and "완성" in cleaned:
                    _flush()
                    current_section = "level3"
                    in_summary_block = True; summary_max_num = 0
                    matched_section = True
            if not matched_section:
                for label, stype in _SOL_SECTION_MAP.items():
                    if text.startswith(label) or text == label:
                        _flush()
                        current_section = stype
                        in_summary_block = True; summary_max_num = 0
                        matched_section = True
                        break
            if matched_section:
                continue

            if not current_chapter or not current_section:
                continue

            # Skip answer summary block (short lines like "1 (4)", "2 (3)", etc.)
            if in_summary_block:
                if _SUMMARY_LINE.match(text):
                    # Check if this is a number reset (solution start, not summary)
                    nm = _SUMMARY_NUM.match(text)
                    if nm:
                        num_val = int(nm.group(1))
                        if summary_max_num >= 3 and num_val < summary_max_num:
                            # Number went backwards — summary is done, this is solution start
                            in_summary_block = False
                        else:
                            summary_max_num = max(summary_max_num, num_val)
                            continue
                    else:
                        continue
                # Also skip "본문 N~N쪽" reference lines
                if in_summary_block and text.startswith("본문"):
                    continue
                in_summary_block = False

            # Handle pending problem number from previous line
            # e.g., line N: "1", line N+1: "$\begin{aligned}..."
            if pending_problem is not None:
                pn = pending_problem
                pending_problem = None
                # If this line has substantial content (math, text), confirm as problem start
                am_check = _SOL_ANSWER_LINE.match(text)
                if not am_check and len(text) > 3:
                    prev_int = int(current_number) if current_number and current_number.isdigit() else 0
                    if int(pn) != prev_int:
                        _flush()
                        current_number = pn
                        current_lines = [line]
                        continue
                # Otherwise, it was just a stray number — fall through

            # Answer line — flush current problem with its solution
            am = _SOL_ANSWER_LINE.match(text)
            if am:
                if current_number:
                    current_lines.append(line)
                    _flush()
                continue

            # New problem start: "$N content..." where content is substantial
            pm = _SOL_PROBLEM_START.match(text)
            if pm:
                candidate = int(pm.group(1))
                if 1 <= candidate <= 30:
                    after_num = text[pm.end():].strip()
                    if len(after_num) > 3:
                        # Inline content — real problem start
                        prev_int = int(current_number) if current_number and current_number.isdigit() else 0
                        if candidate != prev_int:
                            _flush()
                            current_number = str(candidate)
                            current_lines = [line]
                            continue
                    else:
                        # Number with little/no content — defer to next line
                        pending_problem = str(candidate)
                        continue

            # No-space problem start: "$2(\sqrt...", "$8\left..." (OCR drops space)
            # Only try when we're between problems (just flushed) to avoid false positives
            if current_number is None:
                pm2 = _SOL_PROBLEM_START_NOSPACE.match(text)
                if pm2:
                    candidate = int(pm2.group(1))
                    content = pm2.group(2)
                    if 1 <= candidate <= 30 and len(content) > 3:
                        current_number = str(candidate)
                        current_lines = [line]
                        continue

            # Standalone number on a line: "1", "$3" (no trailing content at all)
            sm = _SOL_STANDALONE_NUM.match(text)
            if sm:
                candidate = int(sm.group(1))
                if 1 <= candidate <= 30:
                    pending_problem = str(candidate)
                    continue

            # Accumulate lines for current problem
            if current_number:
                current_lines.append(line)

    _flush()

    return result


def _fix_two_column_misattribution(
    solutions: dict[tuple[str, str, str], dict],
    quick_answers: dict[tuple[str, str, str], str],
) -> dict[tuple[str, str, str], dict]:
    """Fix solutions wrongly attributed due to two-column OCR layout.

    In two-column layouts, OCR reads left column (solutions) before right
    column (section header). This causes solutions for a new section to be
    stored under the previous section's key.

    Fix: compare the answer line in each solution against the quick answer
    table. If they don't match but another section's quick answer does,
    reassign the solution to the correct section.
    """
    if not quick_answers:
        return solutions

    _ANS_EXTRACT = re.compile(r"(?:답|뎝|달|뎔)\s+(.+)$")
    # Normalize answer values: "(3)" -> "(3)", "125" -> "125"
    def _norm(ans: str) -> str:
        return ans.strip().replace(" ", "")

    def _extract_answer(sol: dict) -> str | None:
        """Extract the last '답 ...' value from solution text."""
        for line in reversed(sol.get("solution_text", "").split("\n")):
            m = _ANS_EXTRACT.search(line.strip())
            if m:
                return _norm(m.group(1))
        return None

    # All section types in order of typical appearance
    section_order = ["practice", "level1", "level2", "level3", "past_exam"]

    # Collect keys to reassign: {wrong_key: correct_key}
    reassignments: dict[tuple, tuple] = {}

    for key, sol in list(solutions.items()):
        chapter, section, number = key
        sol_answer = _extract_answer(sol)
        if sol_answer is None:
            continue

        qa_expected = quick_answers.get(key)
        if qa_expected is None:
            continue

        # Check if solution answer matches expected quick answer
        if _norm(qa_expected) == sol_answer:
            continue  # Correct attribution

        # Mismatch — try to find the correct section
        for other_sec in section_order:
            if other_sec == section:
                continue
            other_key = (chapter, other_sec, number)
            other_qa = quick_answers.get(other_key)
            if other_qa and _norm(other_qa) == sol_answer:
                # Found the correct section — only reassign if
                # the target key doesn't already have a solution
                if other_key not in solutions:
                    reassignments[key] = other_key
                    break
                # Target already has a solution — keep looking

    # Apply reassignments
    for wrong_key, correct_key in reassignments.items():
        solutions[correct_key] = solutions.pop(wrong_key)
        logger.info(
            "Reassigned solution %s -> %s (two-column layout fix)",
            wrong_key, correct_key,
        )

    return solutions


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

    # Parse EBS solution section (정답과 풀이) if this is an EBS textbook
    ebs_solutions: dict[tuple[str, str, str], dict] = {}
    if ebs_answers and pages:
        # Skip quick answer pages — solution pages start after
        qa_end = quick_answer_pages_range[1] if quick_answer_pages_range else 0
        solution_pages = [p for p in pages if p.page_number > qa_end]
        if solution_pages:
            ebs_solutions = _parse_ebs_solution_section(solution_pages)
            # Fix two-column layout misattributions using quick answer table
            ebs_solutions = _fix_two_column_misattribution(ebs_solutions, ebs_answers)
            logger.info(
                "Parsed EBS solutions for job %s: %d entries",
                ocr_job_id, len(ebs_solutions),
            )

    # Two-phase matching (non-EBS path)
    # Phase 1: Parse quick answer table (if present)
    quick_answers: dict[str, str] = {}
    # Phase 2: Parse detailed solutions
    solution_map: dict[str, dict] = {}

    if not ebs_answers:
        if has_quick_answers and pages:
            quick_pages, solution_pages = _split_answer_sections(pages)
            quick_answers = _parse_quick_answer_table(quick_pages)
            solution_map = _parse_answer_section(solution_pages)
        elif pages:
            solution_map = _parse_answer_section(pages)

    # Phase 3: Merge — inline > EBS quick answer + solution > legacy
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

        # Try EBS quick answer table + solution section
        chapter = seg.get("chapter", "")
        chapter_num = chapter[:2] if chapter else ""
        section_type = seg.get("section_type", "")
        local_num = seg.get("local_number", "")
        ebs_key = (chapter_num, section_type, local_num)

        if ebs_key in ebs_answers:
            seg["answer_text"] = ebs_answers[ebs_key]
            # Attach solution from 정답과 풀이 if available
            sol = ebs_solutions.get(ebs_key)
            seg["solution_latex"] = sol["solution_latex"] if sol else None
            seg["solution_text"] = sol["solution_text"] if sol else None
            seg["answer_match_status"] = "matched"
            seg["match_confidence"] = 0.95 if sol else 0.9
            matched_count += 1
            continue

        # EBS textbook but not in quick answer table — try solution section only
        if ebs_answers:
            sol = ebs_solutions.get(ebs_key)
            if sol:
                seg["answer_text"] = None
                seg["solution_latex"] = sol["solution_latex"]
                seg["solution_text"] = sol["solution_text"]
                seg["answer_match_status"] = "matched"
                seg["match_confidence"] = 0.7
                matched_count += 1
            else:
                seg["answer_text"] = None
                seg["solution_latex"] = None
                seg["solution_text"] = None
                seg["answer_match_status"] = "unmatched"
                seg["match_confidence"] = 0.0
            continue

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
