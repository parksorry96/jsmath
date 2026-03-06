# EBS Textbook OCR Pipeline Design

## Context

The existing OCR pipeline handles mock exams (모의고사) well but fails on EBS textbooks
like 수능특강 due to fundamentally different document structure:
- Problems are grouped into sections (예제, 유제, Level 1/2/3, 대표 기출)
- Problem numbers **reset** within each section (유제 1, Level1 1, Level2 1 are all different)
- EBS items have unique codes like `[26008-0001]` above each problem
- 예제 and 대표 기출 have inline solutions; 유제/Level answers are in the back

## Approach: Item Code-Based Segmentation

Use `[XXXXX-XXXX]` item codes as the **primary** problem boundary signal for 유제/Level
problems. Use `예제 N` and `대표 기출 문제` patterns for problems without item codes.
Track section state to resolve number resets.

### Reference PDF: 2027 수능특강 수학I (160 pages)

**Chapter structure (6 chapters, 01~06):**

| Order | Section | Detection Pattern | Has Item Code |
|-------|---------|------------------|---------------|
| 1 | 개념 정리 | Numbered concept headers (N bold title) | No (skip) |
| 2 | 예제 N | `예제 N` + title | No |
| 3 | 유제 | `유제` header, then `[XXXXX-XXXX]` per problem | Yes |
| 4 | Level 1 기초 연습 | `Level 1` header | Yes |
| 5 | Level 2 기본 연습 | `Level 2` header | Yes |
| 6 | Level 3 실력 완성 | `Level 3` header | Yes |
| 7 | 대표 기출 문제 | `대표 기출 문제` header | No |

**Answer section (p102+):**

| Page | Content | Format |
|------|---------|--------|
| ~p102 | 한눈에 보는 정답 | Quick answer table by chapter/section |
| ~p105+ | 정답과 풀이 | 2-column detailed solutions |

## Design

### 1. Problem Boundary Detection

Priority order:
1. `[XXXXX-XXXX]` item code — 유제, Level 1/2/3 problems
2. `예제 N` pattern — examples (no item code)
3. `YYYY학년도` inside 대표 기출 section — past exam problems (no item code)

### 2. Section State Machine

```
CONCEPT → EXAMPLE → PRACTICE(유제) → LEVEL1 → LEVEL2 → LEVEL3 → PAST_EXAM
    └──── next chapter resets ◄──────────────────────────────────────────┘
```

Transition triggers (from OCR text):
- `"NN 제목"` (chapter header like "01 지수와 로그") → new chapter
- `"예제 N"` → EXAMPLE
- `"유제"` → PRACTICE
- `"Level N"` → LEVEL1/2/3
- `"대표 기출 문제"` → PAST_EXAM
- `"한눈에 보는 정답"` → QUICK_ANSWER
- `"정답과 풀이"` → ANSWER_DETAIL

### 3. Per-Problem Metadata

```python
{
    "item_code": "26008-0001",        # global unique ID (from [XXXXX-XXXX])
    "chapter": "01 지수와 로그",
    "section_type": "practice",        # example/practice/level1/level2/level3/past_exam
    "section_label": "유제",
    "local_number": "1",              # number within section (resets per section)
}
```

### 4. Answer Matching Strategy

**Inline answers (captured during segmentation):**
- 예제: 잠깐의 + 풀이 + `답 N` on same page
- 대표 기출: 출제의도 + 풀이 + `답 N` on same page
- These do NOT need match_answers step

**Back-of-book answers (matched in match_answers step):**
- 유제, Level 1/2/3 problems
- Source 1: "한눈에 보는 정답" quick table → answer_text
- Source 2: "정답과 풀이" detailed solutions → solution_latex/solution_text
- Match key: (chapter, section_type, local_number)

### 5. DB Storage

Existing fields:
- `answer_text` ← "①" or "125"
- `solution_latex` ← detailed solution LaTeX
- `solution_text` ← detailed solution text
- `answer_match_status` ← "inline" | "matched" | "unmatched"

`book_source` JSON extended:
```json
{
    "title": "수능특강 수학I",
    "publisher": "EBS",
    "chapter": "01 지수와 로그",
    "section": "유제",
    "section_type": "practice",
    "item_code": "26008-0001",
    "local_number": "1",
    "inline_hint": "잠깐의 content (예제 only)"
}
```

## Files to Modify

| File | Changes | Size |
|------|---------|------|
| `segment_textbook.py` | Item code pattern, section state machine, inline solution capture | Large |
| `detect_sections.py` | "한눈에 보는 정답" detection, quick_answer_pages output | Small |
| `match_answers.py` | Section-aware quick answer parsing, (chapter,section,number) matching | Medium |
| `finalize_textbook.py` | item_code + section_type in problem payload | Small |
| `files.service.ts` | Store item_code in book_source | Small |

## Team Distribution

```
[Team A: Segmentation] — independent
  segment_textbook.py
  - Item code pattern + section state machine
  - Inline capture for 예제/기출
  - Output: item_code, section_type, inline_solution, inline_answer

[Team B: Answer Matching] — depends on Team A output schema
  detect_sections.py — add quick_answer_pages detection
  match_answers.py — section-aware parsing + matching

[Team C: Finalize] — depends on A + B
  finalize_textbook.py — pass through new fields
  files.service.ts — store in DB
```

## Output Interface Contract

### segment_textbook → match_answers

```python
{
    "ocr_job_id": "...",
    "segments": [{
        "item_code": "26008-0001",
        "section_type": "practice",
        "section_label": "유제",
        "chapter": "01 지수와 로그",
        "local_number": "1",
        "problem_number": "1",
        "display_number": "1",
        "stem_latex": "...",
        "stem_text": "...",
        "problem_type": "multiple_choice",
        "choices": [...],
        "start_page": 5,
        "end_page": 5,
        "inline_solution": null,
        "inline_answer": null,
        "inline_hint": null,
    }],
    "problem_pages": [4, 101],
    "answer_pages": [102, 160],
    "quick_answer_pages": [102, 102],
}
```

### match_answers → finalize_textbook

Adds to each segment:
```python
{
    "answer_text": "①",
    "solution_latex": "...",
    "solution_text": "...",
    "answer_match_status": "matched" | "inline" | "unmatched",
    "match_confidence": 1.0,
}
```

## Backward Compatibility

- Existing 쎈/RPM patterns in segment_textbook.py are preserved
- Item code detection is additive — if no item codes found, falls back to existing patterns
- Pipeline chain (submit→poll→parse→detect→segment→match→finalize) unchanged
- Existing exam pipeline completely unaffected
