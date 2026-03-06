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
        }

    total_pages = len(pages)
    first_page = pages[0].page_number
    last_page = pages[-1].page_number

    # 1. Detect content_start_page (skip 표지/목차/서문)
    content_start_page = _find_content_start(pages)

    # 2. Scan from 40% of document for answer section keywords
    scan_start_idx = int(total_pages * 0.4)
    answer_start_page: int | None = None
    has_quick_answers = False

    for page in pages[scan_start_idx:]:
        sorted_lines = sorted(page.lines, key=lambda l: l.line_number)
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

    if answer_start_page is not None:
        problem_pages = [content_start_page, answer_start_page - 1]
        answer_pages: list[int] | None = [answer_start_page, last_page]
    else:
        problem_pages = [content_start_page, last_page]
        answer_pages = None

    from app.services.redis_events import notify_progress

    notify_progress(ocr_job_id, "detect_sections", message="섹션 감지 완료")

    logger.info(
        "Detected sections for job %s: content_start=%d, problems=%s, answers=%s, quick_answers=%s",
        ocr_job_id,
        content_start_page,
        problem_pages,
        answer_pages,
        has_quick_answers,
    )

    return {
        "ocr_job_id": ocr_job_id,
        "content_start_page": content_start_page,
        "problem_pages": problem_pages,
        "answer_pages": answer_pages,
        "has_quick_answers": has_quick_answers,
    }


def _find_content_start(pages: list[OcrPage]) -> int:
    """Find the first page where a problem number pattern appears.

    Skips cover pages, table of contents, and preface.
    """
    if not pages:
        return 0

    for page in pages:
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
