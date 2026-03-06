# EBS Textbook OCR Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Support EBS 수능특강 textbooks in the OCR pipeline using item code-based segmentation.

**Architecture:** Extend the existing textbook pipeline (detect_sections → segment_textbook → match_answers → finalize_textbook) with item code detection, section state tracking, inline solution capture, and section-aware answer matching. No new pipeline stages — internal logic changes only.

**Tech Stack:** Python 3.12+, Celery, SQLAlchemy, regex, pytest

**Design doc:** `docs/plans/2026-03-06-ebs-textbook-ocr-design.md`

---

## Task 1: Test Infrastructure Setup

**Files:**
- Create: `apps/ocr-api/tests/__init__.py`
- Create: `apps/ocr-api/tests/conftest.py`
- Create: `apps/ocr-api/tests/workers/__init__.py`

**Step 1: Create test directories and conftest**

```python
# tests/__init__.py
# (empty)

# tests/workers/__init__.py
# (empty)

# tests/conftest.py
"""Shared test fixtures for OCR pipeline tests."""
import pytest
from unittest.mock import MagicMock

from app.models.ocr import OcrLine, OcrPage


def make_line(
    text: str,
    *,
    line_number: int = 0,
    latex: str | None = None,
    line_type: str = "text",
    bbox_x: float | None = None,
    bbox_y: float | None = None,
    bbox_w: float | None = None,
    bbox_h: float | None = None,
) -> OcrLine:
    """Create a mock OcrLine for testing."""
    line = MagicMock(spec=OcrLine)
    line.text = text
    line.latex = latex or text
    line.line_number = line_number
    line.line_type = line_type
    line.bbox_x = bbox_x
    line.bbox_y = bbox_y
    line.bbox_w = bbox_w
    line.bbox_h = bbox_h
    return line


def make_page(page_number: int, lines: list[OcrLine]) -> OcrPage:
    """Create a mock OcrPage for testing."""
    page = MagicMock(spec=OcrPage)
    page.page_number = page_number
    page.lines = lines
    return page
```

**Step 2: Verify pytest runs**

Run: `cd apps/ocr-api && .venv/bin/python -m pytest tests/ -v --co`
Expected: "no tests ran" (collected 0)

**Step 3: Commit**

```bash
git add apps/ocr-api/tests/
git commit -m "test: add test infrastructure for OCR pipeline"
```

---

## Task 2: segment_textbook.py — Item Code + Section Patterns

**Files:**
- Modify: `apps/ocr-api/app/workers/segment_textbook.py`
- Create: `apps/ocr-api/tests/workers/test_segment_textbook.py`

**Step 1: Write tests for new pattern matching functions**

