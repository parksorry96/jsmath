"use client";

import { useMemo } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";

interface LatexRendererProps {
  /** Text containing mixed Korean/English text and LaTeX delimiters ($...$ or $$...$$) */
  content: string;
  className?: string;
}

interface Segment {
  type: "text" | "inline-math" | "block-math" | "image";
  value: string;
  alt?: string;
}

function escapeRegexPattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const HANGUL_PATTERN = /[가-힣]/u;
const MATH_OPERATOR_PATTERN = /[=<>≤≥≠≈±×÷·]/u;
const MATH_FUNCTION_PATTERN = /\b(?:sin|cos|tan|sec|csc|cot|log|ln|lim|max|min|sup|inf)\s*\(/i;
const GEOMETRY_TOKEN_PATTERN = /^(?:[A-Z]{1,5}|∠[A-Z]{1,5}|[A-Z]{1,5}‾)$/u;
const MATH_CONTINUATION_PATTERN =
  /[0-9A-Za-z\\{}()[\]|.,:+\-*/=<>≤≥≠≈∞±·×÷_^'∠‾]/u;
const EXPLICIT_MATH_PATTERN =
  String.raw`\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\$[^\n$]+?\$|\\\([\s\S]*?\\\)`;
const MATH_SEGMENT_SPLIT_PATTERN = new RegExp(`(${EXPLICIT_MATH_PATTERN})`, "g");
const IMAGE_OR_MATH_SPLIT_PATTERN = new RegExp(
  String.raw`(!\[[^\]]*\]\(https?:\/\/[^)]+\)|${EXPLICIT_MATH_PATTERN})`,
  "g",
);
const IMAGE_OR_MATH_PARSE_PATTERN =
  /!\[([^\]]*)\]\((https?:\/\/[^)]+)\)|\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\$([^\n$]+?)\$|\\\(([\s\S]+?)\\\)/g;
const LEFT_RIGHT_DELIMITER_PATTERN = String.raw`(?:\\\{|\\\}|[(){}\[\]|.])`;
const CROSS_DELIMITED_LEFT_RIGHT_PATTERN = new RegExp(
  String.raw`\\left\s*(${LEFT_RIGHT_DELIMITER_PATTERN})\s*(${EXPLICIT_MATH_PATTERN})\s*\\right\s*(${LEFT_RIGHT_DELIMITER_PATTERN})`,
  "g",
);
const BARE_LEFT_RIGHT_COMMAND_PATTERN = new RegExp(
  String.raw`\\(?:left|right)\s*${LEFT_RIGHT_DELIMITER_PATTERN}`,
  "g",
);
const BARE_MATH_ENVIRONMENTS = [
  "array",
  "aligned",
  "alignedat",
  "gathered",
  "matrix",
  "pmatrix",
  "bmatrix",
  "Bmatrix",
  "vmatrix",
  "Vmatrix",
  "smallmatrix",
  "cases",
  "subarray",
  "split",
] as const;
const DISPLAY_MATH_ENVIRONMENTS = new Set<string>([
  "array",
  "aligned",
  "alignedat",
  "gathered",
  "cases",
  "subarray",
  "split",
]);
const BARE_MATH_ENVIRONMENT_START_PATTERN = new RegExp(
  String.raw`\\begin\{(${BARE_MATH_ENVIRONMENTS.map(escapeRegexPattern).join("|")})\}`,
  "g",
);

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function isExplicitMathSegment(part: string): boolean {
  return part.startsWith("$") || part.startsWith("\\(") || part.startsWith("\\[");
}

function consumeLeftRightCommand(
  input: string,
  start: number,
  command: "left" | "right",
): number {
  const prefix = `\\${command}`;
  if (!input.startsWith(prefix, start)) {
    return -1;
  }

  let cursor = start + prefix.length;
  while (cursor < input.length && /\s/.test(input[cursor])) {
    cursor += 1;
  }

  if (input.startsWith("\\{", cursor) || input.startsWith("\\}", cursor)) {
    return cursor + 2;
  }

  const delimiter = input[cursor] ?? "";
  return "(){}[]|.".includes(delimiter) ? cursor + 1 : -1;
}

