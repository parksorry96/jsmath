const LATEX_CONTROL_CHAR_REPAIR_MAP: Record<string, string> = {
  "\u0008": "\\b",
  "\u0009": "\\t",
  "\u000B": "\\v",
  "\u000C": "\\f",
  "\u000D": "\\r",
};

function repairLatexControlChars(value: string): string {
  return value.replace(
    /[\u0008\u0009\u000B\u000C\u000D]/g,
    (char) => LATEX_CONTROL_CHAR_REPAIR_MAP[char] ?? char,
  );
}

function toText(value: unknown): string {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }

  return "";
}

export interface PrintLayout {
  columns: number;
  fontCommand: string;
  pageSize: number;
  rowsPerColumn: number;
}

export interface PrintPageColumn<T> {
  blanks: number;
  items: T[];
}

export interface PrintPage<T> {
  columns: PrintPageColumn<T>[];
  index: number;
}

export interface ResolvedPrintItem<T> {
  globalIndex: number;
  problem: T;
  span: number;
}

export interface ResolvedPrintColumn<T> {
  blanks: number;
  items: ResolvedPrintItem<T>[];
  usedRows: number;
}

export interface ResolvedPrintPage<T> {
  columns: ResolvedPrintColumn<T>[];
  index: number;
}

export interface PrintableChoice {
  contentLatex: string;
  contentText: string;
  label: string;
  position: number;
}

export interface PrintableProblem<T> {
  baseProblem: T;
  choiceLayout: "spread" | "stacked";
  choices: PrintableChoice[];
  stemLatex: string;
  stemText: string;
}

function normalizeLineEndings(value: string): string {
  return repairLatexControlChars(value).replace(/\r\n?/g, "\n");
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function toFiniteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function hasExplicitMathDelimiters(value: string): boolean {
  return /(\$\$[\s\S]*?\$\$|\$[^$\n]+?\$|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\])/.test(
    value,
  );
}

function splitByMathDelimiters(value: string): string[] {
  return value.split(
    /(\$\$[\s\S]*?\$\$|\$[^$\n]+?\$|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\])/g,
  );
}

function splitInlineChoiceMarkers(value: string) {
  return Array.from(value.matchAll(/\(\s*([1-5])\s*\)|([①②③④⑤])/gu)).map(
    (match) => ({
      index: match.index ?? 0,
      marker: match[0],
      position: match[1]
        ? Number(match[1])
        : { "①": 1, "②": 2, "③": 3, "④": 4, "⑤": 5 }[match[2] ?? ""] ?? 0,
    }),
  );
}

function containsBareMathSyntax(value: string): boolean {
  return /\\(?:frac|dfrac|tfrac|sqrt|sum|prod|int|lim|sin|cos|tan|log|ln|cdot|times|pm|mp|leq|geq|neq|approx|infty|alpha|beta|gamma|delta|theta|pi|left|right|overline|underline|vec|hat|bar|textcircled)\b|[_^]/.test(
    value,
  );
}

function looksLikeInlineMathCandidate(value: string): boolean {
  const normalized = normalizeLineEndings(value).trim();
  if (!normalized) return false;
  if (hasExplicitMathDelimiters(normalized)) return false;
  if (/\\begin\{/.test(normalized)) return false;
  if (normalized.includes("\n")) return false;
  return containsBareMathSyntax(normalized);
}

function looksLikeDisplayMathCandidate(value: string): boolean {
  const normalized = normalizeLineEndings(value).trim();
  if (!normalized) return false;
  if (hasExplicitMathDelimiters(normalized)) return false;

  if (
    /^\\begin\{(?:aligned|array|bmatrix|Bmatrix|cases|gathered|matrix|pmatrix|smallmatrix|split|vmatrix|Vmatrix)\}[\s\S]*\\end\{(?:aligned|array|bmatrix|Bmatrix|cases|gathered|matrix|pmatrix|smallmatrix|split|vmatrix|Vmatrix)\}$/u.test(
      normalized,
    )
  ) {
    return true;
  }

  if (normalized.includes("\n") && containsBareMathSyntax(normalized)) {
    return true;
  }

  return /^\\left\s*[\\{[(|.][\s\S]*\\right\s*[\\}\])|.]$/u.test(normalized);
}

function containsHangul(value: string): boolean {
  return /[가-힣]/u.test(value);
}

function splitAnswerPrefix(value: string): { prefix: string; body: string } {
  const match = value.match(
    /^(\s*(?:\(\d+\)|\d+[.)]|[①②③④⑤⑥⑦⑧⑨⑩])\s*)(.+)$/u,
  );

  if (!match) {
    return { prefix: "", body: value.trim() };
  }

  return {
    prefix: match[1] ?? "",
    body: match[2]?.trim() ?? "",
  };
}

