# Textbook Upload Pipeline — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add textbook (교재) upload support with auto answer-key detection and problem-answer matching.

**Architecture:** Pipeline branching — OCR/parsing shared with exam pipeline, then fork into textbook-specific tasks: detect_sections → segment_textbook → match_answers → finalize_textbook. AI analysis reused with textbook-mode modifications.

**Tech Stack:** Python/Celery (new workers), SQLAlchemy + Prisma (schema changes), NestJS (API), Next.js (UI)

---

### Task 1: DB Schema — SQLAlchemy Models

**Files:**
- Modify: `apps/ocr-api/app/models/problem.py`
- Modify: `apps/ocr-api/app/models/job.py`

**Step 1: Add `book_source` column to Problem model**

In `apps/ocr-api/app/models/problem.py`, add after the `exam_source` field (around line 110):

```python
    book_source: Mapped[dict | None] = mapped_column(
        JSONB, nullable=True, comment='{"title","publisher","chapter","section"}'
    )
```

Also add `answer_match_status` field after `answer_text`:

```python
    answer_match_status: Mapped[str | None] = mapped_column(
        String(20), nullable=True, comment="matched | unmatched | no_answer_key"
    )
    solution_latex: Mapped[str | None] = mapped_column(Text, nullable=True)
    solution_text: Mapped[str | None] = mapped_column(Text, nullable=True)
```

**Step 2: Add `document_type` to OcrJobTracking model**

In `apps/ocr-api/app/models/job.py`, add after `s3_key`:

```python
    document_type: Mapped[str] = mapped_column(
        String(20), nullable=False, server_default="exam"
    )
    book_title: Mapped[str | None] = mapped_column(String(255), nullable=True)
    publisher: Mapped[str | None] = mapped_column(String(255), nullable=True)
```

**Step 3: Verify models load without error**

Run: `cd apps/ocr-api && .venv/bin/python -c "from app.models import Problem, OcrJobTracking; print('OK')"`
Expected: `OK`

**Step 4: Commit**

```bash
git add apps/ocr-api/app/models/problem.py apps/ocr-api/app/models/job.py
git commit -m "feat: add textbook fields to SQLAlchemy models (book_source, document_type, answer_match_status)"
```

---

### Task 2: DB Schema — Prisma + Migration

**Files:**
- Modify: `packages/db-schema/prisma/schema.prisma`

**Step 1: Add columns to SourceFile model**

In `schema.prisma`, find the `SourceFile` model and add:

```prisma
  documentType String   @default("exam") @map("document_type")
  bookTitle    String?  @map("book_title")
  publisher    String?
```

**Step 2: Add columns to Problem model**

Find the `Problem` model and add:

```prisma
  bookSource        Json?   @map("book_source")
  answerMatchStatus String? @map("answer_match_status")
  solutionLatex     String? @map("solution_latex")
  solutionText      String? @map("solution_text")
```

**Step 3: Add columns to OcrJob model**

Find the `OcrJob` model and add:

```prisma
  documentType String  @default("exam") @map("document_type")
  bookTitle    String? @map("book_title")
  publisher    String? @map("publisher")
```

**Step 4: Generate migration**

Run: `pnpm --filter @jsmath/db-schema db:migrate -- --name add_textbook_fields`
Expected: Migration created in `prisma/migrations/`

**Step 5: Generate Prisma client**

Run: `pnpm --filter @jsmath/db-schema db:generate`
Expected: `✔ Generated Prisma Client`

**Step 6: Commit**

```bash
git add packages/db-schema/prisma/
git commit -m "feat: add textbook columns to Prisma schema (documentType, bookTitle, bookSource)"
```

---

### Task 3: NestJS — Accept document_type & book_title on Upload

**Files:**
- Modify: `apps/lms-api/src/files/files.controller.ts`
- Modify: `apps/lms-api/src/files/files.service.ts`

**Step 1: Update FilesController to accept new fields**

In `files.controller.ts`, the `uploadPdf` method receives `@Request() req`. Add `@Body()` fields:

```typescript
@Post('pdf')
@UseInterceptors(FileInterceptor('file', { limits: { fileSize: 300 * 1024 * 1024 } }))
async uploadPdf(
  @UploadedFile() file: Express.Multer.File,
  @Request() req,
  @Body('document_type') documentType?: string,
  @Body('book_title') bookTitle?: string,
  @Body('publisher') publisher?: string,
) {
  // Validate document_type
  const docType = documentType === 'textbook' ? 'textbook' : 'exam';
  if (docType === 'textbook' && !bookTitle?.trim()) {
    throw new BadRequestException('book_title is required for textbook uploads');
  }
  return this.filesService.uploadPdf(file, req.user.sub, {
    documentType: docType,
    bookTitle: bookTitle?.trim() || null,
    publisher: publisher?.trim() || null,
  });
}
```

**Step 2: Update FilesService.uploadPdf to store and propagate metadata**

In `files.service.ts`, update the `uploadPdf` method signature and the Prisma create calls:

1. Add metadata param: `meta?: { documentType: string; bookTitle: string | null; publisher: string | null }`
2. In `prisma.sourceFile.create`, add `documentType`, `bookTitle`, `publisher`
3. In `prisma.ocrJob.create`, add `documentType`, `bookTitle`, `publisher`
4. In `this.publisherClient.publish('ocr:submit', ...)`, add `documentType`, `bookTitle`, `publisher` to the payload

**Step 3: Update event_listener to pass metadata to pipeline**

