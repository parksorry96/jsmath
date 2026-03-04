# OCR Pipeline Requirements — Math Problem Domain

## 1. Problem Structure (Korean Math Textbooks)

### 1.1 Number Patterns

Korean math textbooks use hierarchical problem numbering:

| Level | Pattern | Examples | Regex |
|-------|---------|----------|-------|
| Main problem | Arabic numeral + period | `1.`, `2.`, `15.` | `^\s*(\d{1,3})\s*\.\s*` |
| Main problem (alt) | Standalone number | `1 다음 중...` | `^\s*(\d{1,3})\s+(?=[가-힣])` |
| Sub-problem | Parenthesized number | `(1)`, `(2)` | `^\s*\((\d{1,2})\)\s*` |
| Sub-problem (alt) | Number + closing paren | `1)`, `2)` | `^\s*(\d{1,2})\)\s*` |
| Sub-sub item | Korean syllable | `(가)`, `(나)`, `(다)` | `^\s*\(([가-힣])\)\s*` |
| Consonant label | Korean consonant | `ㄱ.`, `ㄴ.`, `ㄷ.` | `^\s*([ㄱ-ㅎ])\.\s*` |
| Multiple choice | Circled number | `①`, `②`, `③`, `④`, `⑤` | `^\s*([①②③④⑤])\s*` |
| Section marker | Bracketed type | `[서술형]`, `[논술형]` | `^\s*\[?(서술형\|논술형\|단답형)\]?\s*` |

### 1.2 Problem Types

| Type | Korean | Description | Has choices? |
|------|--------|-------------|-------------|
| `multiple_choice` | 객관식 | 5 choices (①-⑤), single answer | Yes (exactly 5) |
| `short_answer` | 주관식 단답형 | Numeric or expression answer | No |
| `written_solution` | 서술형 | Full solution process required | No |
| `essay` | 논술형 | Extended reasoning, often multi-part | No |

### 1.3 Structural Patterns

- **Shared stem**: Passage/condition block followed by 2+ sub-problems. Common in 수능/모의고사.
  - Detection: text before `(1)` with no main number → shared condition block
- **Page-spanning**: Single problem across 2 pages (long stems, large figures)
  - Handle: track `start_page` and `end_page` per problem
- **Figure reference**: `[그림]`, `<그림 1>`, `오른쪽 그림과 같이`
  - Handle: link to `problem_assets` table

## 2. Math Expression OCR Quality

### 2.1 LaTeX Accuracy Targets

| Category | Target Accuracy | Priority | Notes |
|----------|----------------|----------|-------|
| Fractions | 98%+ | Critical | Nested fractions common in Korean math |
| Subscript/Superscript | 97%+ | Critical | `x_{n+1}`, `a^{2n}` |
| Greek letters | 98%+ | High | `\alpha`, `\theta`, `\pi` |
| Roots | 97%+ | High | `\sqrt{x}`, `\sqrt[3]{x}` |
| Absolute value | 96%+ | High | `\left|x\right|` |
| Integrals | 95%+ | High | `\int_{a}^{b}`, `\iint`, `\oint` |
| Matrices | 93%+ | Medium | `\begin{pmatrix}...\end{pmatrix}` |
| Mixed Korean+math | 90%+ | Critical | `함수 $f(x)$의 최솟값` |

### 2.2 sympy Normalization Strategy

Store both raw and normalized LaTeX:
- `stem_latex`: Raw OCR output (preserves original form)
- `stem_latex_normalized`: sympy-canonicalized form

Normalization rules:
1. **Canonical ordering**: alphabetical variable ordering (`ba` → `ab`)
2. **Expression equivalence**: `\frac{1}{2}x` and `\frac{x}{2}` → same form
3. **Simplification**: `\sqrt{4}` → `2`
4. **Preserve pedagogy**: Don't over-simplify (keep `\frac{1}{\sqrt{2}}` vs `\frac{\sqrt{2}}{2}`)

### 2.3 Confidence Thresholds

| Metric | Auto-approve | Review queue | Reject |
|--------|-------------|--------------|--------|
| OCR line confidence (Mathpix) | ≥ 0.95 | 0.70-0.95 | < 0.70 |
| Classification confidence (AI) | ≥ 0.85 | 0.60-0.85 | < 0.60 |
| Textbook match confidence | ≥ 0.85 | 0.60-0.85 | < 0.60 |

## 3. Problem Segmentation Rules

### 3.1 Start Detection
1. Match line against number patterns (priority order from section 1.1)
2. Validate sequential ordering (expect `n+1` after `n`)
3. Check for section markers preceding problem numbers

