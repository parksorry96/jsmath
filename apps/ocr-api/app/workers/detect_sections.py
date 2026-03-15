"""Celery task: detect answer/solution section boundaries in a textbook PDF.

Uses COMPOUND signal detection:
1. Keyword match in top lines of each page
2. Verification via number reset and minimum section length (5+ pages)
3. Also detects content_start_page (skips 표지/목차/서문)
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

# Keywords that signal the start of an answer/solution section
_ANSWER_KEYWORDS = re.compile(
    r"^\s*(정답\s*(및|과)?\s*해설|정답\s*(및|과)?\s*풀이|해설|풀이|정답|해답|답|"
    r"빠른\s*정답|"
    r"Answers?\s*(and)?\s*Solutions?|Solutions?|Answers?)\s*$",
    re.IGNORECASE,
)

# "빠른 정답" specific keyword (quick answer tables in 쎈/RPM)
_QUICK_ANSWER_KEYWORD = re.compile(r"빠른\s*정답", re.IGNORECASE)

# "한눈에 보는 정답" keyword (EBS 수능특강 quick answer overview page)
_QUICK_ANSWER_PAGE_KEYWORD = re.compile(r"한눈에\s*보는\s*정답", re.IGNORECASE)

_PAGE_REF_PATTERN = re.compile(r"\bp\.\s*\d{1,4}\b", re.IGNORECASE)
_ANSWER_TABLE_PAIR_PATTERN = re.compile(r"\b\d{1,3}\s*(?:\([1-5]\)|[①②③④⑤]|\d{1,4})\b")
_ANSWER_TABLE_HINT_PATTERN = re.compile(r"\\begin\{tabular\}|문번|답\s*란|문제편\s*p\.", re.IGNORECASE)
_QUESTION_HINT_PATTERN = re.compile(
    r"(?:값은[？?]|구하시오|옳은 것을|고른 것은|최댓값|최솟값|개수|나머지|합은|적당한 것은)",
    re.IGNORECASE,
)
_CHOICE_HINT_PATTERN = re.compile(r"^\s*(?:[①②③④⑤⑥⑦⑧⑨⑩]|\(\s*[1-5]\s*\)|（\s*[1-5]\s*）)")
_EXAM_HEADER_PATTERN = re.compile(
    r"^\s*\d{1,4}\s*.*20\d{2}.*(?:학평|모평|수능|경찰|사관)",
    re.IGNORECASE,
)

# Problem number patterns used to detect content_start_page
_CONTENT_START_PATTERNS = [
    re.compile(r"^\s*(?:예제|유제|대표문제|확인문제|기본문제|심화문제|연습문제|문제)\s*\d{1,3}"),
    re.compile(r"^\s*\d{3,4}\s*[.\s]"),       # 0001, 001
    re.compile(r"^\s*\d{1,3}\s*\.(?!\d)"),     # 1.
    re.compile(r"^\s*[①②③④⑤⑥⑦⑧⑨⑩]"),        # circled numbers
    re.compile(r"^\s*\[\d{1,3}\]"),            # [1]
]

# Minimum consecutive pages to confirm an answer section
_MIN_SECTION_LENGTH = 5


@celery.task(
    bind=True,
    name="task.textbook.detect_sections",
    max_retries=2,
    default_retry_delay=10,
    acks_late=True,
)
def detect_sections(
    self,
    prev_result: dict | None = None,
    *,
    ocr_job_id: str | None = None,
) -> dict:
    """Detect where the answer/solution section starts in a textbook."""
    if prev_result:
        ocr_job_id = ocr_job_id or prev_result.get("ocr_job_id")
    if not ocr_job_id:
        raise ValueError("ocr_job_id is required")

    return asyncio.run(_detect(ocr_job_id))


async def _detect(ocr_job_id: str) -> dict:
    async with worker_session() as session:
        pages_result = await session.execute(
            select(OcrPage)
            .where(OcrPage.ocr_job_id == ocr_job_id)
            .options(selectinload(OcrPage.lines))
            .order_by(OcrPage.page_number)
        )
        pages = pages_result.scalars().all()

    if not pages:
        logger.warning("No pages found for job %s", ocr_job_id)
        return {
            "ocr_job_id": ocr_job_id,
            "content_start_page": 0,
            "problem_pages": [0, 0],
            "answer_pages": None,
            "has_quick_answers": False,
            "quick_answer_pages": None,
        }

    total_pages = len(pages)
    first_page = pages[0].page_number
    last_page = pages[-1].page_number

    # 1. Detect content_start_page (skip 표지/목차/서문)
    content_start_page = _find_content_start(pages)

    # 2. Scan from 40% of document for answer section keywords
    scan_start_idx = int(total_pages * 0.7)
    answer_start_page: int | None = None
    has_quick_answers = False

    for page in pages[scan_start_idx:]:
        sorted_lines = sorted(page.lines, key=lambda l: l.line_number)
        if _looks_like_answer_table_page(page):
            candidate_page = page.page_number
            remaining = last_page - candidate_page + 1
            if remaining >= _MIN_SECTION_LENGTH:
                answer_start_page = candidate_page
                has_quick_answers = True
                break
        for line in sorted_lines[:5]:
            text = line.text.strip()
            if not text:
                continue
            if _ANSWER_KEYWORDS.match(text):
                # Check for "빠른 정답" specifically
                if _QUICK_ANSWER_KEYWORD.search(text):
                    has_quick_answers = True

                # COMPOUND verification: check remaining pages >= _MIN_SECTION_LENGTH
                candidate_page = page.page_number
                remaining = last_page - candidate_page + 1
                if remaining >= _MIN_SECTION_LENGTH:
                    answer_start_page = candidate_page
                    break
                # If section is too short, might be a false positive — keep scanning
        if answer_start_page is not None:
            break

    # If no quick answer detected in header scan, also check first few lines of
    # answer section pages for the keyword
    if answer_start_page and not has_quick_answers:
        for page in pages:
            if page.page_number < answer_start_page:
                continue
            if page.page_number > answer_start_page + 3:
                break
            for line in sorted(page.lines, key=lambda l: l.line_number)[:10]:
                if _QUICK_ANSWER_KEYWORD.search(line.text):
                    has_quick_answers = True
                    break
            if has_quick_answers:
                break

    # Detect EBS "한눈에 보는 정답" quick answer overview page
    quick_answer_page = _find_quick_answer_page(pages)

    if answer_start_page is not None:
        problem_pages = [content_start_page, answer_start_page - 1]
        answer_pages: list[int] | None = [answer_start_page, last_page]
    else:
        problem_pages = [content_start_page, last_page]
        answer_pages = None

    from app.services.redis_events import notify_progress

    notify_progress(ocr_job_id, "detect_sections", message="섹션 감지 완료")

    logger.info(
        "Detected sections for job %s: content_start=%d, problems=%s, answers=%s, quick_answers=%s, quick_answer_pages=%s",
        ocr_job_id,
        content_start_page,
        problem_pages,
        answer_pages,
        has_quick_answers,
        [quick_answer_page, quick_answer_page] if quick_answer_page else None,
    )

    return {
        "ocr_job_id": ocr_job_id,
        "content_start_page": content_start_page,
        "problem_pages": problem_pages,
        "answer_pages": answer_pages,
        "has_quick_answers": has_quick_answers,
        "quick_answer_pages": [quick_answer_page, quick_answer_page] if quick_answer_page else None,
    }


def _find_quick_answer_page(pages: list[OcrPage]) -> int | None:
    """Find the page with '한눈에 보는 정답' quick answer table."""
    for page in pages:
        sorted_lines = sorted(page.lines, key=lambda l: l.line_number)
        for line in sorted_lines[:5]:
            if _QUICK_ANSWER_PAGE_KEYWORD.search(line.text):
                return page.page_number
    cutoff_index = int(len(pages) * 0.7)
    for page in pages[cutoff_index:]:
        if _looks_like_answer_table_page(page):
            return page.page_number
    return None


def _looks_like_answer_table_page(page: OcrPage) -> bool:
    texts = [line.text.strip() for line in page.lines if line.text and line.text.strip()]
    if not texts:
        return False

    page_ref_hits = sum(len(_PAGE_REF_PATTERN.findall(text)) for text in texts)
    answer_pair_hits = sum(len(_ANSWER_TABLE_PAIR_PATTERN.findall(text)) for text in texts)
    table_hint_hits = sum(1 for text in texts if _ANSWER_TABLE_HINT_PATTERN.search(text))
    short_line_hits = sum(1 for text in texts if len(text) <= 24)
    long_line_hits = sum(1 for text in texts if len(text) >= 40)

    if answer_pair_hits >= 25 and long_line_hits <= 2:
        return True
    if table_hint_hits >= 1 and answer_pair_hits >= 6:
        return True
    if page_ref_hits >= 4 and short_line_hits >= 6 and long_line_hits <= 3:
        return True

    return False


def _find_content_start(pages: list[OcrPage]) -> int:
    """Find the first page where a problem number pattern appears.

    Skips cover pages, table of contents, and preface.
    """
    if not pages:
        return 0

    for page in pages:
        if (
            _looks_like_answer_table_page(page)
            or _is_table_of_contents_page(page)
            or not _looks_like_problem_page(page)
        ):
            continue
        sorted_lines = sorted(page.lines, key=lambda l: l.line_number)
        for line in sorted_lines:
            text = line.text.strip()
            if not text:
                continue
            for pattern in _CONTENT_START_PATTERNS:
                if pattern.match(text):
                    return page.page_number

    # Fallback: first page
    return pages[0].page_number


def _looks_like_problem_page(page: OcrPage) -> bool:
    texts = [line.text.strip() for line in page.lines if line.text and line.text.strip()]
    if not texts:
        return False

    question_hits = sum(1 for text in texts if _QUESTION_HINT_PATTERN.search(text))
    choice_hits = sum(1 for text in texts if _CHOICE_HINT_PATTERN.match(text))
    header_hits = sum(1 for text in texts if _EXAM_HEADER_PATTERN.match(text))

    if question_hits >= 1:
        return True
    if choice_hits >= 4 and header_hits >= 1:
        return True
    if header_hits >= 2:
        return True
    if header_hits >= 1 and len(texts) >= 2:
        return True

    return False


def _is_table_of_contents_page(page: OcrPage) -> bool:
    texts = [line.text.strip() for line in page.lines if line.text and line.text.strip()]
    if not texts:
        return False

    page_ref_hits = sum(len(_PAGE_REF_PATTERN.findall(text)) for text in texts)
    short_line_hits = sum(1 for text in texts if len(text) <= 24)
    box_hits = sum(text.count("□") for text in texts)
    image_hits = sum(1 for text in texts if "cdn.mathpix.com/cropped" in text)

    if page_ref_hits >= 6:
        return True
    if page_ref_hits >= 3 and short_line_hits >= 8:
        return True
    if box_hits >= 4:
        return True
    if image_hits >= 2 and page_ref_hits >= 2:
        return True

    return False