In `apps/ocr-api/app/services/event_listener.py`, the `_handle_submit` handler receives the Redis message. Extract `document_type`, `book_title`, `publisher` from the payload and pass to `start_ocr_pipeline()` or store in `OcrJobTracking`.

**Step 4: Verify NestJS compiles**

Run: `cd apps/lms-api && npx nest build`
Expected: No errors

**Step 5: Commit**

```bash
git add apps/lms-api/src/files/
git commit -m "feat: accept document_type and book_title in PDF upload endpoint"
```

---

### Task 4: Event Listener — Store textbook metadata & route pipeline

**Files:**
- Modify: `apps/ocr-api/app/services/event_listener.py`
- Modify: `apps/ocr-api/app/workers/pipeline.py`

**Step 1: Update event_listener._handle_submit**

Extract textbook metadata from the Redis `ocr:submit` event and store in `OcrJobTracking`:

```python
document_type = data.get("documentType", "exam")
book_title = data.get("bookTitle")
publisher = data.get("publisher")

# In the OcrJobTracking create:
tracking = OcrJobTracking(
    id=ocr_job_id,
    source_file_id=source_file_id,
    s3_key=s3_key,
    status=JobStatus.pending,
    document_type=document_type,
    book_title=book_title,
    publisher=publisher,
)
```

Then call:
```python
start_ocr_pipeline(ocr_job_id, document_type=document_type)
```

**Step 2: Update pipeline.py to branch on document_type**

```python
from app.workers.textbook_pipeline import start_textbook_pipeline

def start_ocr_pipeline(ocr_job_id: str, document_type: str = "exam") -> str:
    """Chain OCR tasks. Branches after parse_results based on document_type."""
    common_chain = chain(
        submit_pdf_to_mathpix.s(ocr_job_id),
        poll_mathpix_status.s(),
        parse_mathpix_results.s(),
    )

    if document_type == "textbook":
        from app.workers.textbook_pipeline import (
            detect_sections, segment_textbook, match_answers, finalize_textbook,
        )
        workflow = common_chain | detect_sections.s() | segment_textbook.s() | match_answers.s() | finalize_textbook.s()
    else:
        workflow = common_chain | segment_problems.s() | finalize_pipeline.s()

    result = workflow.apply_async()
    logger.info("OCR pipeline (%s) started for job %s: task_id=%s", document_type, ocr_job_id, result.id)
    return result.id
```

**Step 3: Commit**

```bash
git add apps/ocr-api/app/services/event_listener.py apps/ocr-api/app/workers/pipeline.py
git commit -m "feat: route pipeline by document_type (exam vs textbook)"
```

---

### Task 5: detect_sections — Answer/Solution Area Detection

**Files:**
- Create: `apps/ocr-api/app/workers/detect_sections.py`

**Step 1: Implement detect_sections task**

```python
"""Detect answer/solution sections in a textbook PDF."""
from __future__ import annotations

import logging
import re
from sqlalchemy import select

from app.celery_app import celery
from app.db import worker_session
from app.models import OcrLine, OcrPage
from app.services.notifications import notify_progress

logger = logging.getLogger(__name__)

_ANSWER_KEYWORDS = re.compile(
    r"(정\s*답|해\s*설|풀\s*이|해\s*답|답\s*안|정답\s*및\s*해설|Answer|Solution|Answers?\s+Key)",
    re.IGNORECASE,
)


@celery.task(
    bind=True,
    name="task.textbook.detect_sections",
    max_retries=2,
    default_retry_delay=10,
    acks_late=True,
)
def detect_sections(self, prev_result: dict | None = None, *, ocr_job_id: str | None = None) -> dict:
    """Scan OCR lines to find where the answer section starts."""
    import asyncio
    if prev_result:
        ocr_job_id = ocr_job_id or prev_result.get("ocr_job_id")
    if not ocr_job_id:
        raise ValueError("ocr_job_id is required")

    result = asyncio.run(_detect(ocr_job_id))
    return result


async def _detect(ocr_job_id: str) -> dict:
    async with worker_session() as session:
        # Load all pages with their first few lines
        pages_q = (
            select(OcrPage)
            .where(OcrPage.ocr_job_id == ocr_job_id)
            .order_by(OcrPage.page_number)
        )
        pages = (await session.execute(pages_q)).scalars().all()

        if not pages:
            return {"ocr_job_id": ocr_job_id, "problem_pages": None, "answer_pages": None}

        total_pages = len(pages)
        answer_start_page = None

        for page in pages:
            # Only check pages in the latter half of the document
            if page.page_number < total_pages * 0.4:
                continue

            lines_q = (
                select(OcrLine)
                .where(OcrLine.page_id == page.id)
                .order_by(OcrLine.line_number)
                .limit(10)  # Check top lines of each page
            )
            lines = (await session.execute(lines_q)).scalars().all()

            for line in lines[:5]:  # Focus on page header area
                text = (line.text or "").strip()
                if not text:
                    continue
                if _ANSWER_KEYWORDS.search(text):
                    answer_start_page = page.page_number
                    logger.info(
                        "Answer section detected at page %d: '%s'",
                        page.page_number, text[:80],
                    )
                    break
            if answer_start_page is not None:
                break

        first_page = pages[0].page_number
        last_page = pages[-1].page_number

        if answer_start_page is not None:
            result = {
                "ocr_job_id": ocr_job_id,
                "problem_pages": [first_page, answer_start_page - 1],
                "answer_pages": [answer_start_page, last_page],
            }
        else:
            result = {
                "ocr_job_id": ocr_job_id,
                "problem_pages": [first_page, last_page],
                "answer_pages": None,
            }

        notify_progress(ocr_job_id, "detect_sections", 55, "Answer section detection complete")
        logger.info("Section detection result: %s", result)
        return result
```