function findBareLeftRightSpanEnd(input: string, start: number): number {
  let cursor = consumeLeftRightCommand(input, start, "left");
  if (cursor === -1) {
    return -1;
  }

  let depth = 1;
  while (cursor < input.length) {
    const nextLeft = input.indexOf("\\left", cursor);
    const nextRight = input.indexOf("\\right", cursor);

    if (nextLeft === -1 && nextRight === -1) {
      return -1;
    }

    const useLeft =
      nextLeft !== -1 && (nextRight === -1 || nextLeft < nextRight);
    const nextIndex = useLeft ? nextLeft : nextRight;
    const nextCursor = consumeLeftRightCommand(
      input,
      nextIndex,
      useLeft ? "left" : "right",
    );

    if (nextCursor === -1) {
      cursor = nextIndex + 1;
      continue;
    }

    depth += useLeft ? 1 : -1;
    cursor = nextCursor;

    if (depth === 0) {
      return cursor;
    }
  }

  return -1;
}

function wrapBareLeftRightSpans(input: string): string {
  let output = "";
  let cursor = 0;

  while (cursor < input.length) {
    const nextLeft = input.indexOf("\\left", cursor);
    if (nextLeft === -1) {
      output += input.slice(cursor);
      break;
    }

    output += input.slice(cursor, nextLeft);
    const spanEnd = findBareLeftRightSpanEnd(input, nextLeft);

    if (spanEnd === -1) {
      output += input.slice(nextLeft, nextLeft + "\\left".length);
      cursor = nextLeft + "\\left".length;
      continue;
    }

    output += `$${input.slice(nextLeft, spanEnd)}$`;
    cursor = spanEnd;
  }

  return output;
}

/**
 * Strip LaTeX commands that shouldn't render in the UI:
 * \section*{...}, \footnotetext{...}, etc.
 */
function cleanLatexCommands(input: string): string {
  return (
    input
      // Remove invisible OCR/control characters that break math tokenization
      .replace(/[\u200B-\u200D\u2060\u2061]/gu, "")
      // \section*{...} or \section{...}
      .replace(/\\section\*?\{[^}]*\}/g, "")
      // \footnotetext{ ... } — may span multiple lines
      .replace(/\\footnotetext\s*\{[\s\S]*?\n\}/g, "")
      // Trim leftover blank lines (3+ newlines → 2)
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

function unwrapExplicitMath(value: string): { body: string; displayMode: boolean } {
  if (value.startsWith("$$") && value.endsWith("$$")) {
    return { body: value.slice(2, -2).trim(), displayMode: true };
  }

  if (value.startsWith("\\[") && value.endsWith("\\]")) {
    return { body: value.slice(2, -2).trim(), displayMode: true };
  }

  if (value.startsWith("$") && value.endsWith("$")) {
    return { body: value.slice(1, -1).trim(), displayMode: false };
  }

  if (value.startsWith("\\(") && value.endsWith("\\)")) {
    return { body: value.slice(2, -2).trim(), displayMode: false };
  }

  return { body: value.trim(), displayMode: false };
}

function normalizeCrossDelimitedMath(input: string): string {
  return input.replace(
    CROSS_DELIMITED_LEFT_RIGHT_PATTERN,
    (_match, leftDelimiter: string, innerMath: string, rightDelimiter: string) => {
      const { body, displayMode } = unwrapExplicitMath(innerMath);
      if (!body) {
        return innerMath;
      }

      const delimiter = displayMode ? "$$" : "$";
      return `${delimiter}\\left${leftDelimiter}${body}\\right${rightDelimiter}${delimiter}`;
    },
  );
}

function nextNonWhitespaceIndex(input: string, index: number): number {
  let cursor = index;
  while (cursor < input.length && /\s/.test(input[cursor])) {
    cursor += 1;
  }
  return cursor;
}

function isMathContinuationChar(char: string): boolean {
  return MATH_CONTINUATION_PATTERN.test(char);
}

function isMathStartCandidate(input: string, index: number): boolean {
  const char = input[index];
  if (!char || char === "\n" || HANGUL_PATTERN.test(char)) {
    return false;
  }

  if (/[A-Z]/.test(char)) {
    const prev = index > 0 ? input[index - 1] : "";
    return !prev || !/[A-Za-z0-9]/.test(prev);
  }

  if (/[a-z0-9\\]/.test(char)) {
    const prev = index > 0 ? input[index - 1] : "";
    return !prev || (!/[A-Za-z0-9]/.test(prev) && !HANGUL_PATTERN.test(prev));
  }

  if ("|([{±∞".includes(char)) {
    const next = input[nextNonWhitespaceIndex(input, index + 1)] ?? "";
    return /[A-Za-z0-9\\∠]/.test(next);
  }

  return false;
}

function isPlausibleBareMathRun(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || !/[A-Za-z0-9\\]/.test(trimmed)) {
    return false;
  }

  return (
    /\\[A-Za-z]+/.test(trimmed) ||
    /[_^]/.test(trimmed) ||
    MATH_OPERATOR_PATTERN.test(trimmed) ||
    /\d\s*\/\s*\d/.test(trimmed) ||
    MATH_FUNCTION_PATTERN.test(trimmed) ||
    GEOMETRY_TOKEN_PATTERN.test(trimmed)
  );
}

