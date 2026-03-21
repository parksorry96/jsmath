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
- No external binaries or Rust/Python dependencies

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
| `\cases{...}` | `CASES{...}` | Cases |

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

### Section XML Generation (Pseudocode)

```typescript
for (const [i, problem] of problems.entries()) {
  // 1. Problem number + points
  appendParagraph(`${i + 1}.`, { bold: true });

  // 2. Problem body — mixed text + HWP equation objects
  appendMixedContent(problem.stemLatex);

  // 3. Image assets from S3
  for (const asset of problem.assets) {
    appendImage(asset.s3Key);  // add to BinData/ + XML ref
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
    answer:     opts.answer     ? problem.answerText     : null,
    solution:   opts.solution   ? problem.solutionLatex  : null,
    source:     opts.source     ? problem.examSource     : null,
    difficulty: opts.difficulty  ? problem.difficulty     : null,
    points:     opts.points     ? problem.pointValue     : null,
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

### HWPX Endnote XML

```xml
<!-- Endnote marker in body -->
<hp:run>
  <hp:endnoteRef number="1" />
</hp:run>

<!-- Endnote content -->
<hp:endnote number="1">
  <hp:p><hp:run><hp:t>[answer] 3</hp:t></hp:run></hp:p>
  <hp:p>
    <hp:run><hp:t>[solution] </hp:t></hp:run>
    <hp:equation script="f(x) = x^2 + 3x + 1" />
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

### 2. Quick Export from Problem Bank

```
POST /problems/export-hwpx
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

Quick export does not create an ExamDocument. Temporary HWPX files are stored in S3 with a 24-hour TTL lifecycle rule.

### 3. DB Changes

Add to `ExamDocument` model:

```prisma
hwpxS3Key       String?
answerHwpxS3Key String?
```

No new table for quick exports — S3 lifecycle handles cleanup.

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
- `POST /problems/export-hwpx` quick export endpoint
- BullMQ queue integration
- Frontend: download button HWPX option + endnote settings UI

## Risks & Mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| HWPX equation XML structure cannot be accurately reverse-engineered | **High** | Create sample files in Hangul with equations before Phase 2. If structure is undocumented or too complex, reassess approach entirely. |
| LaTeX converter fails on some expressions | Medium | Fallback to plain text insertion + log warning. Expand coverage incrementally. |
| 2-column layout XML is complex | Medium | Start with 1-column (school-exam). Add CSAT 2-column in Phase 3. |
| Hangul version compatibility | Low | HWPX is a standard (KS X 6101); versions since 2020 are broadly compatible. |

## Verification Gates

- **After Phase 1**: Converter accuracy >= 95% on curated test suite of 50+ expressions
- **After Phase 2**: Generated HWPX opens in Hangul AND equations are editable in equation editor (critical gate)
- **After Phase 3**: Both templates render correctly with endnotes
- **After Phase 4**: End-to-end flow works from UI to downloaded HWPX file