**Step 2: Verify import**

Run: `cd apps/ocr-api && .venv/bin/python -c "from app.workers.detect_sections import detect_sections; print('OK')"`
Expected: `OK`

**Step 3: Commit**

```bash
git add apps/ocr-api/app/workers/detect_sections.py
git commit -m "feat: add detect_sections worker for answer area detection"
```

---

### Task 6: segment_textbook — Textbook Problem Segmentation

**Files:**
- Create: `apps/ocr-api/app/workers/segment_textbook.py`

**Step 1: Implement segment_textbook task**

This is similar to `segment_problems.py` but with:
- Extended problem number patterns (①, [1], 예제 1, 연습문제, etc.)
- Chapter/section detection
- Only processes `problem_pages` range (not answer pages)
- No CSAT-specific logic

```python
"""Textbook-specific problem segmentation."""
from __future__ import annotations

import asyncio
import logging
import re
from typing import Optional

from pydantic import BaseModel
from sqlalchemy import select

from app.celery_app import celery
from app.db import worker_session
from app.models import OcrJobTracking, OcrLine, OcrPage, JobStatus
from app.services.notifications import notify_progress

logger = logging.getLogger(__name__)

# Extended problem number patterns for textbooks
_PROBLEM_PATTERNS = [
    # Standard: 1. 2. 3. (but not decimals like 3.14)
    re.compile(r"^\s*(\d{1,3})\s*\.(?!\d)"),
    # Circled numbers: ①②③...
    re.compile(r"^\s*([①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳])"),
    # Bracketed: [1] [2] [3]
    re.compile(r"^\s*\[(\d{1,3})\]"),
    # Parenthesized: (1) (2) (3)
    re.compile(r"^\s*\((\d{1,3})\)"),
    # Korean labels: 예제 1, 연습문제 2, 문제 3
    re.compile(r"^\s*(?:예제|연습문제|문제|Exercise|Problem|Q)\s*(\d{1,3})"),
]

_CIRCLED_TO_INT = {c: i for i, c in enumerate("①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳", start=1)}

_CHAPTER_PATTERN = re.compile(
    r"(?:제\s*(\d+)\s*(?:장|단원|절)|Chapter\s*(\d+)|단원\s*(\d+)|§\s*(\d+)|(\d+)\s*단원)",
    re.IGNORECASE,
)

_SECTION_PATTERN = re.compile(
    r"(?:제?\s*(\d+)\s*절|Section\s*(\d+)|(\d+)\.\s+[가-힣A-Za-z])",
    re.IGNORECASE,
)

# Choice markers for problem type detection
_CHOICE_MARKERS = re.compile(r"[①②③④⑤]|ㄱ\.\s|ㄴ\.\s|ㄷ\.\s")
_WRITTEN_KEYWORDS = re.compile(r"풀이\s*과정|서술|과정을\s*쓰")

# Noise patterns to skip
_NOISE_TYPES = {"page_info", "page_header", "page_footer"}


class TextbookSegment(BaseModel):
    problem_number: int
    display_number: str
    problem_type: str  # multiple_choice | short_answer | written_solution
    start_page: int
    end_page: int
    chapter: Optional[str] = None
    section: Optional[str] = None
    stem_latex: str
    stem_text: str
    bbox: dict
    choices: list[dict]


def _parse_problem_number(text: str) -> tuple[int, str] | None:
    """Try all patterns. Returns (int_number, display_string) or None."""
    for pattern in _PROBLEM_PATTERNS:
        m = pattern.match(text)
        if m:
            raw = m.group(1)
            if raw in _CIRCLED_TO_INT:
                return _CIRCLED_TO_INT[raw], raw
            try:
                num = int(raw)
                if 1 <= num <= 200:  # wider range for textbooks
                    return num, str(num)
            except ValueError:
                continue
    return None


def _detect_chapter_section(text: str) -> tuple[str | None, str | None]:
    """Extract chapter and section from a line."""
    chapter = None
    section = None
    cm = _CHAPTER_PATTERN.search(text)
    if cm:
        chapter = next((g for g in cm.groups() if g), None)
    sm = _SECTION_PATTERN.search(text)
    if sm:
        section = next((g for g in sm.groups() if g), None)
    return chapter, section


def _detect_problem_type(lines_text: list[str]) -> str:
    combined = " ".join(lines_text)
    if _CHOICE_MARKERS.search(combined):
        return "multiple_choice"
    if _WRITTEN_KEYWORDS.search(combined):
        return "written_solution"
    return "short_answer"


def _extract_choices(lines: list) -> list[dict]:
    """Extract multiple choice options from lines."""
    choices = []
    choice_re = re.compile(r"^\s*([①②③④⑤])\s*(.*)")
    for line in lines:
        text = line.text or ""
        m = choice_re.match(text)
        if m:
            label = m.group(1)
            content = m.group(2).strip()
            choices.append({
                "label": label,
                "content_latex": line.latex or content,
                "content_text": content,
            })
    return choices


@celery.task(
    bind=True,
    name="task.textbook.segment",
    max_retries=2,
    default_retry_delay=10,
    retry_backoff=True,
    acks_late=True,
)
def segment_textbook(
    self,
    prev_result: dict | None = None,
    *,
    ocr_job_id: str | None = None,
) -> dict:
    """Segment a textbook into individual problems."""
    if prev_result:
        ocr_job_id = ocr_job_id or prev_result.get("ocr_job_id")
    if not ocr_job_id:
        raise ValueError("ocr_job_id is required")

    problem_pages = prev_result.get("problem_pages") if prev_result else None
    result = asyncio.run(_segment(ocr_job_id, problem_pages))
    return result


async def _segment(ocr_job_id: str, problem_pages: list[int] | None) -> dict:
    async with worker_session() as session:
        # Update job status
        tracking = await session.get(OcrJobTracking, ocr_job_id)
        if tracking:
            tracking.status = JobStatus.segmenting
            await session.flush()

        # Load pages in problem range
        pages_q = select(OcrPage).where(OcrPage.ocr_job_id == ocr_job_id).order_by(OcrPage.page_number)
        if problem_pages:
            pages_q = pages_q.where(
                OcrPage.page_number >= problem_pages[0],
                OcrPage.page_number <= problem_pages[1],
            )
        pages = (await session.execute(pages_q)).scalars().all()

        segments: list[TextbookSegment] = []
        current_problem_number: int | None = None
        current_display: str | None = None
        current_lines: list = []
        current_start_page: int | None = None
        current_chapter: str | None = None
        current_section: str | None = None

        for page in pages:
            lines_q = (
                select(OcrLine)
                .where(OcrLine.page_id == page.id)
                .order_by(OcrLine.line_number)
            )
            lines = (await session.execute(lines_q)).scalars().all()

            for line in lines:
                if line.line_type in _NOISE_TYPES:
                    continue

                text = (line.text or "").strip()
                if not text:
                    continue

                # Check for chapter/section markers
                ch, sec = _detect_chapter_section(text)
                if ch:
                    current_chapter = ch
                if sec:
                    current_section = sec

                # Check for problem start
                parsed = _parse_problem_number(text)
                if parsed:
                    new_num, new_display = parsed

                    # Flush previous problem
                    if current_problem_number is not None and current_lines:
                        seg = _build_segment(
                            current_problem_number, current_display,
                            current_lines, current_start_page, page.page_number,
                            current_chapter, current_section,
                        )
                        segments.append(seg)

                    current_problem_number = new_num
                    current_display = new_display
                    current_lines = [line]
                    current_start_page = page.page_number
                else:
                    if current_problem_number is not None:
                        current_lines.append(line)

        # Flush last problem
        if current_problem_number is not None and current_lines:
            last_page = pages[-1].page_number if pages else current_start_page
            seg = _build_segment(
                current_problem_number, current_display,
                current_lines, current_start_page, last_page,
                current_chapter, current_section,
            )
            segments.append(seg)

        notify_progress(ocr_job_id, "segmentation", 65, f"Segmented {len(segments)} problems")
        logger.info("Textbook segmentation: %d problems from job %s", len(segments), ocr_job_id)

        return {
            "ocr_job_id": ocr_job_id,
            "problem_count": len(segments),
            "segments": [s.model_dump() for s in segments],
            "problem_pages": problem_pages,
            "answer_pages": None,  # Will be carried from prev_result by match_answers
        }


def _build_segment(
    problem_number: int,
    display_number: str,
    lines: list,
    start_page: int,
    end_page: int,
    chapter: str | None,
    section: str | None,
) -> TextbookSegment:
    stem_parts_latex = []
    stem_parts_text = []
    bboxes = []

    for line in lines:
        if line.latex:
            stem_parts_latex.append(line.latex)
        elif line.text:
            stem_parts_latex.append(line.text)
        if line.text:
            stem_parts_text.append(line.text)
        if all(getattr(line, f"bbox_{d}", None) is not None for d in "xywh"):
            bboxes.append({
                "x": line.bbox_x, "y": line.bbox_y,
                "w": line.bbox_w, "h": line.bbox_h,
            })

    # Compute union bbox
    bbox = {}
    if bboxes:
        bbox = {
            "x": min(b["x"] for b in bboxes),
            "y": min(b["y"] for b in bboxes),
            "w": max(b["x"] + b["w"] for b in bboxes) - min(b["x"] for b in bboxes),
            "h": max(b["y"] + b["h"] for b in bboxes) - min(b["y"] for b in bboxes),
        }

    choices = _extract_choices(lines)
    problem_type = _detect_problem_type([l.text or "" for l in lines])

    return TextbookSegment(
        problem_number=problem_number,
        display_number=display_number,
        problem_type=problem_type,
        start_page=start_page,
        end_page=end_page,
        chapter=chapter,
        section=section,
        stem_latex="\n".join(stem_parts_latex),
        stem_text="\n".join(stem_parts_text),
        bbox=bbox,
        choices=choices,
    )
```