```python
# tests/workers/test_segment_textbook.py
"""Tests for EBS textbook segmentation patterns."""
import pytest

from app.workers.segment_textbook import (
    _match_item_code,
    _match_section_transition,
    _match_example_start,
    _match_past_exam_year,
    _is_inline_block,
)


class TestItemCodePattern:
    def test_standard_code(self):
        assert _match_item_code("[26008-0001]") == "26008-0001"

    def test_code_with_surrounding_text(self):
        assert _match_item_code("  [26008-0123]  ") == "26008-0123"

    def test_no_code(self):
        assert _match_item_code("regular text") is None

    def test_partial_code(self):
        assert _match_item_code("[26008]") is None

    def test_code_in_problem_line(self):
        # Item code is typically on its own line
        assert _match_item_code("[26008-0001]") == "26008-0001"


class TestSectionTransition:
    def test_level_1(self):
        result = _match_section_transition("Level 1 기초 연습")
        assert result == ("level1", "Level 1 기초 연습")

    def test_level_2(self):
        result = _match_section_transition("Level 2 기본 연습")
        assert result == ("level2", "Level 2 기본 연습")

    def test_level_3(self):
        result = _match_section_transition("Level 3 실력 완성")
        assert result == ("level3", "Level 3 실력 완성")

    def test_practice_header(self):
        result = _match_section_transition("유제")
        assert result == ("practice", "유제")

    def test_past_exam_header(self):
        result = _match_section_transition("대표 기출 문제")
        assert result == ("past_exam", "대표 기출 문제")

    def test_quick_answer_header(self):
        result = _match_section_transition("한눈에 보는 정답")
        assert result == ("quick_answer", "한눈에 보는 정답")

    def test_regular_text(self):
        assert _match_section_transition("일반 텍스트") is None

    def test_chapter_header(self):
        # Chapter headers like "01 지수와 로그" should not be section transitions
        assert _match_section_transition("01 지수와 로그") is None


class TestExampleStart:
    def test_standard_example(self):
        result = _match_example_start("예제 1 거듭제곤근")
        assert result == ("1", "예제 1 거듭제곤근")

    def test_example_number_only(self):
        result = _match_example_start("예제 3")
        assert result == ("3", "예제 3")

    def test_not_example(self):
        assert _match_example_start("유제 1") is None


class TestPastExamYear:
    def test_suneung(self):
        assert _match_past_exam_year("2023학년도 수능") == "2023학년도 수능"

    def test_mock_exam(self):
        assert _match_past_exam_year("2025학년도 수능") == "2025학년도 수능"

    def test_regular_text(self):
        assert _match_past_exam_year("일반 텍스트") is None


class TestInlineBlock:
    def test_jamkani(self):
        assert _is_inline_block("잠깐이") is True

    def test_puri(self):
        assert _is_inline_block("풀이") is True

    def test_answer_marker(self):
        assert _is_inline_block("답 ④") is True
        assert _is_inline_block("답 125") is True

    def test_exam_intent(self):
        assert _is_inline_block("출제 의도") is True

    def test_exam_trend(self):
        assert _is_inline_block("출제 경향") is True

    def test_regular_text(self):
        assert _is_inline_block("일반 수학 문제 텍스트") is False
```

**Step 2: Run tests to verify they fail**

Run: `cd apps/ocr-api && .venv/bin/python -m pytest tests/workers/test_segment_textbook.py -v`
Expected: ImportError — functions don't exist yet

**Step 3: Implement pattern matching functions in segment_textbook.py**

Add these patterns and functions near the top of `segment_textbook.py`, after existing patterns:

```python
# ─── EBS Item Code Pattern ───
_ITEM_CODE_PATTERN = re.compile(r"\[(\d{5}-\d{4})\]")

# ─── Section Transition Patterns (EBS 수능특강) ───
_SECTION_TRANSITIONS = [
    (re.compile(r"^\s*Level\s*1\b", re.IGNORECASE), "level1"),
    (re.compile(r"^\s*Level\s*2\b", re.IGNORECASE), "level2"),
    (re.compile(r"^\s*Level\s*3\b", re.IGNORECASE), "level3"),
    (re.compile(r"^\s*유제\s*$"), "practice"),
    (re.compile(r"^\s*대표\s*기출\s*문제"), "past_exam"),
    (re.compile(r"^\s*한눈에\s*보는\s*정답"), "quick_answer"),
    (re.compile(r"^\s*정답과\s*풀이"), "answer_detail"),
]

# ─── Example Start Pattern ───
_EXAMPLE_PATTERN = re.compile(r"^\s*예제\s*(\d{1,2})\s*(.*)")

# ─── Past Exam Year Pattern ───
_PAST_EXAM_YEAR_PATTERN = re.compile(r"(\d{4}학년도\s*(?:수능|6월모의평가|9월모의평가|교육청모의고사))")

# ─── Inline Block Patterns (잠깐의, 풀이, 답, 출제의도, 출제경향) ───
_INLINE_BLOCK_PATTERNS = [
    re.compile(r"^\s*잠깐이?\s*$", re.IGNORECASE),
    re.compile(r"^\s*풀이\s*$"),
    re.compile(r"^\s*답\s*[①②③④⑤\d]"),
    re.compile(r"^\s*출제\s*의도"),
    re.compile(r"^\s*출제\s*경향"),
    re.compile(r"^\s*출제경향"),
    re.compile(r"^\s*출제의도"),
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
```