### 3.2 End Detection
1. Next problem number detected
2. Page boundary (check continuation: if next page starts mid-sentence, merge)
3. Large vertical whitespace gap (>30px at 300dpi)

### 3.3 Grouping Rules
1. Sub-problems `(1)`, `(2)`, ... group under nearest preceding main problem
2. If text before first sub-problem has no main number → shared stem
3. Choices `①-⑤` attach to immediately preceding question text
4. `ㄱ.`, `ㄴ.`, `ㄷ.` labels inside `보기` blocks are NOT separate problems

### 3.4 AI Correction (2nd pass)
- Model: `gpt-4o-mini` with structured output
- Actions: `confirm`, `merge`, `split`, `reject`
- Input: rule-based segments + surrounding context
- Only applied when rule-based confidence is low

## 4. Graph/Figure Taxonomy

### 4.1 Asset Kinds

| Kind | Sub-kinds | Detection Approach |
|------|-----------|-------------------|
| `graph` | `function_plot`, `inequality_region`, `parametric`, `polar` | Axis detection, line_data coordinates |
| `geometry` | `triangle`, `circle`, `polygon`, `3d_solid`, `composite` | Shape primitives from line_data |
| `statistics` | `histogram`, `box_plot`, `scatter_plot`, `pie_chart` | Bar/whisker pattern detection |
| `number_line` | `interval`, `point_set` | Single horizontal axis |
| `tree_diagram` | `probability`, `counting` | Branching structure |
| `venn_diagram` | `two_set`, `three_set` | Overlapping circles |
| `table` | `data_table`, `truth_table`, `frequency_table` | Grid structure |

### 4.2 Quality Criteria for Crops
- Minimum dimension: 50px on shorter side
- Blank ratio: < 85% white pixels
- Edge density: > 3% of pixels are edges (Canny)
- Margin: 24px padding around detected bbox
- Format: WebP (lossy, quality 85)

### 4.3 Detection Pipeline
1. **Primary**: line_data coordinates from Mathpix → candidate bbox extraction
2. **Quality filter**: Apply min-dimension, blank-ratio, edge-density checks
3. **Fallback**: OpenAI Vision (gpt-4o) for pages with figure references but no line_data candidates
4. **Classification**: gpt-4o-mini classifies kind/sub_kind from crop image

## 5. Classification Taxonomy

See `apps/ocr-api/app/schemas/taxonomy.py` for the authoritative code definition.

### 5.1 Grade Levels
`middle_1` through `middle_3`, `high_1` through `high_3`

### 5.2 Subjects (2022 Revised Curriculum)
- 수학(중등), 수학I, 수학II, 확률과 통계, 미적분, 기하

### 5.3 Unit Hierarchy
3-level: subject → unit_major (대단원) → unit_sub (소단원)

### 5.4 Difficulty Scale
5 levels: 1 (기초) → 2 (쉬움) → 3 (보통) → 4 (어려움) → 5 (최상)

### 5.5 Concept Tags
Controlled vocabulary from curriculum keywords. Stored in `tag_dictionary` table, linked to problems via `problem_tags`.

## 6. Embedding Strategy

### 6.1 Model
- `text-embedding-3-small` (1536 dimensions)
- Cost: ~$0.02 per 1M tokens

### 6.2 Input Construction
Concatenate: `plain_text` (Korean text, math stripped) + ` [MATH] ` + `latex_normalized`

Rationale: plain text captures semantic meaning, normalized LaTeX captures mathematical structure.

### 6.3 Index
- pgvector HNSW index with cosine distance
- Parameters: `m=16`, `ef_construction=64`

### 6.4 Use Cases
- Similar problem search (cosine similarity ≥ 0.85)
- Duplicate detection (cosine similarity ≥ 0.95)
- Concept clustering for analytics

## 7. Data Flow Summary

```
PDF Upload (NestJS)
  → S3 + Redis event "ocr:submit"
  → Mathpix OCR (Celery worker)
    → ocr_pages + ocr_lines stored
  → Textbook Identification (Celery worker)
    → textbooks + textbook_versions stored
  → Problem Segmentation (Celery worker)
    → problems + problem_choices stored
  → Graph/Figure Crop (Celery worker, fan-out per problem)
    → problem_assets stored to S3 + DB
  → Classification (Celery worker, fan-out per problem)
    → grade_level, subject, unit, difficulty, tags updated
  → Embedding (Celery worker, fan-out per problem)
    → embedding vector stored
  → Redis event "ocr:completed" (or "review:needed")
```