**Step 2: Verify import**

Run: `cd apps/ocr-api && .venv/bin/python -c "from app.workers.segment_textbook import segment_textbook; print('OK')"`
Expected: `OK`

**Step 3: Commit**

```bash
git add apps/ocr-api/app/workers/segment_textbook.py
git commit -m "feat: add segment_textbook worker with extended number pattern recognition"
```

---

### Task 7: match_answers — Answer Key Matching

**Files:**
- Create: `apps/ocr-api/app/workers/match_answers.py`

**Step 1: Implement match_answers task**

```python
"""Match answer-key entries to segmented problems."""
from __future__ import annotations

import asyncio
import logging
import re
from sqlalchemy import select

from app.celery_app import celery
from app.db import worker_session
from app.models import OcrLine, OcrPage
from app.services.notifications import notify_progress

logger = logging.getLogger(__name__)

# Reuse same problem number patterns
_ANSWER_NUMBER_PATTERNS = [
    re.compile(r"^\s*(\d{1,3})\s*[.):\s]"),
    re.compile(r"^\s*([①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳])\s*"),
    re.compile(r"^\s*\[(\d{1,3})\]"),
    re.compile(r"^\s*\((\d{1,3})\)"),
    re.compile(r"^\s*(?:문제|Q)\s*(\d{1,3})"),
]

_CIRCLED_TO_INT = {c: i for i, c in enumerate("①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳", start=1)}


def _parse_answer_number(text: str) -> int | None:
    for pattern in _ANSWER_NUMBER_PATTERNS:
        m = pattern.match(text)
        if m:
            raw = m.group(1)
            if raw in _CIRCLED_TO_INT:
                return _CIRCLED_TO_INT[raw]
            try:
                num = int(raw)
                if 1 <= num <= 200:
                    return num
            except ValueError:
                continue
    return None


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
    """Match answers from the answer section to problem segments."""
    if prev_result:
        ocr_job_id = ocr_job_id or prev_result.get("ocr_job_id")
    if not ocr_job_id:
        raise ValueError("ocr_job_id is required")

    answer_pages = prev_result.get("answer_pages") if prev_result else None
    segments = prev_result.get("segments", []) if prev_result else []

    result = asyncio.run(_match(ocr_job_id, segments, answer_pages))
    return result


async def _match(
    ocr_job_id: str,
    segments: list[dict],
    answer_pages: list[int] | None,
) -> dict:
    if not answer_pages:
        # No answer section — mark all as no_answer_key
        for seg in segments:
            seg["answer_text"] = None
            seg["solution_latex"] = None
            seg["solution_text"] = None
            seg["answer_match_status"] = "no_answer_key"
        notify_progress(ocr_job_id, "answer_matching", 75, "No answer section found")
        return {
            "ocr_job_id": ocr_job_id,
            "segments": segments,
            "problem_count": len(segments),
            "matched_count": 0,
        }

    # Build answer map from answer pages
    answer_map: dict[int, dict] = {}  # problem_number -> {answer_text, solution_latex, solution_text}

    async with worker_session() as session:
        pages_q = (
            select(OcrPage)
            .where(
                OcrPage.ocr_job_id == ocr_job_id,
                OcrPage.page_number >= answer_pages[0],
                OcrPage.page_number <= answer_pages[1],
            )
            .order_by(OcrPage.page_number)
        )
        pages = (await session.execute(pages_q)).scalars().all()

        current_answer_num: int | None = None
        current_lines: list = []

        for page in pages:
            lines_q = (
                select(OcrLine)
                .where(OcrLine.page_id == page.id)
                .order_by(OcrLine.line_number)
            )
            lines = (await session.execute(lines_q)).scalars().all()

            for line in lines:
                text = (line.text or "").strip()
                if not text:
                    continue

                parsed_num = _parse_answer_number(text)
                if parsed_num is not None:
                    # Flush previous answer
                    if current_answer_num is not None and current_lines:
                        answer_map[current_answer_num] = _build_answer(current_lines)

                    current_answer_num = parsed_num
                    current_lines = [line]
                else:
                    if current_answer_num is not None:
                        current_lines.append(line)

        # Flush last answer
        if current_answer_num is not None and current_lines:
            answer_map[current_answer_num] = _build_answer(current_lines)

    # Match answers to segments
    matched_count = 0
    for seg in segments:
        pnum = seg.get("problem_number")
        if pnum in answer_map:
            ans = answer_map[pnum]
            seg["answer_text"] = ans["answer_text"]
            seg["solution_latex"] = ans["solution_latex"]
            seg["solution_text"] = ans["solution_text"]
            seg["answer_match_status"] = "matched"
            matched_count += 1
        else:
            seg["answer_text"] = None
            seg["solution_latex"] = None
            seg["solution_text"] = None
            seg["answer_match_status"] = "unmatched"

    notify_progress(
        ocr_job_id, "answer_matching", 75,
        f"Matched {matched_count}/{len(segments)} answers",
    )
    logger.info("Answer matching: %d/%d matched for job %s", matched_count, len(segments), ocr_job_id)

    return {
        "ocr_job_id": ocr_job_id,
        "segments": segments,
        "problem_count": len(segments),
        "matched_count": matched_count,
    }


def _build_answer(lines: list) -> dict:
    """Build answer dict from collected lines."""
    text_parts = []
    latex_parts = []
    for line in lines:
        if line.text:
            text_parts.append(line.text.strip())
        if line.latex:
            latex_parts.append(line.latex)
        elif line.text:
            latex_parts.append(line.text.strip())

    full_text = "\n".join(text_parts)
    full_latex = "\n".join(latex_parts)

    # Try to extract just the answer (first line often has the answer, rest is solution)
    answer_text = text_parts[0] if text_parts else None
    # Remove the problem number prefix from the answer
    if answer_text:
        # Strip leading number patterns
        answer_text = re.sub(r"^\s*\d{1,3}\s*[.):\s]+", "", answer_text).strip()
        answer_text = re.sub(r"^\s*[①②③④⑤⑥⑦⑧⑨⑩]\s*", "", answer_text).strip()

    return {
        "answer_text": answer_text,
        "solution_latex": full_latex if len(latex_parts) > 1 else None,
        "solution_text": full_text if len(text_parts) > 1 else None,
    }
```