**Step 4: Run tests to verify they pass**

Run: `cd apps/ocr-api && .venv/bin/python -m pytest tests/workers/test_segment_textbook.py -v`
Expected: All PASS

**Step 5: Commit**

```bash
git add apps/ocr-api/app/workers/segment_textbook.py apps/ocr-api/tests/
git commit -m "feat: add EBS item code and section detection patterns"
```

---

## Task 3: segment_textbook.py — Section-Aware _rule_based_segment

**Files:**
- Modify: `apps/ocr-api/app/workers/segment_textbook.py`
- Create: `apps/ocr-api/tests/workers/test_segment_ebs.py`

**Step 1: Write integration test with mock OCR pages**

```python
# tests/workers/test_segment_ebs.py
"""Integration test: EBS 수능특강 segmentation with section state machine."""
import pytest
from tests.conftest import make_line, make_page
from app.workers.segment_textbook import _rule_based_segment


def _build_ebs_chapter_pages():
    """Build mock OCR pages simulating a minimal EBS 수능특강 chapter."""
    pages = []

    # Page 5: 예제 1 + 잠깐의 + 풀이 + 유제 1,2
    pages.append(make_page(5, [
        make_line("예제 1 거듭제곤근", line_number=1),
        make_line("³√(27/³√27) × ⁵√9의 값은?", line_number=2),
        make_line("① ³√3  ② √3  ③ 1  ④ 3  ⑤ 9", line_number=3),
        make_line("잠깐이", line_number=4),
        make_line("a>0, b>0이고 m, n이 2 이상의 자연수일 때", line_number=5),
        make_line("풀이", line_number=6),
        make_line("³√27=³√3³=3, ⁵√9=⁵√3²=³√3이므로", line_number=7),
        make_line("답 ④", line_number=8),
        make_line("유제", line_number=9),
        make_line("[26008-0001]", line_number=10),
        make_line("1", line_number=11),
        make_line("⁵√(-3.2)×10⁶의 값은?", line_number=12),
        make_line("① -20  ② -16  ③ -12  ④ -8  ⑤ -4", line_number=13),
        make_line("[26008-0002]", line_number=14),
        make_line("2", line_number=15),
        make_line("8 이하의 자연수 a, b에 대하여", line_number=16),
        make_line("① 2  ② 3  ③ 4  ④ 5  ⑤ 6", line_number=17),
    ]))

    # Page 14: Level 1 기초 연습
    pages.append(make_page(14, [
        make_line("Level 1 기초 연습", line_number=1),
        make_line("[26008-0011]", line_number=2),
        make_line("1", line_number=3),
        make_line("⁴√81 × ⁶√8의 값은?", line_number=4),
        make_line("① √2  ② √3  ③ 2  ④ √5  ⑤ √6", line_number=5),
        make_line("[26008-0012]", line_number=6),
        make_line("2", line_number=7),
        make_line("두 양수 a, b에 대하여 (a+b)⁻¹=2일 때", line_number=8),
        make_line("① 1/36  ② 1/18  ③ 1/12  ④ 1/9  ⑤ 5/36", line_number=9),
    ]))

    return pages


class TestEbsSegmentation:
    def test_detects_example(self):
        pages = _build_ebs_chapter_pages()
        segments = _rule_based_segment(pages)
        examples = [s for s in segments if s.get("section_type") == "example"]
        assert len(examples) == 1
        assert examples[0]["display_number"] == "예제 1 거듭제곤근"
        assert examples[0]["inline_answer"] == "④"

    def test_detects_practice_with_item_codes(self):
        pages = _build_ebs_chapter_pages()
        segments = _rule_based_segment(pages)
        practice = [s for s in segments if s.get("section_type") == "practice"]
        assert len(practice) == 2
        assert practice[0]["item_code"] == "26008-0001"
        assert practice[1]["item_code"] == "26008-0002"

    def test_detects_level1_with_item_codes(self):
        pages = _build_ebs_chapter_pages()
        segments = _rule_based_segment(pages)
        level1 = [s for s in segments if s.get("section_type") == "level1"]
        assert len(level1) == 2
        assert level1[0]["item_code"] == "26008-0011"
        assert level1[1]["item_code"] == "26008-0012"

    def test_number_reset_distinguished(self):
        """유제 1번과 Level1 1번이 별도 문제로 구분되는지 확인."""
        pages = _build_ebs_chapter_pages()
        segments = _rule_based_segment(pages)
        ones = [s for s in segments if s.get("local_number") == "1"]
        # 예제1, 유제1, Level1-1 = 3 separate problems
        assert len(ones) == 3
        types = {s["section_type"] for s in ones}
        assert types == {"example", "practice", "level1"}

    def test_total_problem_count(self):
        pages = _build_ebs_chapter_pages()
        segments = _rule_based_segment(pages)
        # 1 예제 + 2 유제 + 2 Level1 = 5
        assert len(segments) == 5

    def test_inline_solution_captured(self):
        pages = _build_ebs_chapter_pages()
        segments = _rule_based_segment(pages)
        examples = [s for s in segments if s.get("section_type") == "example"]
        assert examples[0]["inline_solution"] is not None
        assert "³√27" in examples[0]["inline_solution"]

    def test_inline_hint_captured(self):
        pages = _build_ebs_chapter_pages()
        segments = _rule_based_segment(pages)
        examples = [s for s in segments if s.get("section_type") == "example"]
        assert examples[0]["inline_hint"] is not None
```

