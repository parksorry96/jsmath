# Textbook Upload Pipeline Design

**Date:** 2026-03-06
**Status:** Approved
**Approach:** Pipeline branching (Approach A)

## Overview

Add support for uploading entire textbooks (교재) in addition to exam papers. Key features:
- Support both unit-based workbooks and past-exam collections
- Auto-detect answer/solution sections at the back of PDFs
- Match answers/solutions to problems automatically
- Store book metadata (title, publisher, chapter) for easy retrieval
- AI classification with solution fallback (use answer key first, AI if missing)

## Architecture: Pipeline Branching

```
[Common] submit → poll → parse_results
         ↓
    document_type?
    ├─ exam     → [existing] segment_problems → finalize → unified_analysis
    └─ textbook → [new] detect_sections → segment_textbook → match_answers
                        → finalize_textbook → textbook_analysis
```

OCR and parsing stages are shared. Branching starts at segmentation.

## Section 1: Upload Flow & Metadata

### Frontend (Upload Page)

Add to upload form:
- **Document type selector**: `exam` / `textbook` (radio, default: exam)
- **Textbook fields** (shown when textbook selected):
  - Book title (required, text input)
  - Publisher (optional, text input)
  - Subject hint (optional, dropdown: 수학I/수학II/확률과통계/미적분/기하)

### API Changes

`POST /v1/files/pdf` additional multipart fields:
```
document_type: "exam" | "textbook"
book_title?: string       # required when textbook
publisher?: string
subject_hint?: string
```

### DB Schema Changes

`ocr.source_files` — add columns:
```sql
document_type  VARCHAR(20) NOT NULL DEFAULT 'exam'
book_title     VARCHAR(255)
publisher      VARCHAR(255)
```

`ocr.problems` — add column:
```sql
book_source    JSONB  -- {"title", "publisher", "chapter", "section"}
```

## Section 2: Textbook Pipeline (Celery Tasks)

### 2-1. `detect_sections` (new task: `task.textbook.detect_sections`)

Scan `ocr_lines` to separate problem area from answer/solution area.

**Logic:**
1. Load all `ocr_lines` ordered by page
2. Keyword-based detection for answer section start:
   - Keywords: `정답`, `해설`, `풀이`, `답`, `해답`, `Answer`, `Solution`
   - A page with these keywords in header/title position = answer section start
3. Output: `{ problem_pages: [start, end], answer_pages: [start, end] | null }`

### 2-2. `segment_textbook` (new task: `task.textbook.segment`)

Textbook-specific problem segmentation.

**Differences from exam segmenter:**
- **Extended number patterns**: `1.`, `①`, `[1]`, `예제 1`, `연습문제 1`, `Q1`, etc.
- **Chapter/section detection**: `제1장`, `Chapter`, `단원`, `§`, etc. → extract chapter/section metadata
- **No CSAT rule table**: skip `detect_exam_pattern` Q1-Q30 rules
- **GPT fallback**: if rule-based segmentation fails for a page range, send OCR text to GPT for structure analysis

### 2-3. `match_answers` (new task: `task.textbook.match_answers`)

Match answers/solutions from answer section to problems.

**Logic:**
1. Load `ocr_lines` from `answer_pages`
2. Recognize problem numbers in answer section (same pattern engine)
3. Match by number: problem `problem_number` ↔ answer `answer_number`
4. Store matched data:
   - `answer_text`: final answer
   - `solution_latex`: solution LaTeX from answer key
   - `solution_text`: solution plain text
5. Unmatched problems: `answer_match_status: 'unmatched'`

### 2-4. `finalize_textbook` (new task: `task.textbook.finalize`)

Similar to existing `finalize` but:
- Populate `book_source` JSON with title, publisher, chapter, section
- Set `exam_source = null`
- Publish `ocr:completed` event (same channel, NestJS compatible)

### 2-5. AI Analysis (modified existing pipeline)

`unified_analysis.py` modifications for `document_type == 'textbook'`:
- **Solution**: use answer key `solution_latex` if available, else AI-generate
- **CSAT metadata**: skip `position_type`, `point_value`, etc.
- **Prompt tone**: "math textbook analyzer" instead of "CSAT expert"

## Section 3: SSE Progress & Review Page

### SSE Progress Stages (Textbook)

| Stage | Progress | Description |
|-------|----------|-------------|
| `ocr_submit` | 15% | Mathpix submit |
| `ocr_processing` | 30% | OCR processing |
| `parsing` | 45% | Parse results |
| `detect_sections` | 55% | Detect problem/answer areas |
| `segmentation` | 65% | Segment problems |
| `answer_matching` | 75% | Match answers |
| `ocr_complete` | 80% | OCR complete |
| `analyzing` | 90% | AI analysis |
| `analysis_complete` | 100% | Done |

### Review Page Changes

- **File list**: show `document_type` badge, add `book_title` column
- **Problem card** (textbook mode):
  - Show `chapter/section` instead of CSAT metadata (point_value, position_type)
  - Show answer match status (`matched` / `unmatched`)
  - Display answer key solution alongside AI analysis when available
- **Filters**: add `document_type` filter, `book_title` search

## Files to Create/Modify

### New Files (Python)
- `apps/ocr-api/app/workers/detect_sections.py`
- `apps/ocr-api/app/workers/segment_textbook.py`
- `apps/ocr-api/app/workers/match_answers.py`
- `apps/ocr-api/app/workers/finalize_textbook.py`
- `apps/ocr-api/app/workers/textbook_pipeline.py` (chain orchestrator)

### Modified Files (Python)
- `apps/ocr-api/app/workers/pipeline.py` — add document_type branching
- `apps/ocr-api/app/workers/unified_analysis.py` — textbook mode
- `apps/ocr-api/app/workers/analysis_pipeline.py` — skip CSAT rules for textbooks
- `apps/ocr-api/app/workers/detect_exam_pattern.py` — skip for textbooks
- `apps/ocr-api/app/celery_app.py` — register new tasks

### Modified Files (TypeScript)
- `packages/db-schema/prisma/schema.prisma` — add columns
- `apps/lms-api/src/files/files.controller.ts` — accept document_type, book_title
- `apps/lms-api/src/files/files.service.ts` — pass metadata
- `apps/lms-api/src/problems/problems.service.ts` — filter by book_title
- `apps/web/src/app/(authenticated)/upload/page.tsx` — textbook form fields
- `apps/web/src/app/(authenticated)/review/page.tsx` — textbook display mode

### DB Migration
- Add `document_type`, `book_title`, `publisher` to `source_files`
- Add `book_source` to `problems`