**Step 2: Verify import**

Run: `cd apps/ocr-api && .venv/bin/python -c "from app.workers.match_answers import match_answers; print('OK')"`
Expected: `OK`

**Step 3: Commit**

```bash
git add apps/ocr-api/app/workers/match_answers.py
git commit -m "feat: add match_answers worker for answer-key to problem matching"
```

---

### Task 8: finalize_textbook — Textbook Pipeline Finalization

**Files:**
- Create: `apps/ocr-api/app/workers/finalize_textbook.py`

**Step 1: Implement finalize_textbook task**

Pattern: same as `finalize.py` but populates `book_source` instead of CSAT metadata.

```python
"""Finalize textbook OCR pipeline — publish results to NestJS."""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from sqlalchemy import select

from app.celery_app import celery
from app.db import worker_session
from app.models import OcrJobTracking, OcrPage, JobStatus
from app.services.notifications import notify_completed, notify_progress

logger = logging.getLogger(__name__)


@celery.task(
    bind=True,
    name="task.textbook.finalize",
    max_retries=3,
    default_retry_delay=10,
    acks_late=True,
)
def finalize_textbook(
    self,
    prev_result: dict | None = None,
    *,
    ocr_job_id: str | None = None,
    segments: list[dict] | None = None,
) -> dict:
    """Mark textbook OCR job complete and publish problems to NestJS."""
    if prev_result:
        ocr_job_id = ocr_job_id or prev_result.get("ocr_job_id")
        segments = segments or prev_result.get("segments", [])
    if not ocr_job_id:
        raise ValueError("ocr_job_id is required")
    segments = segments or []

    return asyncio.run(_finalize(ocr_job_id, segments))


async def _finalize(ocr_job_id: str, segments: list[dict]) -> dict:
    async with worker_session() as session:
        tracking = await session.get(OcrJobTracking, ocr_job_id)
        if tracking:
            tracking.status = JobStatus.completed
            tracking.problem_count = len(segments)
            tracking.completed_at = datetime.now(timezone.utc)
            await session.flush()

        # Build page image map
        pages_q = (
            select(OcrPage)
            .where(OcrPage.ocr_job_id == ocr_job_id)
            .order_by(OcrPage.page_number)
        )
        pages = (await session.execute(pages_q)).scalars().all()
        page_image_map = {p.page_number: p.image_s3_key for p in pages}

        # Build book_source from tracking metadata
        book_source = None
        if tracking:
            book_source = {
                "title": tracking.book_title,
                "publisher": tracking.publisher,
            }

        # Build merged problems payload for NestJS
        merged_problems = []
        for seg in segments:
            start_page = seg.get("start_page", 1)
            merged_problems.append({
                "problemNumber": seg.get("problem_number"),
                "displayNumber": seg.get("display_number", str(seg.get("problem_number", ""))),
                "problemType": seg.get("problem_type", "short_answer"),
                "startPage": start_page,
                "endPage": seg.get("end_page", start_page),
                "stemLatex": seg.get("stem_latex", ""),
                "stemText": seg.get("stem_text", ""),
                "pageImageS3Key": page_image_map.get(start_page),
                "problemImageS3Key": None,
                "choices": seg.get("choices", []),
                # Textbook-specific fields
                "bookSource": {
                    **(book_source or {}),
                    "chapter": seg.get("chapter"),
                    "section": seg.get("section"),
                },
                "answerText": seg.get("answer_text"),
                "solutionLatex": seg.get("solution_latex"),
                "solutionText": seg.get("solution_text"),
                "answerMatchStatus": seg.get("answer_match_status", "no_answer_key"),
                "documentType": "textbook",
            })

        notify_progress(ocr_job_id, "ocr_complete", 80, "Textbook OCR complete")
        notify_completed(ocr_job_id, len(segments), merged_problems)

        logger.info("Textbook pipeline finalized: job=%s, problems=%d", ocr_job_id, len(segments))
        return {"ocr_job_id": ocr_job_id, "problem_count": len(segments)}
```