**Step 2: Run test to verify it fails**

Run: `cd apps/ocr-api && .venv/bin/python -m pytest tests/workers/test_segment_ebs.py -v`
Expected: FAIL — _rule_based_segment returns dicts without section_type/item_code

**Step 3: Rewrite `_rule_based_segment` with section state machine**

Replace the existing `_rule_based_segment` function in `segment_textbook.py`. The new version:
1. Checks for section transitions first (Level, 유제, 대표 기출, etc.)
2. Uses item codes as primary problem boundary
3. Falls back to existing patterns when no item code found
4. Tracks inline blocks (잠깐의, 풀이, 답) within 예제/대표기출
5. Outputs new fields: item_code, section_type, section_label, local_number, inline_*

Key changes to the function flow:
```
for each line:
  1. Check section transition → update current_section
  2. Check item code → flush previous, start new problem
  3. Check 예제 N → flush previous, start new example
  4. Check inline block → capture as metadata on current example/past_exam
  5. Check existing patterns (fallback for non-EBS textbooks)
  6. Accumulate line into current problem
```

The `_build_segment` function also needs updating to include the new fields in its output dict.

**Important:** Preserve existing behavior for non-EBS textbooks. If no item codes are detected across all pages, the function should behave exactly as before. The item code path is additive.

**Step 4: Run tests to verify they pass**

Run: `cd apps/ocr-api && .venv/bin/python -m pytest tests/workers/test_segment_ebs.py -v`
Expected: All PASS

**Step 5: Run existing segment tests (if any) to verify no regression**

Run: `cd apps/ocr-api && .venv/bin/python -m pytest tests/ -v`
Expected: All PASS

**Step 6: Commit**

```bash
git add apps/ocr-api/app/workers/segment_textbook.py apps/ocr-api/tests/
git commit -m "feat: add section state machine and item code segmentation for EBS textbooks"
```

---

## Task 4: detect_sections.py — Quick Answer Page Detection

**Files:**
- Modify: `apps/ocr-api/app/workers/detect_sections.py`
- Create: `apps/ocr-api/tests/workers/test_detect_sections.py`

**Step 1: Write test**