const LATEX_TEXT_ESCAPE_MAP: Record<string, string> = {
  "\\": "\\textbackslash{}",
  "{": "\\{",
  "}": "\\}",
  "#": "\\#",
  $: "\\$",
  "%": "\\%",
  "&": "\\&",
  _: "\\_",
  "~": "\\textasciitilde{}",
  "^": "\\textasciicircum{}",
};

const MAX_SAFE_LATEX_LENGTH = 12_000;
const FORBIDDEN_LATEX_PATTERN =
  /\\(?:@@input|input|include|includeonly|openin|openout|read|write(?:18)?|immediate|usepackage|requirepackage|documentclass|catcode|csname|newcommand|renewcommand|providecommand|def|edef|gdef|xdef|loop|repeat|toks|output|special|directlua|luaexec|newread|newwrite|every\w*|typein|typeout|message|show|meaning|errmessage)\b/iu;

export function escapeLatexText(value: unknown): string {
  return normalizeLineEndings(toText(value)).replace(
    /[\\{}#$%&_~^]/g,
    (char) => LATEX_TEXT_ESCAPE_MAP[char] ?? char,
  );
}

function sanitizeLatexInput(value: unknown): string | null {
  const normalized = normalizeLineEndings(toText(value)).trim();
  if (!normalized) {
    return null;
  }

  if (normalized.length > MAX_SAFE_LATEX_LENGTH) {
    return null;
  }

  if (FORBIDDEN_LATEX_PATTERN.test(normalized)) {
    return null;
  }

  return normalized;
}

function renderEscapedTextBlock(value: unknown): string {
  const normalized = normalizeLineEndings(toText(value)).trim();
  if (!normalized) {
    return "";
  }

  return normalized
    .split(/\n{2,}/)
    .map((paragraph) => escapeLatexText(paragraph).replace(/\n/g, "\\\\ "))
    .join("\n\\par\n");
}

function renderEscapedNarrativeSegment(value: string): string {
  const normalized = normalizeLineEndings(value);
  if (!normalized) {
    return "";
  }

  return normalized
    .split(/\n{2,}/)
    .map((paragraph) => escapeLatexText(paragraph).replace(/\n/g, "\\\\ "))
    .join("\n\\par\n");
}

const BARE_MATH_OPERATOR_PATTERN = /[=<>≤≥≠≈±×÷·]/u;
const BARE_MATH_FUNCTION_PATTERN =
  /\b(?:sin|cos|tan|sec|csc|cot|log|ln|lim|max|min|sup|inf)\s*\(/i;
const BARE_GEOMETRY_TOKEN_PATTERN = /^(?:[A-Z]{1,5}|∠[A-Z]{1,5}|[A-Z]{1,5}‾)$/u;
const BARE_MATH_CONTINUATION_PATTERN =
  /[0-9A-Za-z\\{}()[\]|.,:+\-*/=<>≤≥≠≈∞±·×÷_^'∠‾]/u;
const PROTECTED_DISPLAY_MATH_PATTERN = /\$\$[\s\S]*?\$\$/g;

function hasUnescapedDollarSign(value: string): boolean {
  return /(^|[^\\])\$/.test(value);
}

function isLikelyExplicitInlineMathBody(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes("\n")) {
    return false;
  }

  if (containsHangul(trimmed)) {
    return /\\(?:text|textrm|textsf|textbf|mathrm|operatorname)\s*\{[^{}]*[가-힣][^{}]*\}/u.test(
      trimmed,
    );
  }

  if (
    /\\[A-Za-z]+/.test(trimmed) ||
    /[_^]/.test(trimmed) ||
    BARE_MATH_OPERATOR_PATTERN.test(trimmed) ||
    /\d/.test(trimmed)
  ) {
    return true;
  }

  return /^[A-Za-z]$/u.test(trimmed);
}

function stripUnbalancedInlineDollarDelimiters(value: string): string {
  const protectedSegments: string[] = [];
  const protectedValue = value.replace(PROTECTED_DISPLAY_MATH_PATTERN, (match) => {
    const token = `\u0000DISPLAY_MATH_${protectedSegments.length}\u0000`;
    protectedSegments.push(match);
    return token;
  });
  const positions: number[] = [];

  for (let index = 0; index < protectedValue.length; index += 1) {
    if (
      protectedValue[index] === "$" &&
      (index === 0 || protectedValue[index - 1] !== "\\")
    ) {
      positions.push(index);
    }
  }

  if (positions.length < 2) {
    let result = "";
    for (let index = 0; index < protectedValue.length; index += 1) {
      if (positions.includes(index)) {
        continue;
      }
      result += protectedValue[index];
    }

    return protectedSegments.reduce(
      (restored, segment, index) =>
        restored.replace(`\u0000DISPLAY_MATH_${index}\u0000`, () => segment),
      result,
    );
  }

  const paired = new Set<number>();

  for (let index = 0; index < positions.length - 1; index += 1) {
    const start = positions[index];
    if (paired.has(start)) {
      continue;
    }

    for (let next = index + 1; next < positions.length; next += 1) {
      const end = positions[next];
      if (paired.has(end)) {
        continue;
      }

      const body = protectedValue.slice(start + 1, end);
      if (!isLikelyExplicitInlineMathBody(body)) {
        if (body.includes("\n") || containsHangul(body)) {
          break;
        }
        continue;
      }

      paired.add(start);
      paired.add(end);
      break;
    }
  }

  let stripped = "";
  for (let index = 0; index < protectedValue.length; index += 1) {
    if (protectedValue[index] === "$" && !paired.has(index)) {
      continue;
    }
    stripped += protectedValue[index];
  }

  return protectedSegments.reduce(
    (result, segment, index) =>
      result.replace(`\u0000DISPLAY_MATH_${index}\u0000`, () => segment),
    stripped,
  );
}

function nextNonWhitespaceIndex(value: string, index: number): number {
  let cursor = index;

  while (cursor < value.length && /\s/.test(value[cursor])) {
    cursor += 1;
  }

  return cursor;
}

function isMathContinuationChar(char: string): boolean {
  return BARE_MATH_CONTINUATION_PATTERN.test(char);
}

function isMathStartCandidate(value: string, index: number): boolean {
  const char = value[index];
  if (!char || char === "\n" || containsHangul(char)) {
    return false;
  }

  if (/[A-Z]/.test(char)) {
    const prev = index > 0 ? value[index - 1] : "";
    return !prev || !/[A-Za-z0-9]/.test(prev);
  }

  if (/[a-z0-9\\]/.test(char)) {
    const prev = index > 0 ? value[index - 1] : "";
    return !prev || (!/[A-Za-z0-9]/.test(prev) && !containsHangul(prev));
  }

  if ("|([{±∞".includes(char)) {
    const next = value[nextNonWhitespaceIndex(value, index + 1)] ?? "";
    return /[A-Za-z0-9\\∠]/.test(next);
  }

  return false;
}

function isLikelyBareMathRun(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || !/[A-Za-z0-9\\]/.test(trimmed)) {
    return false;
  }

  return (
    /\\[A-Za-z]+/.test(trimmed) ||
    /[_^]/.test(trimmed) ||
    BARE_MATH_OPERATOR_PATTERN.test(trimmed) ||
    /\d\s*\/\s*\d/.test(trimmed) ||
    BARE_MATH_FUNCTION_PATTERN.test(trimmed) ||
    BARE_GEOMETRY_TOKEN_PATTERN.test(trimmed)
  );
}

function normalizeBareMathRun(value: string): string {
  return value
    .trim()
    .replace(/([_^])\s*(?!\{)([A-Za-z0-9]+)/g, "$1{$2}")
    .replace(/≤/g, " \\le ")
    .replace(/≥/g, " \\ge ")
    .replace(/≠/g, " \\neq ")
    .replace(/≈/g, " \\approx ")
    .replace(/±/g, " \\pm ")
    .replace(/∓/g, " \\mp ")
    .replace(/×/g, " \\times ")
    .replace(/÷/g, " \\div ")
    .replace(/·/g, " \\cdot ")
    .replace(/∞/g, " \\infty ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function consumeBareMathRun(value: string, start: number): number {
  let cursor = start;

  while (cursor < value.length) {
    const char = value[cursor];
    if (!char || char === "\n" || containsHangul(char)) {
      break;
    }

    if (/\s/.test(char)) {
      const nextIndex = nextNonWhitespaceIndex(value, cursor + 1);
      const next = value[nextIndex] ?? "";
      if (!next || next === "\n" || containsHangul(next) || !isMathContinuationChar(next)) {
        break;
      }
      cursor += 1;
      continue;
    }

    if (!isMathContinuationChar(char)) {
      break;
    }

    cursor += 1;
  }

  let end = cursor;
  while (end > start && /\s/.test(value[end - 1])) {
    end -= 1;
  }

  while (end > start && /[.,;:!?]/.test(value[end - 1])) {
    if (value[end - 1] === "." && /\d\.\d$/.test(value.slice(start, end))) {
      break;
    }
    end -= 1;
  }

  return isLikelyBareMathRun(value.slice(start, end)) ? end : start;
}

function renderNarrativeSegmentWithBareMath(value: string): string {
  const normalized = normalizeLineEndings(value);
  if (!normalized) {
    return "";
  }

  return normalized
    .split(/\n{2,}/)
    .map((paragraph) => {
      let output = "";
      let textBuffer = "";
      let cursor = 0;

      const flushTextBuffer = () => {
        if (!textBuffer) {
          return;
        }
        output += escapeLatexText(textBuffer).replace(/\n/g, "\\\\ ");
        textBuffer = "";
      };

      while (cursor < paragraph.length) {
        const runEnd = isMathStartCandidate(paragraph, cursor)
          ? consumeBareMathRun(paragraph, cursor)
          : cursor;

        if (runEnd > cursor) {
          flushTextBuffer();
          output += `\\ensuremath{${normalizeBareMathRun(paragraph.slice(cursor, runEnd))}}`;
          cursor = runEnd;
          continue;
        }

        textBuffer += paragraph[cursor];
        cursor += 1;
      }

      flushTextBuffer();
      return output;
    })
    .join("\n\\par\n");
}

export function stripChoicePrefix(value: unknown): string {
  const normalized = normalizeLineEndings(toText(value)).trim();
  if (!normalized) {
    return "";
  }

  const stripped = normalized.replace(
    /^\s*(?:\(\d+\)|\d+[.)]|[①②③④⑤⑥⑦⑧⑨⑩])\s*/u,
    "",
  );

  return stripped.trim().length > 0 ? stripped.trim() : normalized;
}

function parseInlineChoices(value: unknown): {
  choices: Array<{ content: string; position: number }>;
  stem: string;
} | null {
  const normalized = normalizeLineEndings(toText(value)).trim();
  if (!normalized) {
    return null;
  }

  const matches = splitInlineChoiceMarkers(normalized);
  if (matches.length < 4) {
    return null;
  }

  for (let start = 0; start < matches.length; start += 1) {
    if (matches[start].position !== 1) {
      continue;
    }

    const sequence = matches.slice(start);
    if (sequence.length < 4 || sequence.length > 5) {
      continue;
    }

    const isSequential = sequence.every(
      (match, index) => match.position === index + 1,
    );
    if (!isSequential) {
      continue;
    }

    const stem = normalized.slice(0, sequence[0].index).trim();
    if (!stem) {
      continue;
    }

    const choices = sequence.map((match, index) => {
      const nextIndex =
        index + 1 < sequence.length ? sequence[index + 1].index : normalized.length;
      return {
        content: normalized
          .slice(match.index + match.marker.length, nextIndex)
          .trim(),
        position: match.position,
      };
    });

    if (choices.some((choice) => !choice.content)) {
      continue;
    }

    return { choices, stem };
  }

  return null;
}

function wrapBareMathEnvironments(value: string): string {
  return splitByMathDelimiters(value)
    .map((segment) => {
      if (hasExplicitMathDelimiters(segment)) {
        return segment;
      }

      return segment.replace(
        /\\begin\{(aligned|array|bmatrix|Bmatrix|cases|gathered|matrix|pmatrix|smallmatrix|split|vmatrix|Vmatrix)\}[\s\S]*?\\end\{\1\}/gu,
        (match) => `\\[${match}\\]`,
      );
    })
    .join("");
}

export function renderLatexOrText(latex: unknown, text: unknown): string {
  const safeLatex = sanitizeLatexInput(latex);
  const latexText = safeLatex
    ? wrapBareMathEnvironments(safeLatex)
    : "";
  if (latexText.length > 0) {
    if (containsHangul(latexText) || hasUnescapedDollarSign(latexText)) {
      return renderNarrativeLatexOrText(latexText);
    }

    if (looksLikeDisplayMathCandidate(latexText)) {
      return `\\[${latexText}\\]`;
    }

    if (looksLikeInlineMathCandidate(latexText)) {
      return `\\ensuremath{${latexText}}`;
    }

    return latexText;
  }

  const fallback = toText(text) || toText(latex);
  return renderEscapedTextBlock(fallback);
}

export function renderChoiceLatexOrText(latex: unknown, text: unknown): string {
  return renderLatexOrText(stripChoicePrefix(latex), stripChoicePrefix(text));
}

function isSpreadChoiceCandidate(value: string): boolean {
  const normalized = stripChoicePrefix(value).replace(/\s+/g, " ").trim();
  if (!normalized) {
    return true;
  }

  if (normalized.includes("\n")) {
    return false;
  }

  if (/\\begin\{/.test(normalized)) {
    return false;
  }

  return normalized.length <= 12 || (!/\s/.test(normalized) && normalized.length <= 24);
}

function resolveChoiceLayout(choices: PrintableChoice[]): "spread" | "stacked" {
  if (choices.length < 4 || choices.length > 5) {
    return "stacked";
  }

  return choices.every((choice) =>
    isSpreadChoiceCandidate(choice.contentLatex || choice.contentText),
  )
    ? "spread"
    : "stacked";
}

function buildPrintableChoices(
  choices: unknown,
): PrintableChoice[] {
  if (!Array.isArray(choices) || choices.length === 0) {
    return [];
  }

  return [...choices]
    .filter((choice): choice is Record<string, unknown> => Boolean(toRecord(choice)))
    .sort(
      (a, b) =>
        (toFiniteNumber(a.position) ?? 0) - (toFiniteNumber(b.position) ?? 0),
    )
    .map((choice, index) => {
      const position = Math.max(
        1,
        Math.floor(toFiniteNumber(choice.position) ?? index + 1),
      );
      const contentLatex = stripChoicePrefix(choice.contentLatex);
      const contentText = stripChoicePrefix(choice.contentText);

      return {
        contentLatex,
        contentText,
        label:
          toText(choice.label).trim() ||
          ["", "①", "②", "③", "④", "⑤"][position] ||
          `(${position})`,
        position,
      };
    });
}

export function resolveProblemForPrint<T extends Record<string, unknown>>(
  problem: T,
): PrintableProblem<T> {
  const existingChoices = buildPrintableChoices(problem.choices);
  const stemLatex = normalizeLineEndings(toText(problem.stemLatex)).trim();
  const stemText = normalizeLineEndings(toText(problem.stemText)).trim();

  if (existingChoices.length > 0) {
    return {
      baseProblem: problem,
      choiceLayout: resolveChoiceLayout(existingChoices),
      choices: existingChoices,
      stemLatex,
      stemText,
    };
  }

  const latexSplit = parseInlineChoices(problem.stemLatex);
  const textSplit = parseInlineChoices(problem.stemText);
  const derivedCount =
    latexSplit?.choices.length ?? textSplit?.choices.length ?? 0;

  if (derivedCount >= 4) {
    const choices: PrintableChoice[] = Array.from(
      { length: derivedCount },
      (_, index) => {
        const position =
          latexSplit?.choices[index]?.position ??
          textSplit?.choices[index]?.position ??
          index + 1;
        const contentLatex = stripChoicePrefix(latexSplit?.choices[index]?.content);
        const contentText = stripChoicePrefix(textSplit?.choices[index]?.content);

        return {
          contentLatex,
          contentText,
          label: ["", "①", "②", "③", "④", "⑤"][position] || `(${position})`,
          position,
        };
      },
    ).filter((choice) => Boolean(choice.contentLatex || choice.contentText));

    if (choices.length >= 4) {
      return {
        baseProblem: problem,
        choiceLayout: resolveChoiceLayout(choices),
        choices,
        stemLatex: latexSplit?.stem ?? stemLatex,
        stemText: textSplit?.stem ?? stemText,
      };
    }
  }

  return {
    baseProblem: problem,
    choiceLayout: "stacked",
    choices: [],
    stemLatex,
    stemText,
  };
}

export function renderText(value: unknown): string {
  return escapeLatexText(value);
}

export function buildPrintLayout(layout: unknown): PrintLayout {
  const layoutRecord =
    layout && typeof layout === "object"
      ? (layout as Record<string, unknown>)
      : {};
  const problemsPerPage = Number(layoutRecord.problemsPerPage);

  switch (problemsPerPage) {
    case 2:
      return {
        columns: 1,
        fontCommand: "\\normalsize",
        pageSize: 2,
        rowsPerColumn: 2,
      };
    case 3:
      return {
        columns: 1,
        fontCommand: "\\small",
        pageSize: 3,
        rowsPerColumn: 3,
      };
    case 5:
      return {
        columns: 2,
        fontCommand: "\\footnotesize",
        pageSize: 5,
        rowsPerColumn: 3,
      };
    case 6:
      return {
        columns: 2,
        fontCommand: "\\scriptsize",
        pageSize: 6,
        rowsPerColumn: 3,
      };
    case 4:
    default:
      return {
        columns: 2,
        fontCommand: "\\small",
        pageSize: 4,
        rowsPerColumn: 2,
      };
  }
}

export function paginateProblemsForPrint<T>(
  problems: T[],
  printLayout: PrintLayout,
): PrintPage<T>[] {
  const pages: PrintPage<T>[] = [];

  for (let start = 0; start < problems.length; start += printLayout.pageSize) {
    const pageItems = problems.slice(start, start + printLayout.pageSize);
    const columns: PrintPageColumn<T>[] = Array.from(
      { length: printLayout.columns },
      () => ({
        blanks: printLayout.rowsPerColumn,
        items: [],
      }),
    );

    pageItems.forEach((item, index) => {
      const columnIndex =
        printLayout.columns === 1
          ? 0
          : Math.min(
              printLayout.columns - 1,
              Math.floor(index / printLayout.rowsPerColumn),
            );

      columns[columnIndex].items.push(item);
      columns[columnIndex].blanks = Math.max(0, columns[columnIndex].blanks - 1);
    });

    pages.push({
      columns,
      index: pages.length,
    });
  }

  return pages;
}

function resolvePreviewPrintPages<T extends { id: string }>(
  problems: T[],
  layout: unknown,
  printLayout: PrintLayout,
): ResolvedPrintPage<T>[] | null {
  const layoutRecord = toRecord(layout);
  const previewPlan = toRecord(layoutRecord?.previewPlan);
  const rawPages = previewPlan?.pages;

  if (!Array.isArray(rawPages) || rawPages.length === 0) {
    return null;
  }

  const problemsById = new Map(
    problems.map((problem, index) => [problem.id, { index, problem }]),
  );
  const seenProblemIds = new Set<string>();
  const pages: ResolvedPrintPage<T>[] = [];

  for (const rawPage of rawPages) {
    const pageRecord = toRecord(rawPage);
    const rawColumns = pageRecord?.columns;

    if (!Array.isArray(rawColumns) || rawColumns.length !== printLayout.columns) {
      return null;
    }

    const columns: ResolvedPrintColumn<T>[] = [];

    for (const rawColumn of rawColumns) {
      const columnRecord = toRecord(rawColumn);
      const rawItems = columnRecord?.items;

      if (!Array.isArray(rawItems)) {
        return null;
      }

      let usedRows = 0;
      const items: ResolvedPrintItem<T>[] = [];

      for (const rawItem of rawItems) {
        const itemRecord = toRecord(rawItem);
        const problemId = toText(itemRecord?.problemId).trim();

        if (!problemId || seenProblemIds.has(problemId)) {
          return null;
        }

        const entry = problemsById.get(problemId);
        if (!entry) {
          return null;
        }

        const span = Math.max(
          1,
          Math.min(
            printLayout.rowsPerColumn,
            Math.floor(toFiniteNumber(itemRecord?.span) ?? 1),
          ),
        );

        if (usedRows + span > printLayout.rowsPerColumn) {
          return null;
        }

        items.push({
          globalIndex: Math.max(
            0,
            Math.floor(toFiniteNumber(itemRecord?.globalIndex) ?? entry.index),
          ),
          problem: entry.problem,
          span,
        });
        usedRows += span;
        seenProblemIds.add(problemId);
      }

      columns.push({
        blanks: Math.max(0, printLayout.rowsPerColumn - usedRows),
        items,
        usedRows,
      });
    }

    pages.push({
      columns,
      index: pages.length,
    });
  }

  return seenProblemIds.size === problems.length ? pages : null;
}

export function resolvePrintPages<T extends { id: string }>(
  problems: T[],
  layout: unknown,
): ResolvedPrintPage<T>[] {
  const printLayout = buildPrintLayout(layout);
  const previewPages = resolvePreviewPrintPages(problems, layout, printLayout);

  if (previewPages) {
    return previewPages;
  }

  const problemIndexById = new Map(
    problems.map((problem, index) => [problem.id, index]),
  );

  return paginateProblemsForPrint(problems, printLayout).map((page) => ({
    columns: page.columns.map((column) => ({
      blanks: column.blanks,
      items: column.items.map((problem) => ({
        globalIndex: problemIndexById.get(problem.id) ?? 0,
        problem,
        span: 1,
      })),
      usedRows: Math.max(0, printLayout.rowsPerColumn - column.blanks),
    })),
    index: page.index,
  }));
}

export function buildSlotHeightExpression(
  slotLengthCommand: string,
  rowSpan: unknown,
): string {
  const span = Math.max(1, Math.floor(toFiniteNumber(rowSpan) ?? 1));
  if (span === 1) {
    return slotLengthCommand;
  }

  return `\\dimexpr ${span}${slotLengthCommand} + ${span - 1}\\problemSlotGap\\relax`;
}

export function buildBlankHeightExpression(
  slotLengthCommand: string,
  blankRows: unknown,
): string {
  const rows = Math.max(0, Math.floor(toFiniteNumber(blankRows) ?? 0));
  if (rows === 0) {
    return "0pt";
  }

  if (rows === 1) {
    return slotLengthCommand;
  }

  return `\\dimexpr ${rows}${slotLengthCommand} + ${rows - 1}\\problemSlotGap\\relax`;
}

export function renderInlineLatexOrText(latex: unknown, text: unknown): string {
  const latexText = sanitizeLatexInput(latex) ?? "";
  if (latexText.length > 0) {
    if (!looksLikeInlineMathCandidate(latexText)) {
      return latexText;
    }

    const { prefix, body } = splitAnswerPrefix(latexText);
    if (!body) {
      return escapeLatexText(prefix);
    }

    return `${escapeLatexText(prefix)}\\ensuremath{${body}}`;
  }

  const fallbackText = normalizeLineEndings(toText(text) || toText(latex)).trim();
  if (fallbackText.length === 0) {
    return "";
  }

  if (!looksLikeInlineMathCandidate(fallbackText)) {
    return escapeLatexText(fallbackText);
  }

  const { prefix, body } = splitAnswerPrefix(fallbackText);
  if (!body) {
    return escapeLatexText(prefix);
  }

  return `${escapeLatexText(prefix)}\\ensuremath{${body}}`;
}

function renderExplicitMathSegment(segment: string): string {
  const trimmed = normalizeLineEndings(segment).trim();
  if (!trimmed) {
    return "";
  }

  const safeSegment = sanitizeLatexInput(trimmed);
  if (!safeSegment) {
    return escapeLatexText(trimmed);
  }

  const normalizedMathText = safeSegment.replace(
    /\\(?:mathrm|mathbf|mathit|mathsf|mathtt|operatorname)\{([^{}]*[가-힣][^{}]*)\}/gu,
    (_match, inner: string) => `\\text{${inner}}`,
  );

  if (normalizedMathText.startsWith("$$") && normalizedMathText.endsWith("$$")) {
    return `\\[${normalizedMathText.slice(2, -2).trim()}\\]`;
  }

  if (normalizedMathText.startsWith("\\[") && normalizedMathText.endsWith("\\]")) {
    return normalizedMathText;
  }

  if (normalizedMathText.startsWith("\\(") && normalizedMathText.endsWith("\\)")) {
    return `\\ensuremath{${normalizedMathText.slice(2, -2).trim()}}`;
  }

  if (normalizedMathText.startsWith("$") && normalizedMathText.endsWith("$")) {
    return `\\ensuremath{${normalizedMathText.slice(1, -1).trim()}}`;
  }

  return normalizedMathText;
}

export function renderNarrativeLatexOrText(value: unknown): string {
  const rawValue = toText(value);
  const normalized = wrapBareMathEnvironments(
    stripUnbalancedInlineDollarDelimiters(normalizeLineEndings(rawValue)),
  );
  const trimmed = normalized.trim();

  if (!trimmed) {
    return "";
  }

  if (!hasExplicitMathDelimiters(trimmed)) {
    const safeLatex = sanitizeLatexInput(trimmed);

    if (containsHangul(trimmed)) {
      return renderNarrativeSegmentWithBareMath(normalized);
    }

    if (!safeLatex) {
      return renderNarrativeSegmentWithBareMath(rawValue);
    }

    if (looksLikeDisplayMathCandidate(safeLatex)) {
      return `\\[${safeLatex}\\]`;
    }

    if (looksLikeInlineMathCandidate(safeLatex)) {
      return `\\ensuremath{${safeLatex}}`;
    }

    return renderNarrativeSegmentWithBareMath(normalized);
  }

  return splitByMathDelimiters(normalized)
    .map((segment) => {
      if (!segment) {
        return "";
      }

      if (hasExplicitMathDelimiters(segment)) {
        return renderExplicitMathSegment(segment);
      }

      return renderNarrativeSegmentWithBareMath(segment);
    })
    .join("");
}

export function renderSolutionStep(step: unknown): string {
  if (typeof step === "string") {
    return renderNarrativeLatexOrText(step);
  }

  if (!step || typeof step !== "object") {
    return "";
  }

  const stepRecord = step as Record<string, unknown>;
  const concept = toText(stepRecord.concept);
  const description = toText(
    stepRecord.description ?? stepRecord.explanation ?? stepRecord.text,
  );

  if (!description) {
    return "";
  }

  const renderedDescription = renderNarrativeLatexOrText(description);
  if (!concept) {
    return renderedDescription;
  }

  return `\\textbf{${escapeLatexText(concept)}}: ${renderedDescription}`;
}

export const latexTemplateHelpers = {
  buildPrintLayout,
  buildBlankHeightExpression,
  buildSlotHeightExpression,
  paginateProblemsForPrint,
  renderChoiceLatexOrText,
  renderInlineLatexOrText,
  renderLatexOrText,
  renderNarrativeLatexOrText,
  renderSolutionStep,
  renderText,
  resolveProblemForPrint,
  resolvePrintPages,
  stripChoicePrefix,
};