**Step 2: Verify import**

Run: `cd apps/ocr-api && .venv/bin/python -c "from app.workers.finalize_textbook import finalize_textbook; print('OK')"`
Expected: `OK`

**Step 3: Commit**

```bash
git add apps/ocr-api/app/workers/finalize_textbook.py
git commit -m "feat: add finalize_textbook worker with book_source metadata"
```

---

### Task 9: Register New Celery Tasks

**Files:**
- Modify: `apps/ocr-api/app/celery_app.py`

**Step 1: Add new worker modules to the `include` list**

In `celery_app.py`, add these to the `include` list:

```python
    "app.workers.detect_sections",
    "app.workers.segment_textbook",
    "app.workers.match_answers",
    "app.workers.finalize_textbook",
```

**Step 2: Verify Celery can discover all tasks**

Run: `cd apps/ocr-api && .venv/bin/python -c "from app.celery_app import celery; print([t for t in celery.tasks if 'textbook' in t])"`
Expected: List containing `task.textbook.detect_sections`, `task.textbook.segment`, `task.textbook.match_answers`, `task.textbook.finalize`

**Step 3: Commit**

```bash
git add apps/ocr-api/app/celery_app.py
git commit -m "feat: register textbook pipeline Celery tasks"
```

---

### Task 10: NestJS — Handle Textbook Problems in ocr:completed