```python
# tests/workers/test_detect_sections.py
"""Tests for EBS section detection — quick answer page."""
from tests.conftest import make_line, make_page
from app.workers.detect_sections import _find_quick_answer_page


class TestQuickAnswerDetection:
    def test_finds_quick_answer_page(self):
        pages = [
            make_page(100, [make_line("Level 3 실력 완성", line_number=1)]),
            make_page(101, [make_line("대표 기출 문제", line_number=1)]),
            make_page(102, [make_line("한눈에 보는 정답", line_number=1)]),
            make_page(103, [make_line("memo", line_number=1)]),
            make_page(105, [make_line("정답과 풀이", line_number=1)]),
        ]
        assert _find_quick_answer_page(pages) == 102

    def test_no_quick_answer(self):
        pages = [
            make_page(100, [make_line("정답 및 해설", line_number=1)]),
        ]
        assert _find_quick_answer_page(pages) is None
```

**Step 2: Run test to verify it fails**

Run: `cd apps/ocr-api && .venv/bin/python -m pytest tests/workers/test_detect_sections.py -v`
Expected: ImportError

**Step 3: Implement `_find_quick_answer_page` in detect_sections.py**

```python
_QUICK_ANSWER_PAGE_KEYWORD = re.compile(r"한눈에\s*보는\s*정답", re.IGNORECASE)


def _find_quick_answer_page(pages: list[OcrPage]) -> int | None:
    """Find the page with '한눈에 보는 정답' quick answer table."""
    for page in pages:
        sorted_lines = sorted(page.lines, key=lambda l: l.line_number)
        for line in sorted_lines[:5]:
            if _QUICK_ANSWER_PAGE_KEYWORD.search(line.text):
                return page.page_number
    return None
```

Also update the `_detect` function's return dict to include `quick_answer_pages`:
- After finding the standard answer_start_page, also call `_find_quick_answer_page`
- Add `"quick_answer_pages": [qap, qap] if qap else None` to the return

**Step 4: Run tests**

Run: `cd apps/ocr-api && .venv/bin/python -m pytest tests/workers/test_detect_sections.py -v`
Expected: All PASS

**Step 5: Commit**

```bash
git add apps/ocr-api/app/workers/detect_sections.py apps/ocr-api/tests/
git commit -m "feat: detect '한눈에 보는 정답' quick answer page for EBS textbooks"
```

---

## Task 5: match_answers.py — Section-Aware Answer Matching

**Files:**
- Modify: `apps/ocr-api/app/workers/match_answers.py`
- Create: `apps/ocr-api/tests/workers/test_match_answers.py`

**Step 1: Write test for quick answer table parsing**

```python
# tests/workers/test_match_answers.py
"""Tests for EBS section-aware answer matching."""
from tests.conftest import make_line, make_page
from app.workers.match_answers import _parse_ebs_quick_answer_table


class TestEbsQuickAnswerParsing:
    def test_parse_practice_section(self):
        pages = [make_page(102, [
            make_line("01 지수와 로그", line_number=1),
            make_line("유제", line_number=2),
            make_line("1 ① 2 ③ 3 125 4 ④ 5 ① 6 ② 7 ⑤ 8 ③", line_number=3),
            make_line("9 ③ 10 ①", line_number=4),
            make_line("Level 1 기초 연습", line_number=5),
            make_line("1 ⑤ 2 ⑤ 3 ② 4 ⑤ 5 100 6 5 7 ⑤ 8 ⑤", line_number=6),
        ])]
        result = _parse_ebs_quick_answer_table(pages)
        # Key = (chapter, section_type, local_number)
        assert result[("01", "practice", "1")] == "①"
        assert result[("01", "practice", "3")] == "125"
        assert result[("01", "practice", "10")] == "①"
        assert result[("01", "level1", "1")] == "⑤"
        assert result[("01", "level1", "5")] == "100"

    def test_multiple_chapters(self):
        pages = [make_page(102, [
            make_line("01 지수와 로그", line_number=1),
            make_line("유제", line_number=2),
            make_line("1 ① 2 ③", line_number=3),
            make_line("02 지수함수와 로그함수", line_number=4),
            make_line("유제", line_number=5),
            make_line("1 ② 2 ③", line_number=6),
        ])]
        result = _parse_ebs_quick_answer_table(pages)
        assert result[("01", "practice", "1")] == "①"
        assert result[("02", "practice", "1")] == "②"
```

