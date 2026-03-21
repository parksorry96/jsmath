# HWPX Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable teachers to export exam papers as HWPX files with native HWP equation objects editable in Hancom Hangul.

**Architecture:** Add `HwpxCompilerService` alongside the existing `LatexCompilerService`, sharing the same BullMQ queue with a different job name. A `LaTeXToHwpEquation` converter handles math expression translation. Two entry points: ExamDocument download format extension and a quick export endpoint.

**Tech Stack:** TypeScript, NestJS, jszip, sharp, BullMQ, S3

**Spec:** `docs/superpowers/specs/2026-03-22-hwpx-export-design.md`

**Scope notes:**
- Frontend work (download button HWPX option, endnote settings UI) is deferred to a separate plan.
- S3 lifecycle rule for `exports/hwpx/` prefix (24h TTL) is an infrastructure dependency — configure separately.
- The plan consolidates spec Phases 3 (Endnotes & Templates) into Phase 2, since endnotes are built into the section builder.
- Quick export is **synchronous** (HWPX generation is fast with no external binary). Returns download URL directly, no polling endpoint needed. The spec's async flow description is overridden here.

---

## File Map

### New Files

| File | Responsibility |
|------|---------------|
| `apps/lms-api/src/exam-documents/hwpx/latex-to-hwp-equation.ts` | LaTeX → HWP equation script converter (tokenizer + AST + code generator) |
| `apps/lms-api/src/exam-documents/hwpx/latex-to-hwp-equation.spec.ts` | Converter test suite (50+ expressions) |
| `apps/lms-api/src/exam-documents/hwpx/hwpx-compiler.service.ts` | HWPX file generation (XML assembly + ZIP packaging) |
| `apps/lms-api/src/exam-documents/hwpx/hwpx-compiler.service.spec.ts` | Compiler unit tests |
| `apps/lms-api/src/exam-documents/hwpx/hwpx-section-builder.ts` | Section XML builder (paragraphs, equations, images, endnotes) |
| `apps/lms-api/src/exam-documents/hwpx/hwpx-section-builder.spec.ts` | Section builder tests |
| `apps/lms-api/src/exam-documents/hwpx/source-formatter.ts` | Format examSource/bookSource JSON to display strings |
| `apps/lms-api/src/exam-documents/hwpx/source-formatter.spec.ts` | Source formatter tests |
| `apps/lms-api/src/exam-documents/hwpx/templates/base/` | Common HWPX skeleton files (mimetype, version.xml, META-INF/) |
| `apps/lms-api/src/exam-documents/hwpx/templates/csat-style/header.xml` | CSAT-style page setup (2-column, A4) |
| `apps/lms-api/src/exam-documents/hwpx/templates/school-exam-style/header.xml` | School-exam-style page setup (1-column, A4) |
| `apps/lms-api/src/exam-documents/dto/quick-export.dto.ts` | DTO for quick HWPX export endpoint |

### Modified Files

| File | Changes |
|------|---------|
| `packages/db-schema/prisma/schema.prisma` | Add `hwpxS3Key`, `answerHwpxS3Key`, `hwpxStatus` to ExamDocument |
| `apps/lms-api/src/exam-documents/exam-documents.module.ts` | Register `HwpxCompilerService` as provider |
| `apps/lms-api/src/exam-documents/exam-documents.service.ts` | Add `generateHwpx()`, modify `getDownloadUrl()` for type=hwpx |
| `apps/lms-api/src/exam-documents/exam-documents.controller.ts` | Add quick-export endpoint, extend download type union |
| `apps/lms-api/src/exam-documents/exam-documents.processor.ts` | Handle `generate-hwpx` job type |
| `apps/lms-api/package.json` | Add `jszip` dependency |

---

## Phase 1 — Converter & Utilities

### Task 1: Source Formatter

Small utility needed by endnotes. Placed here to get an easy win first and establish the `hwpx/` directory.

**Files:**
- Create: `apps/lms-api/src/exam-documents/hwpx/source-formatter.ts`
- Create: `apps/lms-api/src/exam-documents/hwpx/source-formatter.spec.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// source-formatter.spec.ts
import { formatSource } from './source-formatter';

describe('formatSource', () => {
  it('formats CSAT exam source', () => {
    expect(formatSource({
      examSource: { year: 2024, month: 6, type: '모의평가', number: 30 },
      bookSource: null,
    })).toBe('2024학년도 6월 모의평가 30번');
  });

  it('formats CSAT source without number', () => {
    expect(formatSource({
      examSource: { year: 2024, month: 11, type: '수능' },
      bookSource: null,
    })).toBe('2024학년도 11월 수능');
  });

  it('formats textbook source', () => {
    expect(formatSource({
      examSource: null,
      bookSource: { title: '수학의 정석', chapter: '3장', section: '미분법', publisher: '성지출판' },
    })).toBe('수학의 정석 > 3장 > 미분법');
  });

  it('formats textbook source with missing fields', () => {
    expect(formatSource({
      examSource: null,
      bookSource: { title: '블랙라벨' },
    })).toBe('블랙라벨');
  });

  it('returns null when no source', () => {
    expect(formatSource({ examSource: null, bookSource: null })).toBeNull();
  });

  it('prefers examSource over bookSource', () => {
    expect(formatSource({
      examSource: { year: 2024, month: 6, type: '모의평가' },
      bookSource: { title: '수학의 정석' },
    })).toBe('2024학년도 6월 모의평가');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/lms-api && npx jest --testPathPattern='source-formatter' --no-coverage`
Expected: FAIL — cannot find module

- [ ] **Step 3: Implement source-formatter**

```typescript
// source-formatter.ts
interface ExamSource {
  year: number;
  month: number;
  type: string;
  number?: number;
}

interface BookSource {
  title: string;
  chapter?: string;
  section?: string;
  publisher?: string;
}

interface SourceInput {
  examSource: ExamSource | unknown;
  bookSource: BookSource | unknown;
}

function isExamSource(v: unknown): v is ExamSource {
  return !!v && typeof v === 'object' && 'year' in v && 'month' in v && 'type' in v;
}

function isBookSource(v: unknown): v is BookSource {
  return !!v && typeof v === 'object' && 'title' in v;
}

export function formatSource(input: SourceInput): string | null {
  if (isExamSource(input.examSource)) {
    const s = input.examSource;
    const base = `${s.year}학년도 ${s.month}월 ${s.type}`;
    return s.number ? `${base} ${s.number}번` : base;
  }

  if (isBookSource(input.bookSource)) {
    const b = input.bookSource;
    return [b.title, b.chapter, b.section].filter(Boolean).join(' > ');
  }

  return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/lms-api && npx jest --testPathPattern='source-formatter' --no-coverage`
Expected: All 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/lms-api/src/exam-documents/hwpx/source-formatter.ts apps/lms-api/src/exam-documents/hwpx/source-formatter.spec.ts
git commit -m "feat(hwpx): add source formatter for endnote display strings"
```

---

### Task 2: LaTeX Tokenizer

The first stage of the LaTeX → HWP equation converter pipeline.

**Files:**
- Create: `apps/lms-api/src/exam-documents/hwpx/latex-to-hwp-equation.ts`
- Create: `apps/lms-api/src/exam-documents/hwpx/latex-to-hwp-equation.spec.ts`

- [ ] **Step 1: Write failing tokenizer tests**

```typescript
// latex-to-hwp-equation.spec.ts
import { tokenize, Token } from './latex-to-hwp-equation';