**Files:**
- Modify: `apps/lms-api/src/files/files.service.ts`

**Step 1: Update createProblemsFromOcr to handle textbook fields**

In `files.service.ts`, the `createProblemsFromOcr` method creates `prisma.problem.create` for each problem. Update to include textbook fields when present:

```typescript
// Inside the problem creation loop:
const problemData: any = {
  // ... existing fields ...
};

// Add textbook fields if present
if (p.documentType === 'textbook') {
  problemData.bookSource = p.bookSource || null;
  problemData.answerMatchStatus = p.answerMatchStatus || null;
  problemData.solutionLatex = p.solutionLatex || null;
  problemData.solutionText = p.solutionText || null;
  if (p.answerText) {
    problemData.answerText = p.answerText;
  }
}
```

**Step 2: Propagate documentType to OcrJob on completion**

When `ocr:completed` is received, if the first problem has `documentType === 'textbook'`, update the OcrJob:

```typescript
if (problems[0]?.documentType === 'textbook') {
  await this.prisma.ocrJob.update({
    where: { id: ocrJobId },
    data: { documentType: 'textbook' },
  });
}
```

**Step 3: Update problem list query to support book_title filter**

In `problems.service.ts`, add `bookTitle` to the `findAll` query filter:

```typescript
if (query.bookTitle) {
  where.bookSource = { path: ['title'], string_contains: query.bookTitle };
}
```

**Step 4: Verify NestJS compiles**

Run: `cd apps/lms-api && npx nest build`
Expected: No errors

**Step 5: Commit**

```bash
git add apps/lms-api/src/files/files.service.ts apps/lms-api/src/problems/problems.service.ts
git commit -m "feat: handle textbook problem fields in NestJS (bookSource, answerMatchStatus)"
```

---

### Task 11: AI Analysis — Textbook Mode

**Files:**
- Modify: `apps/ocr-api/app/workers/unified_analysis.py`
- Modify: `apps/ocr-api/app/workers/analysis_pipeline.py`
- Modify: `apps/ocr-api/app/workers/detect_exam_pattern.py`

**Step 1: Add textbook detection to unified_analysis**

In `unified_analysis.py`, the `analyze_problem` function loads the problem from DB. After loading, check if it's a textbook problem:

```python
# After loading problem from DB:
is_textbook = bool(problem.book_source) or (tracking and tracking.document_type == "textbook")
```

If `is_textbook`:
- Use a modified system prompt: replace "Korean CSAT math expert" with "Korean math textbook analyzer"
- Remove exam_source from the expected output schema
- If `problem.solution_latex` already exists (from answer key), include it in the prompt context: "The answer key provides this solution: {solution_latex}. Use it as reference."
- Skip CSAT-specific difficulty heuristics (killer/semi_killer scoring)

**Step 2: Skip CSAT rules for textbook problems in detect_exam_pattern**

In `detect_exam_pattern.py`, the `_apply_rules` function applies Q1-Q30 CSAT rules. Add an early check:

```python
async def _apply_rules(problem_id: str, prev_result: dict | None = None):
    async with worker_session() as session:
        problem = await session.get(Problem, problem_id)
        if not problem:
            return {"problem_id": problem_id, "status": "not_found"}

        # Skip CSAT rules for textbook problems
        is_textbook = bool(problem.book_source)

        if not is_textbook:
            # ... existing CSAT rule application ...
        else:
            # For textbooks: just save the AI analysis results without CSAT rules
            position_type = None
            point_value = None
            question_format = None
```

Continue saving the AI analysis fields (subject, unit, difficulty, etc.) to the DB as before, just without CSAT-specific position_type/point_value.

**Step 3: Update analysis_pipeline to pass document_type context**

In `analysis_pipeline.py`, the `_process_batch` function runs 5 stages. No structural change needed — `_apply_rules` will self-detect textbook mode from the problem's `book_source` field.

**Step 4: Commit**

```bash
git add apps/ocr-api/app/workers/unified_analysis.py apps/ocr-api/app/workers/detect_exam_pattern.py
git commit -m "feat: add textbook mode to AI analysis (skip CSAT rules, use answer key)"
```

---

### Task 12: Frontend — Upload Page Textbook Fields

**Files:**
- Modify: `apps/web/src/app/(authenticated)/upload/page.tsx`

**Step 1: Add document type state and form fields**

Add state:
```typescript
const [documentType, setDocumentType] = useState<'exam' | 'textbook'>('exam');
const [bookTitle, setBookTitle] = useState('');
const [publisher, setPublisher] = useState('');
```

Add radio buttons before the file drop area:
```tsx
<div className="flex gap-4 mb-4">
  <label className="flex items-center gap-2 cursor-pointer">
    <input type="radio" name="docType" value="exam"
      checked={documentType === 'exam'} onChange={() => setDocumentType('exam')} />
    <span>시험지</span>
  </label>
  <label className="flex items-center gap-2 cursor-pointer">
    <input type="radio" name="docType" value="textbook"
      checked={documentType === 'textbook'} onChange={() => setDocumentType('textbook')} />
    <span>교재</span>
  </label>
</div>
```

Show textbook fields conditionally:
```tsx
{documentType === 'textbook' && (
  <div className="space-y-3 mb-4">
    <input placeholder="책 제목 (필수)" value={bookTitle}
      onChange={e => setBookTitle(e.target.value)}
      className="w-full px-3 py-2 border rounded" required />
    <input placeholder="출판사 (선택)" value={publisher}
      onChange={e => setPublisher(e.target.value)}
      className="w-full px-3 py-2 border rounded" />
  </div>
)}
```