**Step 2: Run test to verify it fails**

Run: `cd apps/ocr-api && .venv/bin/python -m pytest tests/workers/test_match_answers.py -v`
Expected: ImportError

**Step 3: Implement `_parse_ebs_quick_answer_table`**

```python
# Chapter header pattern for quick answer table: "01 지수와 로그"
_QA_CHAPTER_PATTERN = re.compile(r"^\s*(\d{2})\s+\S")

# Section label mapping for quick answer table
_QA_SECTION_MAP = {
    "유제": "practice",
    "Level 1": "level1", "Level 1 기초 연습": "level1",
    "Level 2": "level2", "Level 2 기본 연습": "level2",
    "Level 3": "level3", "Level 3 실력 완성": "level3",
}

# Answer pair pattern: "N answer" where answer is ①-⑤ or a number
_QA_PAIR_PATTERN = re.compile(r"(\d{1,2})\s+([①②③④⑤]|\d+)")


def _parse_ebs_quick_answer_table(
    pages: list[OcrPage],
) -> dict[tuple[str, str, str], str]:
    """Parse '한눈에 보는 정답' page into (chapter, section_type, number) → answer map."""
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
            for label, stype in _QA_SECTION_MAP.items():
                if text.startswith(label):
                    current_section = stype
                    break

            # Parse answer pairs
            if current_chapter and current_section:
                for m in _QA_PAIR_PATTERN.finditer(text):
                    num = m.group(1)
                    ans = m.group(2)
                    result[(current_chapter, current_section, num)] = ans

    return result
```

Also update the main `_match` function:
- If `quick_answer_pages` is provided in prev_result, load those pages and call `_parse_ebs_quick_answer_table`
- For segments with `section_type` and no `inline_answer`, use (chapter, section_type, local_number) to look up answers from the quick answer table
- For segments with `inline_answer` (예제, 대표기출), copy inline_answer → answer_text and set answer_match_status = "inline"

**Step 4: Run tests**

Run: `cd apps/ocr-api && .venv/bin/python -m pytest tests/workers/test_match_answers.py -v`
Expected: All PASS

**Step 5: Commit**

```bash
git add apps/ocr-api/app/workers/match_answers.py apps/ocr-api/tests/
git commit -m "feat: add EBS section-aware quick answer table parsing"
```

---

## Task 6: match_answers.py — Wire Up Section-Aware Matching

**Files:**
- Modify: `apps/ocr-api/app/workers/match_answers.py`

**Step 1: Update `_match` function**

In the main `_match` async function, add EBS-specific matching logic:

```python
# After existing answer parsing, add EBS quick answer matching:

# Load quick answer table if available
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

# In the per-segment matching loop:
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
    chapter_num = chapter[:2] if chapter else ""  # "01 지수와 로그" → "01"
    section_type = seg.get("section_type", "")
    local_num = seg.get("local_number", "")
    ebs_key = (chapter_num, section_type, local_num)

    if ebs_key in ebs_answers:
        seg["answer_text"] = ebs_answers[ebs_key]
        seg["answer_match_status"] = "matched"
        seg["match_confidence"] = 0.9
        matched_count += 1
        # Also try detailed solution matching (existing logic)
        pnum = seg.get("problem_number")
        if pnum and pnum in solution_map:
            sol = solution_map[pnum]
            seg["solution_latex"] = sol.get("solution_latex")
            seg["solution_text"] = sol.get("solution_text")
            seg["match_confidence"] = 1.0
        continue

    # Fall through to existing matching logic...
```

**Step 2: Manual verification**

This change integrates with the DB, so verify by inspecting logic only (no automated test for the async function). The pure functions are already tested in Task 5.

**Step 3: Commit**