describe('tokenize', () => {
  it('tokenizes simple text', () => {
    expect(tokenize('abc')).toEqual([
      { type: 'text', value: 'a' },
      { type: 'text', value: 'b' },
      { type: 'text', value: 'c' },
    ]);
  });

  it('tokenizes commands', () => {
    expect(tokenize('\\frac')).toEqual([{ type: 'command', value: 'frac' }]);
  });

  it('tokenizes braces', () => {
    expect(tokenize('{x}')).toEqual([
      { type: 'lbrace' },
      { type: 'text', value: 'x' },
      { type: 'rbrace' },
    ]);
  });

  it('tokenizes superscript and subscript', () => {
    expect(tokenize('x^{2}_{n}')).toEqual([
      { type: 'text', value: 'x' },
      { type: 'caret' },
      { type: 'lbrace' },
      { type: 'text', value: '2' },
      { type: 'rbrace' },
      { type: 'underscore' },
      { type: 'lbrace' },
      { type: 'text', value: 'n' },
      { type: 'rbrace' },
    ]);
  });

  it('tokenizes square brackets', () => {
    expect(tokenize('\\sqrt[3]{x}')).toEqual([
      { type: 'command', value: 'sqrt' },
      { type: 'lbracket' },
      { type: 'text', value: '3' },
      { type: 'rbracket' },
      { type: 'lbrace' },
      { type: 'text', value: 'x' },
      { type: 'rbrace' },
    ]);
  });

  it('tokenizes whitespace', () => {
    expect(tokenize('a + b')).toEqual([
      { type: 'text', value: 'a' },
      { type: 'whitespace' },
      { type: 'text', value: '+' },
      { type: 'whitespace' },
      { type: 'text', value: 'b' },
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/lms-api && npx jest --testPathPattern='latex-to-hwp-equation' --no-coverage`
Expected: FAIL

- [ ] **Step 3: Implement tokenizer**

```typescript
// latex-to-hwp-equation.ts

export type TokenType =
  | 'command' | 'text' | 'lbrace' | 'rbrace'
  | 'lbracket' | 'rbracket' | 'caret' | 'underscore'
  | 'whitespace' | 'ampersand' | 'newline';

export interface Token {
  type: TokenType;
  value?: string;
}

export function tokenize(latex: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < latex.length) {
    const ch = latex[i];

    if (ch === '\\') {
      if (i + 1 < latex.length && latex[i + 1] === '\\') {
        tokens.push({ type: 'newline' });
        i += 2;
      } else {
        i++;
        let name = '';
        while (i < latex.length && /[a-zA-Z]/.test(latex[i])) {
          name += latex[i];
          i++;
        }
        if (name.length > 0) {
          tokens.push({ type: 'command', value: name });
        } else if (i < latex.length) {
          // Escaped special character like \{ or \}
          tokens.push({ type: 'text', value: latex[i] });
          i++;
        }
      }
    } else if (ch === '{') {
      tokens.push({ type: 'lbrace' });
      i++;
    } else if (ch === '}') {
      tokens.push({ type: 'rbrace' });
      i++;
    } else if (ch === '[') {
      tokens.push({ type: 'lbracket' });
      i++;
    } else if (ch === ']') {
      tokens.push({ type: 'rbracket' });
      i++;
    } else if (ch === '^') {
      tokens.push({ type: 'caret' });
      i++;
    } else if (ch === '_') {
      tokens.push({ type: 'underscore' });
      i++;
    } else if (ch === '&') {
      tokens.push({ type: 'ampersand' });
      i++;
    } else if (/\s/.test(ch)) {
      tokens.push({ type: 'whitespace' });
      i++;
      while (i < latex.length && /\s/.test(latex[i])) i++;
    } else {
      tokens.push({ type: 'text', value: ch });
      i++;
    }
  }

  return tokens;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/lms-api && npx jest --testPathPattern='latex-to-hwp-equation' --no-coverage`
Expected: All tokenizer tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/lms-api/src/exam-documents/hwpx/latex-to-hwp-equation.ts apps/lms-api/src/exam-documents/hwpx/latex-to-hwp-equation.spec.ts
git commit -m "feat(hwpx): add LaTeX tokenizer for equation converter"
```

---

### Task 3: AST Parser

Parse token stream into an abstract syntax tree representing math structure.

**Files:**
- Modify: `apps/lms-api/src/exam-documents/hwpx/latex-to-hwp-equation.ts`
- Modify: `apps/lms-api/src/exam-documents/hwpx/latex-to-hwp-equation.spec.ts`

- [ ] **Step 1: Write failing parser tests**

Add to the spec file:

```typescript
import { tokenize, parse, AstNode } from './latex-to-hwp-equation';

describe('parse', () => {
  it('parses simple text', () => {
    const ast = parse(tokenize('x'));
    expect(ast).toEqual({ type: 'group', children: [{ type: 'text', value: 'x' }] });
  });

  it('parses frac', () => {
    const ast = parse(tokenize('\\frac{a}{b}'));
    expect(ast).toEqual({
      type: 'group',
      children: [{
        type: 'frac',
        numerator: { type: 'group', children: [{ type: 'text', value: 'a' }] },
        denominator: { type: 'group', children: [{ type: 'text', value: 'b' }] },
      }],
    });
  });

  it('parses superscript', () => {
    const ast = parse(tokenize('x^{2}'));
    expect(ast.children[0]).toMatchObject({ type: 'superscript' });
  });

  it('parses subscript', () => {
    const ast = parse(tokenize('a_{n}'));
    expect(ast.children[0]).toMatchObject({ type: 'subscript' });
  });

  it('parses sqrt', () => {
    const ast = parse(tokenize('\\sqrt{x}'));
    expect(ast.children[0]).toMatchObject({ type: 'sqrt' });
  });

  it('parses nth root', () => {
    const ast = parse(tokenize('\\sqrt[3]{x}'));
    expect(ast.children[0]).toMatchObject({ type: 'nthroot', index: expect.any(Object) });
  });

  it('parses nested frac in superscript', () => {
    const ast = parse(tokenize('x^{\\frac{1}{2}}'));
    expect(ast.children[0].type).toBe('superscript');
  });

  it('parses sum with limits', () => {
    const ast = parse(tokenize('\\sum_{i=1}^{n}'));
    expect(ast.children[0]).toMatchObject({ type: 'bigop', name: 'sum' });
  });

  it('parses int with limits', () => {
    const ast = parse(tokenize('\\int_{a}^{b}'));
    expect(ast.children[0]).toMatchObject({ type: 'bigop', name: 'int' });
  });

  it('parses lim', () => {
    const ast = parse(tokenize('\\lim_{x \\to 0}'));
    expect(ast.children[0]).toMatchObject({ type: 'lim' });
  });

  it('parses begin/end matrix', () => {
    const ast = parse(tokenize('\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}'));
    expect(ast.children[0]).toMatchObject({ type: 'matrix' });
  });

  it('parses begin/end cases', () => {
    const ast = parse(tokenize('\\begin{cases}x&x>0\\\\0&x\\leq 0\\end{cases}'));
    expect(ast.children[0]).toMatchObject({ type: 'cases' });
  });

  it('parses decoration commands', () => {
    const ast = parse(tokenize('\\vec{x}'));
    expect(ast.children[0]).toMatchObject({ type: 'decoration', name: 'vec' });
  });

  it('parses left/right delimiters', () => {
    const ast = parse(tokenize('\\left(x\\right)'));
    expect(ast.children[0]).toMatchObject({ type: 'delimited' });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/lms-api && npx jest --testPathPattern='latex-to-hwp-equation' --no-coverage`
Expected: FAIL — `parse` is not exported

- [ ] **Step 3: Implement AST parser**

Add to `latex-to-hwp-equation.ts`. Key AST node types:

```typescript
export type AstNode =
  | { type: 'text'; value: string }
  | { type: 'whitespace' }
  | { type: 'group'; children: AstNode[] }
  | { type: 'frac'; numerator: AstNode; denominator: AstNode }
  | { type: 'sqrt'; body: AstNode }
  | { type: 'nthroot'; index: AstNode; body: AstNode }
  | { type: 'superscript'; base: AstNode; exponent: AstNode }
  | { type: 'subscript'; base: AstNode; sub: AstNode }
  | { type: 'subsup'; base: AstNode; sub: AstNode; sup: AstNode }
  | { type: 'bigop'; name: string; lower?: AstNode; upper?: AstNode }
  | { type: 'lim'; lower?: AstNode }
  | { type: 'matrix'; env: string; rows: AstNode[][] }
  | { type: 'cases'; rows: AstNode[][] }
  | { type: 'decoration'; name: string; body: AstNode }
  | { type: 'delimited'; open: string; close: string; body: AstNode }
  | { type: 'command'; name: string }; // for Greek letters, operators, symbols

export function parse(tokens: Token[]): AstNode & { type: 'group' } {
  // Recursive descent parser implementation
  // ...
}
```

Implementation: a recursive descent parser that handles:
- `\frac{num}{den}` → frac node
- `\sqrt{body}` / `\sqrt[n]{body}` → sqrt / nthroot
- `base^{exp}` / `base_{sub}` / `base_{sub}^{sup}` → superscript / subscript / subsup
- `\sum`, `\int`, `\prod` + optional `_{lower}^{upper}` → bigop
- `\lim_{lower}` → lim
- `\begin{env}...\end{env}` → matrix / cases
- `\vec`, `\bar`, `\hat`, `\tilde` → decoration
- `\left( ... \right)` → delimited
- `\alpha`, `\beta`, etc. → command (passthrough)
- `\leq`, `\geq`, `\neq`, `\times`, `\cdot`, `\infty`, `\to` → command

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/lms-api && npx jest --testPathPattern='latex-to-hwp-equation' --no-coverage`
Expected: All parser tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/lms-api/src/exam-documents/hwpx/latex-to-hwp-equation.ts apps/lms-api/src/exam-documents/hwpx/latex-to-hwp-equation.spec.ts
git commit -m "feat(hwpx): add LaTeX AST parser for equation converter"
```

---

### Task 4: HWP Code Generator

Convert AST to HWP equation script string.

**Files:**
- Modify: `apps/lms-api/src/exam-documents/hwpx/latex-to-hwp-equation.ts`
- Modify: `apps/lms-api/src/exam-documents/hwpx/latex-to-hwp-equation.spec.ts`

- [ ] **Step 1: Write failing code generator tests**

These are the end-to-end conversion tests. Add to spec file:

```typescript
import { latexToHwpEquation } from './latex-to-hwp-equation';

describe('latexToHwpEquation', () => {
  // Fractions
  it('converts simple fraction', () => {
    expect(latexToHwpEquation('\\frac{a}{b}')).toBe('a OVER b');
  });

  it('converts nested fraction', () => {
    expect(latexToHwpEquation('\\frac{\\frac{1}{2}}{3}')).toBe('{1 OVER 2} OVER 3');
  });

  // Roots
  it('converts sqrt', () => {
    expect(latexToHwpEquation('\\sqrt{x}')).toBe('SQRT{x}');
  });

  it('converts nth root', () => {
    expect(latexToHwpEquation('\\sqrt[3]{x}')).toBe('ROOT 3 OF{x}');
  });

  // Super/subscripts (identical syntax)
  it('converts superscript', () => {
    expect(latexToHwpEquation('x^{2}')).toBe('x^{2}');
  });

  it('converts subscript', () => {
    expect(latexToHwpEquation('a_{n}')).toBe('a_{n}');
  });

  it('converts combined sub+sup', () => {
    expect(latexToHwpEquation('a_{n}^{2}')).toBe('a_{n}^{2}');
  });

  // Big operators
  it('converts sum', () => {
    expect(latexToHwpEquation('\\sum_{i=1}^{n}')).toBe('SUM _{i=1}^{n}');
  });

  it('converts integral', () => {
    expect(latexToHwpEquation('\\int_{a}^{b}')).toBe('INT _{a}^{b}');
  });

  it('converts product', () => {
    expect(latexToHwpEquation('\\prod_{k=1}^{n}')).toBe('PROD _{k=1}^{n}');
  });

  // Limit
  it('converts lim', () => {
    expect(latexToHwpEquation('\\lim_{x \\to 0}')).toBe('lim _{x -> 0}');
  });

  // Matrix
  it('converts pmatrix', () => {
    expect(latexToHwpEquation('\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}'))
      .toBe('PMATRIX{a & b # c & d}');
  });

  // Cases
  it('converts cases', () => {
    expect(latexToHwpEquation('\\begin{cases}x&x>0\\\\0&x\\leq 0\\end{cases}'))
      .toBe('CASES{x & x>0 # 0 & x<=0}');
  });

  // Decorations
  it('converts vec', () => {
    expect(latexToHwpEquation('\\vec{x}')).toBe('VEC x');
  });

  it('converts bar', () => {
    expect(latexToHwpEquation('\\bar{x}')).toBe('BAR x');
  });

  it('converts hat', () => {
    expect(latexToHwpEquation('\\hat{x}')).toBe('HAT x');
  });

  // Symbols
  it('converts comparison operators', () => {
    expect(latexToHwpEquation('\\leq')).toBe('<=');
    expect(latexToHwpEquation('\\geq')).toBe('>=');
    expect(latexToHwpEquation('\\neq')).toBe('<>');
  });

  it('converts operators', () => {
    expect(latexToHwpEquation('\\times')).toBe('TIMES');
    expect(latexToHwpEquation('\\cdot')).toBe('CDOT');
  });

  it('converts infinity', () => {
    expect(latexToHwpEquation('\\infty')).toBe('inf');
  });

  it('converts Greek letters', () => {
    expect(latexToHwpEquation('\\alpha')).toBe('alpha');
    expect(latexToHwpEquation('\\beta')).toBe('beta');
    expect(latexToHwpEquation('\\theta')).toBe('theta');
  });

  it('converts to (arrow)', () => {
    expect(latexToHwpEquation('\\to')).toBe('->');
    expect(latexToHwpEquation('\\rightarrow')).toBe('->');
  });

  // Delimiters
  it('converts left/right parens', () => {
    expect(latexToHwpEquation('\\left(x\\right)')).toBe('LEFT( x RIGHT)');
  });

  it('converts left/right brackets', () => {
    expect(latexToHwpEquation('\\left[x\\right]')).toBe('LEFT[ x RIGHT]');
  });

  it('converts left/right abs', () => {
    expect(latexToHwpEquation('\\left|x\\right|')).toBe('LEFT| x RIGHT|');
  });

  // Trig / log
  it('converts trig functions', () => {
    expect(latexToHwpEquation('\\sin')).toBe('sin');
    expect(latexToHwpEquation('\\cos')).toBe('cos');
    expect(latexToHwpEquation('\\tan')).toBe('tan');
  });

  it('converts log', () => {
    expect(latexToHwpEquation('\\log')).toBe('log');
    expect(latexToHwpEquation('\\ln')).toBe('ln');
  });

  // Complex expressions (high school math)
  it('converts quadratic formula', () => {
    const latex = '\\frac{-b \\pm \\sqrt{b^{2}-4ac}}{2a}';
    const expected = '{-b +- SQRT{b^{2}-4ac}} OVER {2a}';
    expect(latexToHwpEquation(latex)).toBe(expected);
  });

  it('converts definite integral', () => {
    const latex = '\\int_{0}^{1} x^{2} dx';
    expect(latexToHwpEquation(latex)).toBe('INT _{0}^{1} x^{2} dx');
  });

  it('converts summation expression', () => {
    const latex = '\\sum_{k=1}^{n} \\frac{1}{k}';
    expect(latexToHwpEquation(latex)).toBe('SUM _{k=1}^{n} {1 OVER k}');
  });

  // Fallback
  it('returns original on parse error', () => {
    const broken = '\\unknowncommand{{{';
    const result = latexToHwpEquation(broken);
    expect(typeof result).toBe('string');
    // Should not throw — fallback to original or best-effort
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/lms-api && npx jest --testPathPattern='latex-to-hwp-equation' --no-coverage`
Expected: FAIL — `latexToHwpEquation` not exported

- [ ] **Step 3: Implement HWP code generator**

Add the `generate()` function and `latexToHwpEquation()` public API to `latex-to-hwp-equation.ts`:

```typescript
const COMMAND_MAP: Record<string, string> = {
  // Comparison
  leq: '<=', geq: '>=', neq: '<>', le: '<=', ge: '>=',
  // Operators
  times: 'TIMES', cdot: 'CDOT', div: 'DIV', pm: '+-',
  // Symbols
  infty: 'inf', to: '->', rightarrow: '->', leftarrow: '<-',
  // Greek
  alpha: 'alpha', beta: 'beta', gamma: 'gamma', delta: 'delta',
  epsilon: 'epsilon', zeta: 'zeta', eta: 'eta', theta: 'theta',
  iota: 'iota', kappa: 'kappa', lambda: 'lambda', mu: 'mu',
  nu: 'nu', xi: 'xi', pi: 'pi', rho: 'rho',
  sigma: 'sigma', tau: 'tau', upsilon: 'upsilon', phi: 'phi',
  chi: 'chi', psi: 'psi', omega: 'omega',
  // Uppercase Greek
  Gamma: 'GAMMA', Delta: 'DELTA', Theta: 'THETA', Lambda: 'LAMBDA',
  Xi: 'XI', Pi: 'PI', Sigma: 'SIGMA', Phi: 'PHI', Psi: 'PSI', Omega: 'OMEGA',
  // Trig / log
  sin: 'sin', cos: 'cos', tan: 'tan', cot: 'cot',
  sec: 'sec', csc: 'csc', log: 'log', ln: 'ln', exp: 'exp',
};

function generate(node: AstNode): string {
  switch (node.type) {
    case 'text': return node.value;
    case 'whitespace': return ' ';
    case 'group': return node.children.map(generate).join('');
    case 'frac': return `${wrap(node.numerator)} OVER ${wrap(node.denominator)}`;
    case 'sqrt': return `SQRT{${generate(node.body)}}`;
    case 'nthroot': return `ROOT ${generate(node.index)} OF{${generate(node.body)}}`;
    case 'superscript': return `${generate(node.base)}^{${generate(node.exponent)}}`;
    case 'subscript': return `${generate(node.base)}_{${generate(node.sub)}}`;
    case 'subsup': return `${generate(node.base)}_{${generate(node.sub)}}^{${generate(node.sup)}}`;
    case 'bigop': {
      const name = node.name.toUpperCase();
      let result = name;
      if (node.lower) result += ` _{${generate(node.lower)}}`;
      if (node.upper) result += `^{${generate(node.upper)}}`;
      return result;
    }
    case 'lim': {
      let result = 'lim';
      if (node.lower) result += ` _{${generate(node.lower)}}`;
      return result;
    }
    case 'matrix': {
      const envMap: Record<string, string> = {
        pmatrix: 'PMATRIX', bmatrix: 'BMATRIX', vmatrix: 'VMATRIX', matrix: 'MATRIX',
      };
      const name = envMap[node.env] ?? 'MATRIX';
      const rows = node.rows.map(row => row.map(generate).join(' & ')).join(' # ');
      return `${name}{${rows}}`;
    }
    case 'cases': {
      const rows = node.rows.map(row => row.map(generate).join(' & ')).join(' # ');
      return `CASES{${rows}}`;
    }
    case 'decoration': return `${node.name.toUpperCase()} ${generate(node.body)}`;
    case 'delimited': return `LEFT${node.open} ${generate(node.body)} RIGHT${node.close}`;
    case 'command': return COMMAND_MAP[node.name] ?? node.name;
    default: return '';
  }
}

// Wrap multi-node groups in braces for HWP script
function wrap(node: AstNode): string {
  const text = generate(node);
  if (node.type === 'group' && node.children.length > 1) return `{${text}}`;
  return text;
}

export function latexToHwpEquation(latex: string): string {
  try {
    const tokens = tokenize(latex);
    const ast = parse(tokens);
    return generate(ast);
  } catch {
    // Fallback: return original LaTeX on parse failure
    return latex;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/lms-api && npx jest --testPathPattern='latex-to-hwp-equation' --no-coverage`
Expected: All tests PASS (tokenizer + parser + generator)

- [ ] **Step 5: Commit**

```bash
git add apps/lms-api/src/exam-documents/hwpx/latex-to-hwp-equation.ts apps/lms-api/src/exam-documents/hwpx/latex-to-hwp-equation.spec.ts
git commit -m "feat(hwpx): add HWP equation code generator completing LaTeX->HWP pipeline"
```

---

## Phase 2 — HWPX Generator

> **CRITICAL GATE:** Before starting Phase 2, create sample HWPX files in Hancom Hangul containing:
> 1. A simple equation (e.g., quadratic formula)
> 2. A paragraph with mixed text and inline equation
> 3. An endnote
>
> Unzip each `.hwpx` file and study the XML structure. The exact element names for equations, endnotes, and inline content will inform the implementation below. Update the template files accordingly.
>
> **If the equation XML structure is undocumented or requires binary data instead of script text, STOP and reassess the approach.**

### Task 5: Install jszip Dependency

**Files:**
- Modify: `apps/lms-api/package.json`

- [ ] **Step 1: Install jszip**

Run: `cd /Users/parkjisong/jsmath && pnpm --filter lms-api add jszip`

- [ ] **Step 2: Verify installation**

Run: `cd /Users/parkjisong/jsmath && node -e "require('jszip'); console.log('ok')"`
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add apps/lms-api/package.json pnpm-lock.yaml
git commit -m "chore(lms-api): add jszip dependency for HWPX generation"
```

---

### Task 6: HWPX Base Templates

Create the XML skeleton files based on reverse-engineered sample HWPX files.

**Files:**
- Create: `apps/lms-api/src/exam-documents/hwpx/templates/base/mimetype`
- Create: `apps/lms-api/src/exam-documents/hwpx/templates/base/version.xml`
- Create: `apps/lms-api/src/exam-documents/hwpx/templates/base/settings.xml`
- Create: `apps/lms-api/src/exam-documents/hwpx/templates/base/META-INF/manifest.xml`
- Create: `apps/lms-api/src/exam-documents/hwpx/templates/base/META-INF/container.xml`
- Create: `apps/lms-api/src/exam-documents/hwpx/templates/base/Contents/content.hpf`
- Create: `apps/lms-api/src/exam-documents/hwpx/templates/csat-style/header.xml`
- Create: `apps/lms-api/src/exam-documents/hwpx/templates/school-exam-style/header.xml`

- [ ] **Step 1: Create base templates from reverse-engineered samples**

The exact XML content depends on the Hangul sample file analysis (see Phase 2 gate above). The templates should contain:
- `mimetype` — plain text `application/hwp+zip`
- `version.xml` — OWPML version declaration
- `settings.xml` — document settings (page numbering, endnote config)
- `META-INF/manifest.xml` — file manifest listing all entries
- `META-INF/container.xml` — container declaration
- `Contents/content.hpf` — document metadata, font declarations, style references

- [ ] **Step 2: Create CSAT-style header.xml**

2-column layout, A4, narrow margins (matching CSAT format), 바탕체/돋움체 fonts.

- [ ] **Step 3: Create school-exam-style header.xml**

1-column layout, A4, standard margins, school header area at top.

- [ ] **Step 4: Verify templates are valid XML**

Run: `find apps/lms-api/src/exam-documents/hwpx/templates -name "*.xml" -exec xmllint --noout {} \;`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add apps/lms-api/src/exam-documents/hwpx/templates/
git commit -m "feat(hwpx): add base HWPX XML templates from reverse-engineered samples"
```

---

### Task 7: HWPX Section Builder

Builds the `section0.xml` content: paragraphs, equations, images, choices, endnotes.

**Files:**
- Create: `apps/lms-api/src/exam-documents/hwpx/hwpx-section-builder.ts`
- Create: `apps/lms-api/src/exam-documents/hwpx/hwpx-section-builder.spec.ts`

- [ ] **Step 1: Write failing tests for section builder**

```typescript
// hwpx-section-builder.spec.ts
import { HwpxSectionBuilder } from './hwpx-section-builder';

describe('HwpxSectionBuilder', () => {
  let builder: HwpxSectionBuilder;

  beforeEach(() => {
    builder = new HwpxSectionBuilder();
  });

  it('creates a paragraph with text', () => {
    builder.addParagraph('Hello');
    const xml = builder.toXml();
    expect(xml).toContain('<hp:t>Hello</hp:t>');
  });

  it('creates a paragraph with bold text', () => {
    builder.addParagraph('1.', { bold: true });
    const xml = builder.toXml();
    expect(xml).toContain('1.');
    // Bold formatting check depends on reverse-engineered charPr structure
  });

  it('inserts an equation object', () => {
    builder.addEquation('x^{2} + 1');
    const xml = builder.toXml();
    // Equation element structure depends on Phase 2 reverse engineering
    expect(xml).toContain('x^{2} + 1');
  });

  it('inserts mixed text and equations', () => {
    builder.addMixedContent('함수 $f(x) = x^{2}$의 값');
    const xml = builder.toXml();
    expect(xml).toContain('함수');
    expect(xml).toContain('f(x) = x^{2}');  // converted to HWP script
    expect(xml).toContain('의 값');
  });

  it('adds choices in horizontal layout', () => {
    builder.addChoices([
      { label: '①', contentLatex: '1', contentText: '1', position: 1 },
      { label: '②', contentLatex: '2', contentText: '2', position: 2 },
    ]);
    const xml = builder.toXml();
    expect(xml).toContain('①');
    expect(xml).toContain('②');
  });

  it('adds an endnote reference and content', () => {
    builder.addEndnoteRef(1);
    builder.addEndnote(1, { answer: '③', solution: null, source: null, difficulty: null, points: null });
    const xml = builder.toXml();
    // Endnote structure depends on Phase 2 reverse engineering
    expect(xml).toContain('③');
  });

  it('inserts an image reference', () => {
    builder.addImage('image001.png', 400, 300);
    const xml = builder.toXml();
    expect(xml).toContain('image001.png');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/lms-api && npx jest --testPathPattern='hwpx-section-builder' --no-coverage`
Expected: FAIL

- [ ] **Step 3: Implement section builder**

The `HwpxSectionBuilder` class accumulates XML elements and serializes to a `section0.xml` string. Key methods:
- `addParagraph(text, opts?)` — create `<hp:p>` with `<hp:run>` / `<hp:t>`
- `addEquation(hwpScript)` — create equation control element (structure from reverse engineering)
- `addMixedContent(stemLatex)` — split on `$...$` delimiters, text segments as `<hp:t>`, math segments converted via `latexToHwpEquation()` and inserted as equation objects
- `addChoices(choices)` — render as tab-separated or table-based layout
- `addEndnoteRef(number)` — insert endnote reference marker
- `addEndnote(number, content)` — define endnote body
- `addImage(filename, width, height)` — insert image reference to BinData/
- `toXml()` — serialize accumulated elements to section XML string

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/lms-api && npx jest --testPathPattern='hwpx-section-builder' --no-coverage`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/lms-api/src/exam-documents/hwpx/hwpx-section-builder.ts apps/lms-api/src/exam-documents/hwpx/hwpx-section-builder.spec.ts
git commit -m "feat(hwpx): add section XML builder for paragraphs, equations, choices, endnotes"
```

---

### Task 8: HWPX Compiler Service

Assembles all parts into a complete `.hwpx` ZIP file.

**Files:**
- Create: `apps/lms-api/src/exam-documents/hwpx/hwpx-compiler.service.ts`
- Create: `apps/lms-api/src/exam-documents/hwpx/hwpx-compiler.service.spec.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// hwpx-compiler.service.spec.ts
import { HwpxCompilerService, HwpxCompileOptions } from './hwpx-compiler.service';
import * as JSZip from 'jszip';

describe('HwpxCompilerService', () => {
  let service: HwpxCompilerService;

  beforeEach(() => {
    service = new HwpxCompilerService();
  });

  it('generates a valid ZIP buffer', async () => {
    const result = await service.compile({
      template: 'school-exam',
      problems: [{
        stemLatex: 'x + 1 = 2',
        stemText: 'x + 1 = 2',
        problemType: 'short_answer',
        choices: [],
        assets: [],
        answerText: '1',
        answerLatex: '1',
        solutionLatex: null,
        solutionText: null,
        examSource: null,
        bookSource: null,
        difficulty: null,
        pointValue: null,
        sharedStemLatex: null,
        parentId: null,
      }],
      endnoteOptions: { answer: true, solution: false, source: false, difficulty: false, points: false },
    });

    expect(Buffer.isBuffer(result)).toBe(true);

    // Verify ZIP structure
    const zip = await JSZip.loadAsync(result);
    expect(zip.file('mimetype')).not.toBeNull();
    expect(zip.file('Contents/section0.xml')).not.toBeNull();
    expect(zip.file('Contents/header.xml')).not.toBeNull();
  });

  it('embeds images in BinData/', async () => {
    const result = await service.compile({
      template: 'school-exam',
      problems: [{
        stemLatex: 'Look at the graph:',
        stemText: 'Look at the graph:',
        problemType: 'multiple_choice',
        choices: [],
        assets: [{ filename: 'graph.png', data: Buffer.from('fake-png-data'), width: 400, height: 300 }],
        answerText: null,
        answerLatex: null,
        solutionLatex: null,
        solutionText: null,
        examSource: null,
        bookSource: null,
        difficulty: null,
        pointValue: null,
        sharedStemLatex: null,
        parentId: null,
      }],
      endnoteOptions: { answer: false, solution: false, source: false, difficulty: false, points: false },
    });

    const zip = await JSZip.loadAsync(result);
    expect(zip.file('BinData/image001.png')).not.toBeNull();
  });

  it('renders shared stem only once for sub-problem group', async () => {
    const sharedProblem = (overrides: Partial<HwpxProblemInput>) => ({
      stemLatex: 'sub-problem stem', stemText: 'sub', problemType: 'short_answer',
      choices: [], assets: [], answerText: '1', answerLatex: '1',
      solutionLatex: null, solutionText: null, examSource: null, bookSource: null,
      difficulty: null, pointValue: null, sharedStemLatex: 'Shared stem for Q5-6',
      parentId: 'parent-1', ...overrides,
    });

    const result = await service.compile({
      template: 'school-exam',
      problems: [sharedProblem({}), sharedProblem({ stemLatex: 'second sub' })],
      endnoteOptions: { answer: false, solution: false, source: false, difficulty: false, points: false },
    });

    const zip = await JSZip.loadAsync(result);
    const section = await zip.file('Contents/section0.xml')!.async('string');
    // Shared stem should appear exactly once
    const matches = section.match(/Shared stem for Q5-6/g);
    expect(matches).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/lms-api && npx jest --testPathPattern='hwpx-compiler.service' --no-coverage`
Expected: FAIL

- [ ] **Step 3: Implement HwpxCompilerService**

```typescript
// hwpx-compiler.service.ts
import { Injectable } from '@nestjs/common';
import * as JSZip from 'jszip';
import * as fs from 'fs/promises';
import * as path from 'path';
import { HwpxSectionBuilder } from './hwpx-section-builder';
import { formatSource } from './source-formatter';

export interface EndnoteOptions {
  answer: boolean;
  solution: boolean;
  source: boolean;
  difficulty: boolean;
  points: boolean;
}

export interface HwpxProblemInput {
  stemLatex: string | null;
  stemText: string | null;
  problemType: string;
  choices: { label: string; contentLatex: string; contentText: string; position: number }[];
  assets: { filename: string; data: Buffer; width: number; height: number }[];
  answerText: string | null;
  answerLatex: string | null;
  solutionLatex: string | null;
  solutionText: string | null;
  examSource: unknown;
  bookSource: unknown;
  difficulty: number | null;
  pointValue: number | null;
  sharedStemLatex: string | null;
  parentId: string | null;
}

export interface HwpxCompileOptions {
  template: 'csat' | 'school-exam';
  problems: HwpxProblemInput[];
  endnoteOptions: EndnoteOptions;
  headerConfig?: { title?: string; schoolName?: string; subject?: string; date?: string; duration?: string };
}

@Injectable()
export class HwpxCompilerService {
  private readonly templateDir = path.join(__dirname, 'templates');

  async compile(options: HwpxCompileOptions): Promise<Buffer> {
    const zip = new JSZip();

    // 1. Add base template files
    const baseDir = path.join(this.templateDir, 'base');
    await this.addTemplateFiles(zip, baseDir);

    // 2. Add style-specific header.xml
    const styleDir = path.join(this.templateDir, `${options.template === 'csat' ? 'csat' : 'school-exam'}-style`);
    const headerXml = await fs.readFile(path.join(styleDir, 'header.xml'), 'utf-8');
    zip.file('Contents/header.xml', headerXml);

    // 3. Build section XML
    const builder = new HwpxSectionBuilder();
    let imageIndex = 0;

    for (const [i, problem] of options.problems.entries()) {
      // Shared stem
      if (problem.sharedStemLatex && this.isFirstInGroup(problem, options.problems, i)) {
        builder.addMixedContent(problem.sharedStemLatex);
      }

      // Problem number
      builder.addParagraph(`${i + 1}.`, { bold: true });

      // Stem
      builder.addMixedContent(problem.stemLatex ?? problem.stemText ?? '');

      // Images
      for (const asset of problem.assets) {
        imageIndex++;
        const filename = `image${String(imageIndex).padStart(3, '0')}.png`;
        zip.file(`BinData/${filename}`, asset.data);
        builder.addImage(filename, asset.width, asset.height);
      }

      // Choices
      if (problem.choices.length > 0) {
        builder.addChoices(problem.choices);
      }

      // Endnote
      const hasEndnote = this.hasEndnoteContent(problem, options.endnoteOptions);
      if (hasEndnote) {
        builder.addEndnoteRef(i + 1);
        builder.addEndnote(i + 1, {
          answer: options.endnoteOptions.answer ? problem.answerText : null,
          solution: options.endnoteOptions.solution ? (problem.solutionLatex ?? problem.solutionText) : null,
          source: options.endnoteOptions.source ? formatSource(problem) : null,
          difficulty: options.endnoteOptions.difficulty ? problem.difficulty : null,
          points: options.endnoteOptions.points ? problem.pointValue : null,
        });
      }
    }

    zip.file('Contents/section0.xml', builder.toXml());

    // 4. Generate ZIP buffer
    return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }) as Promise<Buffer>;
  }

  private isFirstInGroup(problem: HwpxProblemInput, problems: HwpxProblemInput[], index: number): boolean {
    if (!problem.parentId) return false;
    if (index === 0) return true;
    return problems[index - 1].parentId !== problem.parentId;
  }

  private hasEndnoteContent(problem: HwpxProblemInput, opts: EndnoteOptions): boolean {
    return (opts.answer && !!problem.answerText)
      || (opts.solution && !!(problem.solutionLatex ?? problem.solutionText))
      || (opts.source && !!formatSource(problem))
      || (opts.difficulty && problem.difficulty != null)
      || (opts.points && problem.pointValue != null);
  }

  private async addTemplateFiles(zip: JSZip, dir: string, prefix = ''): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const zipPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await this.addTemplateFiles(zip, fullPath, zipPath);
      } else {
        const content = await fs.readFile(fullPath);
        zip.file(zipPath, content);
      }
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/lms-api && npx jest --testPathPattern='hwpx-compiler.service' --no-coverage`
Expected: All tests PASS

- [ ] **Step 5: Manual verification — open in Hangul**

Generate a test HWPX file and open it in Hancom Hangul. Verify:
1. Document opens without errors
2. Text is displayed correctly
3. **Equations are editable in the equation editor** (CRITICAL)
4. Images display correctly

- [ ] **Step 6: Commit**

```bash
git add apps/lms-api/src/exam-documents/hwpx/hwpx-compiler.service.ts apps/lms-api/src/exam-documents/hwpx/hwpx-compiler.service.spec.ts
git commit -m "feat(hwpx): add HWPX compiler service assembling ZIP from templates and content"
```

---

## Phase 3 — DB Migration & API Integration

### Task 9: Prisma Schema Migration

**Files:**
- Modify: `packages/db-schema/prisma/schema.prisma`
- Create: `packages/db-schema/prisma/migrations/<timestamp>_add_hwpx_columns/migration.sql`

- [ ] **Step 1: Add columns to ExamDocument model**

In `packages/db-schema/prisma/schema.prisma`, add after `answerPdfS3Key`:

```prisma
hwpxS3Key       String?              @map("hwpx_s3_key")
answerHwpxS3Key String?              @map("answer_hwpx_s3_key")
hwpxStatus      ExamDocumentStatus?  @map("hwpx_status")
```

- [ ] **Step 2: Generate and run migration**

Run: `cd /Users/parkjisong/jsmath && pnpm --filter @jsmath/db-schema db:migrate -- --name add_hwpx_columns`
Expected: Migration created and applied successfully

- [ ] **Step 3: Regenerate Prisma client**

Run: `cd /Users/parkjisong/jsmath && pnpm --filter @jsmath/db-schema db:generate`
Expected: Prisma Client generated

- [ ] **Step 4: Commit**

```bash
git add packages/db-schema/prisma/schema.prisma packages/db-schema/prisma/migrations/
git commit -m "feat(db): add hwpxS3Key, answerHwpxS3Key, hwpxStatus to ExamDocument"
```

---

### Task 10: Quick Export DTO

**Files:**
- Create: `apps/lms-api/src/exam-documents/dto/quick-export.dto.ts`

- [ ] **Step 1: Create DTO**

```typescript
// quick-export.dto.ts
import {
  IsArray, IsString, IsIn, IsOptional, IsBoolean,
  ArrayMinSize, ArrayMaxSize, MaxLength, ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class HeaderConfigDto {
  @IsOptional() @IsString() schoolName?: string;
  @IsOptional() @IsString() subject?: string;
  @IsOptional() @IsString() date?: string;
  @IsOptional() @IsString() duration?: string;
}

class EndnoteOptionsDto {
  @IsOptional() @IsBoolean() answer?: boolean;
  @IsOptional() @IsBoolean() solution?: boolean;
  @IsOptional() @IsBoolean() source?: boolean;
  @IsOptional() @IsBoolean() difficulty?: boolean;
  @IsOptional() @IsBoolean() points?: boolean;
}

export class QuickExportDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsString({ each: true })
  problemIds: string[];

  @IsIn(['csat', 'school-exam'])
  template: 'csat' | 'school-exam';

  @IsOptional() @IsString() @MaxLength(200)
  title?: string;

  @IsOptional() @ValidateNested() @Type(() => HeaderConfigDto)
  headerConfig?: HeaderConfigDto;

  @IsOptional() @ValidateNested() @Type(() => EndnoteOptionsDto)
  endnoteOptions?: EndnoteOptionsDto;
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/lms-api/src/exam-documents/dto/quick-export.dto.ts
git commit -m "feat(hwpx): add QuickExportDto with validation"
```

---

### Task 11: Integrate into ExamDocumentsService

**Files:**
- Modify: `apps/lms-api/src/exam-documents/exam-documents.service.ts`
- Modify: `apps/lms-api/src/exam-documents/exam-documents.module.ts`
- Modify: `apps/lms-api/src/exam-documents/exam-documents.processor.ts`

- [ ] **Step 1: Register HwpxCompilerService in module**

In `exam-documents.module.ts`, add `HwpxCompilerService` to providers:

```typescript
import { HwpxCompilerService } from './hwpx/hwpx-compiler.service';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'exam-document-pdf' }),
    ProblemsModule,
  ],
  controllers: [ExamDocumentsController],
  providers: [
    ExamDocumentsService,
    LatexCompilerService,
    HwpxCompilerService,
    ExamDocumentsPdfProcessor,
  ],
})
export class ExamDocumentsModule {}
```

- [ ] **Step 2: Add constants and generateHwpx() to ExamDocumentsService**

Add to `exam-documents.service.ts`:

```typescript
import { HwpxCompilerService, EndnoteOptions } from './hwpx/hwpx-compiler.service';
import * as sharp from 'sharp';

const DEFAULT_ENDNOTE_OPTIONS: EndnoteOptions = {
  answer: true, solution: true, source: false, difficulty: false, points: false,
};

const S3_DOWNLOAD_CONCURRENCY = 5;
```

Add method:

```typescript
async generateHwpx(documentId: string, endnoteOptions?: EndnoteOptions) {
  const opts = endnoteOptions ?? DEFAULT_ENDNOTE_OPTIONS;
  const doc = await this.prisma.examDocument.findUnique({
    where: { id: documentId },
    include: {
      creator: { select: { role: true } },
      problems: { orderBy: { orderIndex: 'asc' } },
    },
  });
  if (!doc) throw new NotFoundException('Document not found');

  // Fetch problems WITH assets (unlike generatePdf which skips assets)
  const problemIds = doc.problems.map((p) => p.problemId);
  const problems = await this.prisma.problem.findMany({
    where: { id: { in: problemIds }, ...getAccessibleProblemWhere(doc.creatorId, doc.creator.role) },
    select: {
      id: true, stemLatex: true, stemText: true, problemType: true,
      answerText: true, answerLatex: true, solutionLatex: true, solutionText: true,
      examSource: true, bookSource: true, difficulty: true, pointValue: true,
      sharedStemLatex: true, parentId: true,
      choices: { select: { label: true, contentLatex: true, contentText: true, position: true }, orderBy: { position: 'asc' } },
      assets: { select: { id: true, s3Key: true, format: true, widthPx: true, heightPx: true } },
    },
  });

  const problemMap = new Map(problems.map((p) => [p.id, p]));
  const orderedProblems = doc.problems.map((dp) => problemMap.get(dp.problemId)).filter(Boolean);

  // Download and convert assets (WebP → PNG) with concurrency limit
  for (const problem of orderedProblems) {
    const assetBuffers = [];
    for (let i = 0; i < problem.assets.length; i += S3_DOWNLOAD_CONCURRENCY) {
      const batch = problem.assets.slice(i, i + S3_DOWNLOAD_CONCURRENCY);
      const results = await Promise.all(batch.map(async (asset) => {
        const response = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: asset.s3Key }));
        let data = Buffer.from(await response.Body.transformToByteArray());
        if (asset.format === 'webp') {
          data = await sharp(data).png().toBuffer();
        }
        return { filename: `${asset.id}.png`, data, width: asset.widthPx ?? 400, height: asset.heightPx ?? 300 };
      }));
      assetBuffers.push(...results);
    }
    (problem as any)._resolvedAssets = assetBuffers;
  }

  // Compile HWPX
  const hwpxBuffer = await this.hwpxCompiler.compile({
    template: doc.type === 'exam' ? 'csat' : 'school-exam',
    problems: orderedProblems.map((p) => ({
      ...p,
      assets: (p as any)._resolvedAssets ?? [],
    })),
    endnoteOptions: opts,
  });

  // Upload to S3
  const s3Key = `exam-documents/${doc.id}/document.hwpx`;
  await this.s3.send(new PutObjectCommand({
    Bucket: this.bucket, Key: s3Key, Body: hwpxBuffer,
    ContentType: 'application/hwp+zip',
  }));

  await this.prisma.examDocument.update({
    where: { id: doc.id },
    data: { hwpxS3Key: s3Key, hwpxStatus: 'completed' },
  });
}
```

- [ ] **Step 3: Extend getDownloadUrl() to support type=hwpx**

Modify `getDownloadUrl()` in `exam-documents.service.ts`:

```typescript
async getDownloadUrl(id: string, userId: string, type: 'pdf' | 'answer' | 'hwpx' | 'hwpx-answer') {
  const doc = await this.findById(id, userId);

  if (type === 'hwpx' || type === 'hwpx-answer') {
    const s3Key = type === 'hwpx-answer' ? doc.answerHwpxS3Key : doc.hwpxS3Key;
    if (!s3Key) {
      // Lazy generation: enqueue HWPX generation job
      if (doc.hwpxStatus !== 'generating') {
        await this.pdfQueue.add('generate-hwpx', { documentId: id, endnoteOptions: DEFAULT_ENDNOTE_OPTIONS });
        await this.prisma.examDocument.update({ where: { id }, data: { hwpxStatus: 'generating' } });
      }
      return { status: 'generating' };
    }
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: s3Key });
    const url = await getSignedUrl(this.s3, command, { expiresIn: 3600 });
    return { url };
  }

  // Existing PDF logic
  const s3Key = type === 'answer' ? doc.answerPdfS3Key : doc.pdfS3Key;
  // ...
}
```

- [ ] **Step 4: Add quickExport() method (synchronous — no polling needed)**

```typescript
async quickExport(dto: QuickExportDto, userId: string, userRole: string) {
  // 1. Validate access to all problemIds
  const accessibleProblems = await this.prisma.problem.findMany({
    where: { id: { in: dto.problemIds }, ...getAccessibleProblemWhere(userId, userRole) },
    select: { id: true },
  });
  if (accessibleProblems.length !== dto.problemIds.length) {
    throw new ForbiddenException('One or more problems are not accessible');
  }

  // 2. Fetch problems with choices, assets (same query pattern as generateHwpx)
  const problems = await this.prisma.problem.findMany({
    where: { id: { in: dto.problemIds } },
    select: {
      id: true, stemLatex: true, stemText: true, problemType: true,
      answerText: true, answerLatex: true, solutionLatex: true, solutionText: true,
      examSource: true, bookSource: true, difficulty: true, pointValue: true,
      sharedStemLatex: true, parentId: true,
      choices: { select: { label: true, contentLatex: true, contentText: true, position: true }, orderBy: { position: 'asc' } },
      assets: { select: { id: true, s3Key: true, format: true, widthPx: true, heightPx: true } },
    },
  });

  // 3. Maintain order from dto.problemIds
  const problemMap = new Map(problems.map((p) => [p.id, p]));
  const ordered = dto.problemIds.map((id) => problemMap.get(id)).filter(Boolean);

  // 4. Download assets, convert WebP → PNG (same as generateHwpx)
  // ... (same batch download logic)

  // 5. Compile HWPX
  const endnoteOptions = {
    answer: dto.endnoteOptions?.answer ?? true,
    solution: dto.endnoteOptions?.solution ?? true,
    source: dto.endnoteOptions?.source ?? false,
    difficulty: dto.endnoteOptions?.difficulty ?? false,
    points: dto.endnoteOptions?.points ?? false,
  };

  const hwpxBuffer = await this.hwpxCompiler.compile({
    template: dto.template,
    problems: ordered.map((p) => ({ ...p, assets: (p as any)._resolvedAssets ?? [] })),
    endnoteOptions,
    headerConfig: dto.headerConfig,
  });

  // 6. Upload to S3 with TTL prefix, return pre-signed URL directly
  const exportId = crypto.randomUUID();
  const s3Key = `exports/hwpx/${exportId}.hwpx`;
  await this.s3.send(new PutObjectCommand({
    Bucket: this.bucket, Key: s3Key, Body: hwpxBuffer,
    ContentType: 'application/hwp+zip',
  }));

  const command = new GetObjectCommand({ Bucket: this.bucket, Key: s3Key });
  const url = await getSignedUrl(this.s3, command, { expiresIn: 86400 });
  return { exportId, downloadUrl: url };
}
```

- [ ] **Step 5: Handle generate-hwpx job in processor**

Modify `exam-documents.processor.ts`. Widen the `Job` data type to a union:

```typescript
import { EndnoteOptions } from './hwpx/hwpx-compiler.service';

type PdfJobData = { documentId: string; generateAnswerSheet: boolean };
type HwpxJobData = { documentId: string; endnoteOptions?: EndnoteOptions };

@Processor('exam-document-pdf')
export class ExamDocumentsPdfProcessor extends WorkerHost {
  // ...

  async process(job: Job<PdfJobData | HwpxJobData>) {
    if (job.name === 'generate-hwpx') {
      this.logger.log(`Processing HWPX generation for document ${job.data.documentId}`);
      await this.examDocumentsService.generateHwpx(
        job.data.documentId,
        (job.data as HwpxJobData).endnoteOptions,
      );
      return;
    }
    // Existing PDF generation
    this.logger.log(`Processing PDF generation for document ${job.data.documentId}`);
    await this.examDocumentsService.generatePdf(
      job.data.documentId,
      (job.data as PdfJobData).generateAnswerSheet,
    );
  }
}
```

- [ ] **Step 6: Verify existing tests still pass**

Run: `cd apps/lms-api && npx jest --testPathPattern='exam-documents' --no-coverage`
Expected: All existing exam-documents tests PASS (no regression)

- [ ] **Step 7: Commit**

```bash
git add apps/lms-api/src/exam-documents/
git commit -m "feat(hwpx): integrate HWPX generation into ExamDocumentsService and processor"
```

---

### Task 12: Controller Endpoints

**Files:**
- Modify: `apps/lms-api/src/exam-documents/exam-documents.controller.ts`

- [ ] **Step 1: Extend download endpoint type union**

```typescript
@Get(':id/download')
getDownloadUrl(
  @Param('id') id: string,
  @Query('type') type: 'pdf' | 'answer' | 'hwpx' | 'hwpx-answer' = 'pdf',
  @Request() req: AuthRequest,
) {
  return this.examDocuments.getDownloadUrl(id, req.user.id, type);
}
```

- [ ] **Step 2: Add quick-export endpoint**

```typescript
@Post('quick-export')
quickExport(@Body() dto: QuickExportDto, @Request() req: AuthRequest) {
  return this.examDocuments.quickExport(dto, req.user.id, req.user.role);
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/lms-api/src/exam-documents/exam-documents.controller.ts
git commit -m "feat(hwpx): add quick-export endpoint and extend download type to support hwpx"
```

---

## Phase 4 — End-to-End Verification

### Task 13: Integration Test

**Files:**
- Create: `apps/lms-api/src/exam-documents/hwpx/hwpx-integration.spec.ts`

- [ ] **Step 1: Write integration test**

```typescript
// hwpx-integration.spec.ts
import { HwpxCompilerService } from './hwpx-compiler.service';

describe('HWPX Integration', () => {
  let service: HwpxCompilerService;

  beforeAll(() => {
    service = new HwpxCompilerService();
  });

  it('generates a complete HWPX for a multi-problem exam', async () => {
    const buffer = await service.compile({
      template: 'school-exam',
      problems: [
        {
          stemLatex: '$f(x) = \\frac{x^{2}+1}{x-1}$의 극값을 구하시오.',
          stemText: 'f(x) = (x²+1)/(x-1)의 극값을 구하시오.',
          problemType: 'short_answer',
          choices: [],
          assets: [],
          answerText: '3',
          answerLatex: '3',
          solutionLatex: "$f'(x) = \\frac{x^{2}-2x-1}{(x-1)^{2}} = 0$에서 $x = 1 \\pm \\sqrt{2}$",
          solutionText: null,
          examSource: { year: 2024, month: 6, type: '모의평가', number: 21 },
          bookSource: null,
          difficulty: 4,
          pointValue: 4,
          sharedStemLatex: null,
          parentId: null,
        },
        {
          stemLatex: '다음 중 $\\lim_{x \\to 0} \\frac{\\sin x}{x}$의 값은?',
          stemText: null,
          problemType: 'multiple_choice',
          choices: [
            { label: '①', contentLatex: '0', contentText: '0', position: 1 },
            { label: '②', contentLatex: '\\frac{1}{2}', contentText: '1/2', position: 2 },
            { label: '③', contentLatex: '1', contentText: '1', position: 3 },
            { label: '④', contentLatex: '2', contentText: '2', position: 4 },
            { label: '⑤', contentLatex: '\\infty', contentText: '∞', position: 5 },
          ],
          assets: [],
          answerText: '③',
          answerLatex: null,
          solutionLatex: null,
          solutionText: 'lim sin x / x = 1',
          examSource: null,
          bookSource: { title: '수학의 정석', chapter: '7장' },
          difficulty: 2,
          pointValue: 2,
          sharedStemLatex: null,
          parentId: null,
        },
      ],
      endnoteOptions: { answer: true, solution: true, source: true, difficulty: true, points: true },
      headerConfig: { title: '2024 1학기 중간고사', schoolName: '서울고등학교', subject: '수학 I' },
    });

    expect(buffer.length).toBeGreaterThan(100);
    // Write to temp file for manual inspection in Hangul
    // const fs = require('fs'); fs.writeFileSync('/tmp/test-exam.hwpx', buffer);
  });
});
```

- [ ] **Step 2: Run integration test**

Run: `cd apps/lms-api && npx jest --testPathPattern='hwpx-integration' --no-coverage`
Expected: PASS

- [ ] **Step 3: Manual verification in Hangul**

Uncomment the file write line, generate the HWPX, open in Hancom Hangul. Check:
1. Document structure is correct
2. Equations are native and editable
3. Endnotes display correctly at the bottom
4. Images (if any) display correctly
5. Template styling is applied

- [ ] **Step 4: Commit**

```bash
git add apps/lms-api/src/exam-documents/hwpx/hwpx-integration.spec.ts
git commit -m "test(hwpx): add integration test for complete HWPX generation"
```

---

### Task 14: Final Cleanup & Verification

- [ ] **Step 1: Run full test suite**

Run: `cd apps/lms-api && npx jest --no-coverage`
Expected: All tests PASS, no regressions

- [ ] **Step 2: Verify TypeScript compilation**

Run: `cd /Users/parkjisong/jsmath && pnpm --filter lms-api build`
Expected: Build succeeds with no errors

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "feat(hwpx): complete HWPX export with native equations, endnotes, and templates"
```