**Step 2: Update FormData in upload XHR**

In the upload function, append the new fields to FormData:

```typescript
formData.append('document_type', documentType);
if (documentType === 'textbook') {
  formData.append('book_title', bookTitle);
  if (publisher) formData.append('publisher', publisher);
}
```

**Step 3: Add validation**

Before upload, validate textbook requires book title:
```typescript
if (documentType === 'textbook' && !bookTitle.trim()) {
  toast.error('교재 제목을 입력해주세요');
  return;
}
```

**Step 4: Update SSE stage progress map for textbook**

```typescript
const stageProgress: Record<string, number> = documentType === 'textbook'
  ? { ocr_submit: 15, ocr_processing: 30, parsing: 45, detect_sections: 55,
      segmentation: 65, answer_matching: 75, ocr_complete: 80, analyzing: 90, analysis_complete: 100 }
  : { ocr_submit: 25, ocr_processing: 40, parsing: 55, segmentation: 65,
      ocr_complete: 70, analyzing: 85, analysis_complete: 100 };
```

**Step 5: Commit**

```bash
git add apps/web/src/app/(authenticated)/upload/page.tsx
git commit -m "feat: add textbook upload form fields (document type, book title, publisher)"
```

---

### Task 13: Frontend — Review Page Textbook Display

**Files:**
- Modify: `apps/web/src/app/(authenticated)/review/page.tsx`

**Step 1: Show document_type and book_title in file list**

In the file list table/cards, add a badge showing the document type:
```tsx
<span className={`text-xs px-2 py-0.5 rounded ${
  file.documentType === 'textbook' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-700'
}`}>
  {file.documentType === 'textbook' ? '교재' : '시험지'}
</span>
```

Show `bookTitle` if present:
```tsx
{file.bookTitle && <span className="text-sm text-gray-500 ml-2">{file.bookTitle}</span>}
```

**Step 2: Update problem card for textbook mode**

When displaying a textbook problem:
- Show `chapter/section` instead of `pointValue/positionType`
- Show answer match status badge
- Display solution from answer key if available

```tsx
{problem.bookSource ? (
  <div className="text-sm text-gray-500">
    {problem.bookSource.chapter && `${problem.bookSource.chapter}장`}
    {problem.bookSource.section && ` ${problem.bookSource.section}절`}
  </div>
) : (
  <div className="text-sm text-gray-500">
    {problem.pointValue && `${problem.pointValue}점`}
    {problem.positionType && ` · ${problem.positionType}`}
  </div>
)}

{problem.answerMatchStatus && (
  <span className={`text-xs px-2 py-0.5 rounded ${
    problem.answerMatchStatus === 'matched' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
  }`}>
    {problem.answerMatchStatus === 'matched' ? '해설 매칭' : '매칭 안됨'}
  </span>
)}
```

**Step 3: Show answer key solution in analysis section**

If `problem.solutionLatex` exists, render it in a dedicated "해설지 풀이" section:
```tsx
{problem.solutionLatex && (
  <div className="mt-2 p-3 bg-blue-50 rounded">
    <h4 className="text-sm font-medium mb-1">해설지 풀이</h4>
    <div className="text-sm"><LatexRenderer latex={problem.solutionLatex} /></div>
  </div>
)}
```

**Step 4: Add document_type filter**

Add a filter dropdown or toggle to filter by document type:
```tsx
<select value={docTypeFilter} onChange={e => setDocTypeFilter(e.target.value)}
  className="px-3 py-1.5 border rounded text-sm">
  <option value="">전체</option>
  <option value="exam">시험지</option>
  <option value="textbook">교재</option>
</select>
```

**Step 5: Commit**

```bash
git add apps/web/src/app/(authenticated)/review/page.tsx
git commit -m "feat: add textbook display mode to review page (book source, answer match status)"
```

---

### Task 14: Integration Test — End-to-End Verification

**Step 1: Start all services**

```bash
docker compose up -d          # PostgreSQL + Redis
pnpm dev:lms &                # NestJS on :3001
pnpm dev:ocr &                # FastAPI on :8000
cd apps/ocr-api && .venv/bin/celery -A app.celery_app worker -l info --concurrency=3 &
pnpm dev:web                  # Next.js on :3000
```

**Step 2: Run DB migration**

```bash
pnpm --filter @jsmath/db-schema db:migrate -- --name add_textbook_fields
```

**Step 3: Test textbook upload**

1. Open `http://localhost:3000/upload`
2. Select "교재" document type
3. Enter book title: "수학의 정석 수학II"
4. Upload a real textbook PDF with answer section
5. Verify SSE progress shows textbook-specific stages (detect_sections, answer_matching)
6. Verify completion

**Step 4: Verify review page**

1. Open `http://localhost:3000/review`
2. Verify the uploaded file shows "교재" badge and book title
3. Click into the file
4. Verify problems show chapter/section instead of CSAT metadata
5. Verify matched answers show "해설 매칭" badge
6. Verify answer key solutions are displayed

**Step 5: Test exam upload still works**

1. Upload a regular exam paper with "시험지" selected
2. Verify the existing pipeline runs unchanged
3. Verify review page shows exam-specific metadata as before

**Step 6: Final commit**

```bash
git add -A
git commit -m "test: verify textbook pipeline end-to-end integration"
```