```bash
git add apps/ocr-api/app/workers/match_answers.py
git commit -m "feat: wire up EBS quick answer and inline answer matching"
```

---

## Task 7: finalize_textbook.py + files.service.ts — Pass Through New Fields

**Files:**
- Modify: `apps/ocr-api/app/workers/finalize_textbook.py`
- Modify: `apps/lms-api/src/files/files.service.ts`

**Step 1: Update finalize_textbook.py**

In the problem payload builder loop in `_finalize`, add the new fields:

```python
# Inside the for segment in segments: loop, in the problem dict:
problem = {
    # ... existing fields ...
    "bookSource": {
        "title": book_title,
        "publisher": publisher,
        "chapter": segment.get("chapter"),
        "section": segment.get("section_label") or segment.get("section"),
        "sectionType": segment.get("section_type"),
        "problemCategory": segment.get("problem_category"),
        "itemCode": segment.get("item_code"),
        "localNumber": segment.get("local_number"),
        "difficultyLabel": segment.get("problem_category"),
        "inlineHint": segment.get("inline_hint"),
    },
    # ... rest of existing fields ...
}
```

**Step 2: Update files.service.ts**

No changes needed — `bookSource` is already stored as a JSON blob via:
```typescript
...(p.bookSource ? { bookSource: p.bookSource as any } : {}),
```
The new fields (sectionType, itemCode, localNumber, inlineHint) will automatically be included in the JSON. Verify this by reading the existing code at `files.service.ts:236`.

**Step 3: Commit**

```bash
git add apps/ocr-api/app/workers/finalize_textbook.py
git commit -m "feat: include item_code and section_type in textbook problem payload"
```

---

## Task 8: End-to-End Manual Test

**Step 1: Start infrastructure**

```bash
docker compose up -d  # PostgreSQL + Redis
pnpm dev:lms          # NestJS (terminal 1)
pnpm dev:ocr          # FastAPI (terminal 2)
cd apps/ocr-api && .venv/bin/celery -A app.celery_app worker -l info --concurrency=2  # terminal 3
```

**Step 2: Upload the test PDF**

Upload `docs/2027 수능특강 수학 I.pdf` via the web UI with:
- documentType: "textbook"
- bookTitle: "수능특강 수학I"
- publisher: "EBS"

**Step 3: Monitor pipeline**

Watch Celery logs for:
1. `task.textbook.detect_sections` — should detect quick_answer_pages around p102
2. `task.textbook.segment` — should log "Textbook segmentation found N problems"
3. `task.textbook.match_answers` — should log matched count
4. `task.textbook.finalize` — should log problem count

**Step 4: Verify in DB**

```sql
-- Check problems were created with item codes
SELECT problem_number, book_source->>'itemCode', book_source->>'sectionType',
       answer_text, answer_match_status
FROM lms."Problem"
WHERE ocr_job_id = '<job_id>'
ORDER BY (book_source->>'itemCode')::text
LIMIT 20;
```

**Step 5: Verify in web UI**

- Check problem list shows all problem types (예제, 유제, Level 1/2/3)
- Check answers are populated
- Check book_source metadata is visible

**Step 6: Final commit if any fixes needed**

```bash
git commit -m "fix: adjustments from E2E testing"
```

---

## Summary

| Task | Description | Estimated Effort |
|------|-------------|-----------------|
| 1 | Test infrastructure | Small |
| 2 | Pattern matching functions | Medium |
| 3 | Section state machine in _rule_based_segment | **Large** |
| 4 | Quick answer page detection | Small |
| 5 | Quick answer table parsing | Medium |
| 6 | Wire up section-aware matching | Medium |
| 7 | Finalize + NestJS passthrough | Small |
| 8 | End-to-end manual test | Manual |

**Critical path:** Task 1 → 2 → 3 (core segmentation) → 4 → 5 → 6 (answer matching) → 7 → 8

**Parallelizable:** Tasks 2+4 can run in parallel (patterns). Tasks 5+7 can run in parallel after their dependencies.