function normalizeBareMathRun(value: string): string {
  return value
    .trim()
    .replace(/([_^])\s*(?!\{)([A-Za-z0-9]+)/g, "$1{$2}")
    .replace(/≤/g, " \\le ")
    .replace(/≥/g, " \\ge ")
    .replace(/≠/g, " \\ne ")
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

function consumeBareMathRun(input: string, start: number): number {
  let cursor = start;

  while (cursor < input.length) {
    const char = input[cursor];
    if (!char || char === "\n" || HANGUL_PATTERN.test(char)) {
      break;
    }

    if (/\s/.test(char)) {
      const nextIndex = nextNonWhitespaceIndex(input, cursor + 1);
      const next = input[nextIndex] ?? "";
      if (!next || next === "\n" || HANGUL_PATTERN.test(next) || !isMathContinuationChar(next)) {
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
  while (end > start && /\s/.test(input[end - 1])) {
    end -= 1;
  }

  while (end > start && /[.,;:!?]/.test(input[end - 1])) {
    if (input[end - 1] === "." && /\d\.\d$/.test(input.slice(start, end))) {
      break;
    }
    end -= 1;
  }

  return isPlausibleBareMathRun(input.slice(start, end)) ? end : start;
}

/**
 * Recover common AI output mistakes where math is emitted without $...$ delimiters.
 * This keeps mixed Korean narrative intact while wrapping only likely math runs.
 */
function wrapBareMathRuns(input: string): string {
  const parts = input.split(IMAGE_OR_MATH_SPLIT_PATTERN);

  return parts
    .map((part) => {
      if (
        !part ||
        part.startsWith("$") ||
        part.startsWith("\\(") ||
        part.startsWith("\\[") ||
        part.startsWith("![")
      ) {
        return part;
      }

      let output = "";
      let cursor = 0;

      while (cursor < part.length) {
        const runEnd = isMathStartCandidate(part, cursor)
          ? consumeBareMathRun(part, cursor)
          : cursor;

        if (runEnd > cursor) {
          output += `$${normalizeBareMathRun(part.slice(cursor, runEnd))}$`;
          cursor = runEnd;
          continue;
        }

        output += part[cursor];
        cursor += 1;
      }

      return output;
    })
    .join("");
}

function sanitizeMixedExplicitMath(input: string): string {
  return input.replace(
    /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\$([^\n$]+?)\$|\\\(([\s\S]+?)\\\)/g,
    (match, dollarBlock, bracketBlock, dollarInline, parenInline) => {
      const inner = String(
        dollarBlock ?? bracketBlock ?? dollarInline ?? parenInline ?? "",
      );
      if (!HANGUL_PATTERN.test(inner)) {
        return match;
      }

      if (/\\(?:text|textrm|textsf|textbf|mathrm|operatorname)\s*\{/u.test(inner)) {
        return match;
      }

      return wrapBareMathRuns(inner);
    },
  );
}

/**
 * Wrap bare LaTeX commands (e.g. \left\{, \right., \frac{}{}) that
 * appear outside of $...$ delimiters into inline math.
 */
function wrapBareLatexCommands(input: string): string {
  const parts = input.split(MATH_SEGMENT_SPLIT_PATTERN);
  return parts
    .map((part) => {
      if (isExplicitMathSegment(part)) {
        return part;
      }

      return wrapBareLeftRightSpans(part)
        .split(MATH_SEGMENT_SPLIT_PATTERN)
        .map((subpart) => {
          if (isExplicitMathSegment(subpart)) {
            return subpart;
          }

          return subpart.replace(BARE_LEFT_RIGHT_COMMAND_PATTERN, (match) => `$${match}$`);
        })
        .join("");
    })
    .join("");
}

function normalizeBareMathEnvironmentNames(input: string): string {
  return input
    .replace(/\\begin\{tabular\}/g, "\\begin{array}")
    .replace(/\\end\{tabular\}/g, "\\end{array}")
    .replace(/\\begin\{align\*?\}/g, "\\begin{aligned}")
    .replace(/\\end\{align\*?\}/g, "\\end{aligned}")
    .replace(/\\begin\{gather\*?\}/g, "\\begin{gathered}")
    .replace(/\\end\{gather\*?\}/g, "\\end{gathered}");
}

function stripInnerMathDelimiters(value: string): string {
  return value
    .replace(
      /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\$([^\n$]+?)\$|\\\(([\s\S]+?)\\\)/g,
      (_match, dollarBlock, bracketBlock, dollarInline, parenInline) => {
        const inner = String(
          dollarBlock ?? bracketBlock ?? dollarInline ?? parenInline ?? "",
        ).trim();
        return inner ? ` ${inner} ` : " ";
      },
    )
    .replace(/\s{2,}/g, " ")
    .trim();
}

function wrapMathEnvironment(value: string, envName: string): string {
  const delimiter = DISPLAY_MATH_ENVIRONMENTS.has(envName) ? "$$" : "$";
  return `${delimiter}${stripInnerMathDelimiters(value)}${delimiter}`;
}

/**
 * Convert \begin{tabular} to \begin{array} for KaTeX compatibility,
 * and wrap bare math environments before heuristic inline wrapping runs.
 */
function wrapBareEnvironments(input: string): string {
  const result = normalizeBareMathEnvironmentNames(input);
  const protectedPattern = new RegExp(
    IMAGE_OR_MATH_PARSE_PATTERN.source,
    IMAGE_OR_MATH_PARSE_PATTERN.flags,
  );
  const environmentPattern = new RegExp(
    BARE_MATH_ENVIRONMENT_START_PATTERN.source,
    BARE_MATH_ENVIRONMENT_START_PATTERN.flags,
  );
  let output = "";
  let cursor = 0;

  while (cursor < result.length) {
    protectedPattern.lastIndex = cursor;
    const protectedMatch = protectedPattern.exec(result);

    environmentPattern.lastIndex = cursor;
    const environmentMatch = environmentPattern.exec(result);

    const nextProtectedIndex = protectedMatch?.index ?? Number.POSITIVE_INFINITY;
    const nextEnvironmentIndex =
      environmentMatch?.index ?? Number.POSITIVE_INFINITY;

    if (
      nextProtectedIndex === Number.POSITIVE_INFINITY &&
      nextEnvironmentIndex === Number.POSITIVE_INFINITY
    ) {
      output += result.slice(cursor);
      break;
    }

    if (nextProtectedIndex <= nextEnvironmentIndex) {
      if (nextProtectedIndex > cursor) {
        output += result.slice(cursor, nextProtectedIndex);
      }
      output += protectedMatch![0];
      cursor = nextProtectedIndex + protectedMatch![0].length;
      continue;
    }

    if (nextEnvironmentIndex > cursor) {
      output += result.slice(cursor, nextEnvironmentIndex);
    }

    const environmentStart = environmentMatch![0];
    const environmentName = environmentMatch![1];
    const environmentEndToken = `\\end{${environmentName}}`;
    const environmentEndIndex = result.indexOf(
      environmentEndToken,
      environmentPattern.lastIndex,
    );

    if (environmentEndIndex === -1) {
      output += environmentStart;
      cursor = environmentPattern.lastIndex;
      continue;
    }

    const environment = result.slice(
      nextEnvironmentIndex,
      environmentEndIndex + environmentEndToken.length,
    );
    output += wrapMathEnvironment(environment, environmentName);
    cursor = environmentEndIndex + environmentEndToken.length;
  }

  return output;
}


/**
 * Parse content string into segments of plain text, inline math ($...$ or \(...\)),
 * block math ($$...$$ or \[...\]), and images (![alt](url)).
 */
function parseLatex(input: string): Segment[] {
  const cleaned = wrapBareMathRuns(
    wrapBareEnvironments(
      wrapBareLatexCommands(
        normalizeCrossDelimitedMath(
          sanitizeMixedExplicitMath(cleanLatexCommands(input)),
        ),
      ),
    ),
  );
  const segments: Segment[] = [];

  // Replace escaped dollars with a placeholder to avoid false matches
  const ESCAPED_DOLLAR = "\x00ESCAPED_DOLLAR\x00";
  const processed = cleaned.replace(/\\\$/g, ESCAPED_DOLLAR);

  // Combined pattern: images, block math, inline math
  // 1. ![alt](url)
  // 2. $$...$$ block math
  // 3. $...$ inline math
  const pattern = IMAGE_OR_MATH_PARSE_PATTERN;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(processed)) !== null) {
    // Add preceding text segment
    if (match.index > lastIndex) {
      const text = processed
        .slice(lastIndex, match.index)
        .replaceAll(ESCAPED_DOLLAR, "$");
      if (text.trim()) {
        segments.push({ type: "text", value: text });
      }
    }

    if (match[2] !== undefined) {
      // Image: ![alt](url)
      segments.push({ type: "image", value: match[2], alt: match[1] || "" });
    } else if (match[3] !== undefined || match[4] !== undefined) {
      // Block math ($$...$$ or \[...\])
      segments.push({ type: "block-math", value: String(match[3] ?? match[4]).trim() });
    } else if (match[5] !== undefined || match[6] !== undefined) {
      // Inline math ($...$ or \(...\))
      segments.push({ type: "inline-math", value: String(match[5] ?? match[6]).trim() });
    }

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text
  if (lastIndex < processed.length) {
    const text = processed.slice(lastIndex).replaceAll(ESCAPED_DOLLAR, "$");
    if (text.trim()) {
      segments.push({ type: "text", value: text });
    }
  }

  return segments;
}

/**
 * Force subscripts below operators like \lim, \sum, \prod, etc.
 * In inline mode KaTeX places them to the right by default.
 */
function addLimits(latex: string): string {
  if (latex.includes("\\limits")) return latex;
  return latex.replace(
    /\\(lim|sum|prod|max|min|sup|inf|bigcup|bigcap)\s*_/g,
    "\\$1\\limits_",
  );
}

function renderKatex(latex: string, displayMode: boolean): string {
  try {
    const processed = displayMode ? latex : addLimits(latex);
    return katex.renderToString(processed, {
      displayMode,
      throwOnError: false,
      strict: false,
      trust: false,
    });
  } catch {
    // Fallback: show raw LaTeX in a styled span
    return `<code class="text-red-400">${escapeHtml(latex)}</code>`;
  }
}

export function LatexRenderer({ content, className }: LatexRendererProps) {
  const rendered = useMemo(() => {
    if (!content) return [];
    return parseLatex(content);
  }, [content]);

  if (!content) {
    return (
      <span className="text-muted-foreground italic">
        (No content)
      </span>
    );
  }

  return (
    <div className={className} style={{ overflowWrap: 'break-word', wordBreak: 'break-word' }}>
      {rendered.map((segment, i) => {
        if (segment.type === "image") {
          return (
            <div key={i} className="my-3 flex justify-center">
              <img
                src={segment.value}
                alt={segment.alt || "문제 이미지"}
                className="max-h-[400px] max-w-full rounded-lg border border-border object-contain"
                loading="lazy"
              />
            </div>
          );
        }

        if (segment.type === "text") {
          // Preserve newlines in plain text
          const lines = segment.value.split("\n");
          return (
            <span key={i}>
              {lines.map((line, j) => (
                <span key={j}>
                  {j > 0 && <br />}
                  {line}
                </span>
              ))}
            </span>
          );
        }

        if (segment.type === "block-math") {
          return (
            <div
              key={i}
              className="my-3 overflow-x-auto"
              dangerouslySetInnerHTML={{
                __html: renderKatex(segment.value, true),
              }}
            />
          );
        }

        // inline-math
        return (
          <span
            key={i}
            dangerouslySetInnerHTML={{
              __html: renderKatex(segment.value, false),
            }}
          />
        );
      })}
    </div>
  );
}
