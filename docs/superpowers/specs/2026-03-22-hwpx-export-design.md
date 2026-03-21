# HWPX Export — Design Spec

> Export exam papers and problem sets from the problem bank as HWPX files
> with native HWP equation objects editable in Hancom Hangul.

## Context

Teachers using JSMath need to export exam papers in HWPX format (Korean standard word processor format) so they can further edit the documents — including math equations — in Hancom Hangul. The current ExamDocument pipeline only supports PDF output via LaTeX compilation.

### Requirements

- **Native equations**: All LaTeX math must be converted to HWP equation script and embedded as native equation objects (editable in Hangul's equation editor)
- **Two templates**: CSAT-style (2-column, point values) and school-exam-style (1-column, school header)
- **Endnotes (미주)**: Answers and solutions inserted as endnotes with configurable content (answer, solution, source, difficulty, points)
- **Two entry points**: ExamDocument download format option + quick export from problem bank
- **Image assets**: Graphs/diagrams embedded as images (not converted to drawing objects)

## Architecture

### Component Overview

```
                  ExamDocumentsService
                         |
            +------------+------------+
            v            v            v
      generatePdf()  generateHwpx()  (future)
            |            |
            v            v
    LatexCompiler    HwpxCompiler
    (EJS -> LaTeX    (data -> XML
     -> pdflatex)     -> ZIP -> .hwpx)
            |            |
            v            v
         S3 upload    S3 upload
```

### New Components

| Component | Responsibility | Path |
|-----------|---------------|------|
| `LaTeXToHwpEquation` | LaTeX string -> HWP equation script string | `apps/lms-api/src/exam-documents/hwpx/latex-to-hwp-equation.ts` |
| `HwpxCompilerService` | Problem data -> HWPX XML -> ZIP packaging | `apps/lms-api/src/exam-documents/hwpx/hwpx-compiler.service.ts` |
| HWPX templates | Base XML skeletons for CSAT/school-exam styles | `apps/lms-api/src/exam-documents/hwpx/templates/` |

### Dependencies

- `jszip` — ZIP archive creation
- `sharp` — WebP to PNG image conversion for problem assets
- No external binaries or Rust/Python dependencies

### Alternatives Considered

| Approach | Verdict | Reason |
|----------|---------|--------|
| **python-hwpx** (Pure Python HWPX XML lib) | Rejected | No equation API — still need manual XML injection. Adds cross-service communication (NestJS → Redis → FastAPI) for a web feature. python-hwpx only helps with document skeleton, not the hard part (equations). |
| **pyhwpx** (COM automation) | Rejected | Windows + Hangul installation required. Cannot run on Linux/Docker servers. |
| **hwpxlib** (Java) | Rejected | JVM dependency. Would require a sidecar Java service or subprocess. |
| **HwpForge** (Rust CLI) | Rejected | Early-stage project. Rust binary dependency complicates deployment. |
| **DOCX → HWPX conversion** | Rejected | Double conversion loses equation/layout fidelity. LibreOffice HWPX support incomplete. |

### Quick Export Module Ownership

The quick export endpoint (`POST /problems/export-hwpx`) is owned by the `exam-documents` module, not the `problems` module. The endpoint path is under `/exam-documents/quick-export` to keep all document generation logic colocated. The `ProblemsController` is not modified.

### BullMQ Queue

HWPX generation shares the existing `exam-document-pdf` queue with a different job name (`generate-hwpx`). Since HWPX generation has no external binary dependency (unlike `xelatex`), it runs faster and does not need a separate queue.

## LaTeX -> HWP Equation Converter

### Pipeline

```
LaTeX string -> Tokenizer -> AST Parser -> HWP Code Generator -> HWP script string
```

Three-stage pipeline with AST as intermediate representation. Direct string substitution breaks on nested structures (e.g., `\frac{a+b}{c+d}`), so a proper parse tree is necessary.

### Conversion Map (Key Mappings)

| LaTeX | HWP Script | Category |
|-------|-----------|----------|
| `\frac{a}{b}` | `a OVER b` | Fraction |
| `\sqrt{x}` | `SQRT{x}` | Root |
| `\sqrt[3]{x}` | `ROOT{3}{x}` | Nth root |
| `x^{2}` | `x^{2}` | Superscript (identical) |
| `x_{n}` | `x_{n}` | Subscript (identical) |
| `\int_{a}^{b}` | `INT _{a}^{b}` | Integral |
| `\sum_{i=1}^{n}` | `SUM _{i=1}^{n}` | Summation |
| `\lim_{x \to 0}` | `lim _{x -> 0}` | Limit |
| `\begin{pmatrix}a&b\\c&d\end{pmatrix}` | `MATRIX{a & b # c & d}` | Matrix |
| `\vec{x}` | `VEC x` | Decoration |
| `\bar{x}` | `BAR x` | Decoration |
| `\hat{x}` | `HAT x` | Decoration |
| `\leq` / `\geq` / `\neq` | `<=` / `>=` / `<>` | Comparison |
| `\times` / `\cdot` | `TIMES` / `CDOT` | Operators |
| `\infty` | `inf` | Symbols |
| `\alpha`, `\beta`, ... | `alpha`, `beta`, ... | Greek letters |
| `\left( \right)` | `LEFT( RIGHT)` | Delimiters |
| `\begin{cases}...\end{cases}` | `CASES{...}` | Cases |

> **Note:** The conversion map above is a starting reference. Standard LaTeX uses `\begin{cases}...\end{cases}` (amsmath), not `\cases{...}`. Verify each mapping against actual `stemLatex` values in the database and against the target Hangul version during Phase 1 implementation. The HWP equation editor's command syntax can vary between Hangul versions — test against Hangul 2020+.

### Coverage Priority

1. **Must-have (covers 99% of high school math):** fractions, roots, super/subscripts, integrals, summation, limits, Greek letters, comparisons, basic delimiters
2. **Important:** matrices, vector/bar/hat decorations, cases, log, trig functions
3. **Later:** align environments, multi-line equations, custom macros

### Fallback Strategy

When conversion fails for an expression, insert the original LaTeX as plain text and emit a warning log. Document generation never fails due to an unconvertible equation.

## HWPX File Structure

```
exam.hwpx (ZIP)
+-- mimetype
+-- version.xml
+-- settings.xml
+-- META-INF/
|   +-- manifest.xml
|   +-- container.xml
+-- Contents/
|   +-- content.hpf          # Manifest (fonts, styles)
|   +-- header.xml           # Page setup, margins, style definitions
|   +-- section0.xml         # Body content (problems + endnote refs)
+-- BinData/
|   +-- image001.png         # Problem asset images
|   +-- image002.png
|   +-- ...
```

### Template Strategy

Reverse-engineer HWPX structure from sample files created in Hancom Hangul. Store the XML skeletons as templates, and populate them at runtime.

```
templates/
+-- base/                    # Common XML skeleton
|   +-- mimetype
|   +-- version.xml
|   +-- META-INF/
|   +-- Contents/
|       +-- content.hpf
+-- csat-style/              # CSAT style (2-column, point display)
|   +-- header.xml
+-- school-exam-style/       # School exam style (1-column, school header)
    +-- header.xml
```

### Image Asset Format Conversion

`ProblemAsset` stores images as WebP (`format: "webp"`). WebP is not natively supported in older versions of Hancom Hangul. The HWPX generator must convert WebP assets to PNG before embedding them in the `BinData/` directory. Use the `sharp` library (already common in Node.js image processing) for this conversion.

S3 asset downloads should be parallelized with a concurrency limit of 5 to avoid overwhelming the connection pool for large exams with many diagrams.

### Shared Stem Handling (Sub-Problems)

The `Problem` model has `sharedStemLatex` and a parent-child relationship (`parentId` / `subProblems`). When exporting a group of sub-problems that share a common stem (e.g., "Given the following graph, answer questions 5-7"), the generator must:

1. Detect consecutive problems that share the same `parentId`
2. Render the `sharedStemLatex` once as a shared header
3. Render each sub-problem indented below the shared stem
4. Avoid duplicating the shared stem across sub-problems

This is a common pattern in Korean math exams (CSAT "common question" sets).

### Section XML Generation (Pseudocode)

```typescript
for (const [i, problem] of problems.entries()) {
  // 0. Shared stem (if sub-problem group starts here)
  if (problem.sharedStemLatex && isFirstInGroup(problem, problems, i)) {
    appendSharedStem(problem.sharedStemLatex);
  }

  // 1. Problem number + points
  appendParagraph(`${i + 1}.`, { bold: true });

  // 2. Problem body — mixed text + HWP equation objects
  appendMixedContent(problem.stemLatex);

  // 3. Image assets from S3 (WebP -> PNG converted)
  for (const asset of problem.assets) {
    appendImage(asset.s3Key);  // convert WebP->PNG, add to BinData/ + XML ref
  }

  // 4. Choices (multiple choice)
  if (problem.choices.length > 0) {
    appendChoices(problem.choices);
  }

  // 5. Endnote marker
  if (hasAnyEndnoteContent) {
    appendEndnoteRef(i + 1);
  }
}

// Endnote content
for (const [i, problem] of problems.entries()) {
  appendEndnote(i + 1, {
    answer:     opts.answer     ? problem.answerText       : null,
    solution:   opts.solution   ? problem.solutionLatex    : null,
    source:     opts.source     ? formatSource(problem)    : null,
    difficulty: opts.difficulty  ? problem.difficulty       : null,
    points:     opts.points     ? problem.pointValue       : null,
  });
}
```

## Endnote System

### Configuration

```typescript
interface EndnoteOptions {
  answer: boolean;      // default: true
  solution: boolean;    // default: true
  source: boolean;      // default: false
  difficulty: boolean;  // default: false
  points: boolean;      // default: false
}
```

### Rendering Format (per endnote)

```
1) [answer] 3
   [solution] Since f(x) = x^2 + 3x + 1, f'(x) = 2x + 3, so...
   [source] 2024 June Mock Exam, Math #30
   [difficulty] 4/6  [points] 4
```

Each item is a separate paragraph within the endnote. Solutions containing math use the same HWP equation conversion as the problem body.

### Source Field Formatting

The `examSource` and `bookSource` fields are `Json?` in Prisma. The endnote formatter serializes them as follows:

```typescript
function formatSource(problem: Problem): string | null {
  // Exam-sourced problems: examSource = { year, month, type, number? }
  if (problem.examSource) {
    const s = problem.examSource as { year: number; month: number; type: string; number?: number };
    return `${s.year}학년도 ${s.month}월 ${s.type}${s.number ? ` ${s.number}번` : ''}`;
    // e.g., "2024학년도 6월 모의평가 30번"
  }
  // Textbook-sourced problems: bookSource = { title, chapter?, section?, publisher? }
  if (problem.bookSource) {
    const b = problem.bookSource as { title: string; chapter?: string; section?: string; publisher?: string };
    const parts = [b.title, b.chapter, b.section].filter(Boolean);
    return parts.join(' > ');
    // e.g., "수학의 정석 > 3장 > 미분법"
  }
  return null;
}
```

### Null Field Handling in Endnotes

`pointValue` is only populated for CSAT-style problems. When a selected endnote option references a null field, that item is silently skipped for that problem (not shown in the endnote). No warning is needed — this is expected behavior for mixed-source problem sets.

### HWPX Endnote XML

> **Note:** The XML snippets below are **speculative placeholders**. The actual OWPML endnote and equation element structure will be determined during Phase 2 reverse engineering from Hangul sample files. The real structure likely uses `<hp:ctrl>` containers and `<hp:eqEdit>` elements rather than the simplified tags shown here.

```xml
<!-- Endnote marker in body (placeholder — verify in Phase 2) -->
<hp:run>
  <hp:endnoteRef number="1" />
</hp:run>

<!-- Endnote content (placeholder — verify in Phase 2) -->
<hp:endnote number="1">
  <hp:p><hp:run><hp:t>[정답] ③</hp:t></hp:run></hp:p>
  <hp:p>
    <hp:run><hp:t>[해설] </hp:t></hp:run>
    <!-- Equation element structure TBD from reverse engineering -->
    ...
  </hp:p>
</hp:endnote>
```

When all endnote options are OFF, no endnote markers are inserted in the body.

## API Design

### 1. ExamDocument Download Extension

```
GET /exam-documents/:id/download?type=hwpx
GET /exam-documents/:id/download?type=hwpx-answer
```

Lazy generation: HWPX is generated on first request, not at ExamDocument creation time.

Flow:
- `hwpxS3Key` exists -> return pre-signed URL
- `hwpxS3Key` null -> enqueue BullMQ job -> return 202 with status -> client polls -> URL on completion

### 2. Quick Export (under exam-documents module)

```
POST /exam-documents/quick-export
{
  "problemIds": ["id1", "id2", ...],
  "template": "csat" | "school-exam",
  "title": "Optional title",
  "headerConfig": {
    "schoolName": "Optional",
    "subject": "Optional",
    "date": "Optional",
    "duration": "Optional"
  },
  "endnoteOptions": {
    "answer": true,
    "solution": true,
    "source": false,
    "difficulty": false,
    "points": false
  }
}

Response (202):
{ "exportId": "...", "status": "generating" }

GET /problems/export-hwpx/:exportId
Response:
{ "status": "completed", "downloadUrl": "..." }
```

Quick export does not create an ExamDocument. Temporary HWPX files are stored in S3 under the `exports/hwpx/` prefix with a 24-hour TTL lifecycle rule. This requires an S3 lifecycle configuration on the `exports/hwpx/` prefix (infrastructure dependency).

### DTO Validation (Quick Export)

Following the existing `CreateExamDocumentDto` pattern with `class-validator`:
- `problemIds`: `@IsArray()`, `@ArrayMinSize(1)`, `@ArrayMaxSize(100)`, `@IsString({ each: true })`
- `template`: `@IsEnum(['csat', 'school-exam'])`
- `title`: `@IsOptional()`, `@IsString()`, `@MaxLength(200)`
- `headerConfig`: `@IsOptional()`, `@ValidateNested()`
- `endnoteOptions`: `@IsOptional()`, `@ValidateNested()`, defaults applied server-side

### 3. DB Changes

Add to `ExamDocument` model:

```prisma
hwpxS3Key       String?
answerHwpxS3Key String?
```

No new table for quick exports — S3 lifecycle handles cleanup.

HWPX generation status is tracked independently from PDF status. Add `hwpxStatus` to avoid overloading the existing `status` field (which tracks PDF generation):

```prisma
hwpxS3Key       String?
answerHwpxS3Key String?
hwpxStatus      ExamDocumentStatus?  // null = never requested, "generating", "completed", "failed"
```

## Implementation Phases

### Phase 1 — LaTeX -> HWP Equation Converter

- Tokenizer
- AST parser
- HWP script code generator
- Test suite: 50+ high school math expressions
- **Gate: 95%+ conversion accuracy on test suite**

### Phase 2 — HWPX Generator

- Reverse-engineer HWPX XML from Hangul sample files (1 CSAT + 1 school exam)
- Base HWPX skeleton generation with jszip
- Problem body + choices rendering
- Image asset embedding (S3 download -> BinData/)
- **Gate: Generated HWPX opens in Hangul with editable equations**

### Phase 3 — Endnotes & Templates

- Endnote XML generation with configurable options
- CSAT-style template (2-column layout)
- School-exam-style template (1-column layout)
- EndnoteOptions application

### Phase 4 — API Integration

- Prisma migration: add hwpxS3Key columns
- `GET /exam-documents/:id/download?type=hwpx` with lazy generation
- `POST /exam-documents/quick-export` quick export endpoint
- BullMQ queue integration
- Frontend: download button HWPX option + endnote settings UI

## Risks & Mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| HWPX equation XML structure cannot be accurately reverse-engineered | **High** | Create sample files in Hangul with equations before Phase 2. If structure is undocumented or too complex, reassess approach entirely. |
| LaTeX converter fails on some expressions | Medium | Fallback to plain text insertion + log warning. Expand coverage incrementally. |
| 2-column layout XML is complex | Medium | Start with 1-column (school-exam). Add CSAT 2-column in Phase 3. |
| Hangul version compatibility | Low | HWPX is a standard (KS X 6101); versions since 2020 are broadly compatible. |
| Equation XML uses binary data instead of script text | Medium | If reverse engineering reveals binary equation objects rather than text scripts, the converter output format changes from string to binary buffer. Phase 2 gate catches this early. Fallback: use python-hwpx reference or Hancom's official OWPML spec PDF. |
| S3 lifecycle rule not configured for `exports/hwpx/` prefix | Low | Add to infrastructure setup checklist in Phase 4. Without it, temp files accumulate but nothing breaks. |

## Verification Gates

- **After Phase 1**: Converter accuracy >= 95% on curated test suite of 50+ expressions
- **After Phase 2**: Generated HWPX opens in Hangul AND equations are editable in equation editor (critical gate)
- **After Phase 3**: Both templates render correctly with endnotes
- **After Phase 4**: End-to-end flow works from UI to downloaded HWPX file
