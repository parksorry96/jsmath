import {
  resolveProblemChoices,
  type ChoiceSource,
} from "@/components/exam-builder/choice-utils";

export interface ProblemPreviewSource {
  stemText?: string | null;
  stemLatex?: string | null;
  choices?: ChoiceSource[] | null;
}

const HANGUL_PATTERN = /[ㄱ-ㅎㅏ-ㅣ가-힣]/u;
const COMMAND_NAME_PATTERN = /[A-Za-z*]/;
const SIMPLE_MATH_CHAR_PATTERN = /[0-9A-Za-z+\-*/=<>|:;,.']/;
const MATH_PLACEHOLDER = "MATHPREVIEWTOKEN";

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function skipWhitespace(input: string, index: number): number {
  let cursor = index;
  while (cursor < input.length && /\s/.test(input[cursor])) {
    cursor += 1;
  }
  return cursor;
}

function consumeBalanced(
  input: string,
  start: number,
  open: string,
  close: string,
): number {
  if (input[start] !== open) {
    return start;
  }

  let depth = 0;
  for (let index = start; index < input.length; index += 1) {
    const char = input[index];
    if (char === open) {
      depth += 1;
      continue;
    }
    if (char !== close) {
      continue;
    }

    depth -= 1;
    if (depth === 0) {
      return index + 1;
    }
  }

  return input.length;
}

function consumeDelimitedMath(input: string, start: number): number {
  const delimiter = input.startsWith("$$", start) ? "$$" : "$";
  const closingIndex = input.indexOf(delimiter, start + delimiter.length);
  if (closingIndex >= 0) {
    return closingIndex + delimiter.length;
  }

  let cursor = start + delimiter.length;
  while (cursor < input.length) {
    const char = input[cursor];
    if (char === "\n" || HANGUL_PATTERN.test(char)) {
      break;
    }
    cursor += 1;
  }

  return cursor;
}

function consumeMathScript(input: string, start: number): number {
  if (input[start] !== "_" && input[start] !== "^") {
    return start;
  }

  const cursor = skipWhitespace(input, start + 1);
  if (cursor >= input.length) {
    return input.length;
  }

  if (input[cursor] === "{") {
    return consumeBalanced(input, cursor, "{", "}");
  }

  if (input[cursor] === "(") {
    return consumeBalanced(input, cursor, "(", ")");
  }

  let end = cursor;
  while (end < input.length) {
    const char = input[end];
    if (/\s/.test(char) || HANGUL_PATTERN.test(char)) {
      break;
    }
    if (!SIMPLE_MATH_CHAR_PATTERN.test(char)) {
      break;
    }
    end += 1;
  }

  return end;
}

function consumeLatexEnvironment(input: string, start: number): number {
  const match = input.slice(start).match(/^\\begin\{([^}]+)\}/);
  if (!match) {
    return start;
  }

  const environment = match[1];
  const endMarker = `\\end{${environment}}`;
  const endIndex = input.indexOf(endMarker, start + match[0].length);
  if (endIndex >= 0) {
    return endIndex + endMarker.length;
  }

  return input.length;
}

function consumeBareLatexRun(input: string, start: number): number {
  if (input[start] !== "\\") {
    return start;
  }

  let cursor = start;
  let sawCommand = false;

  while (cursor < input.length) {
    const spaced = skipWhitespace(input, cursor);
    if (spaced !== cursor) {
      if (spaced >= input.length || HANGUL_PATTERN.test(input[spaced])) {
        break;
      }
      cursor = spaced;
    }

    if (input.startsWith("\\begin{", cursor)) {
      const environmentEnd = consumeLatexEnvironment(input, cursor);
      if (environmentEnd === cursor) {
        break;
      }
      sawCommand = true;
      cursor = environmentEnd;
      continue;
    }

    if (input[cursor] === "\\") {
      sawCommand = true;
      cursor += 1;
      if (cursor < input.length && COMMAND_NAME_PATTERN.test(input[cursor])) {
        while (cursor < input.length && COMMAND_NAME_PATTERN.test(input[cursor])) {
          cursor += 1;
        }
      } else if (cursor < input.length) {
        cursor += 1;
      }
      continue;
    }

    if (input[cursor] === "_" || input[cursor] === "^") {
      cursor = consumeMathScript(input, cursor);
      continue;
    }

    if (input[cursor] === "{") {
      cursor = consumeBalanced(input, cursor, "{", "}");
      continue;
    }

    if (input[cursor] === "[") {
      cursor = consumeBalanced(input, cursor, "[", "]");
      continue;
    }

    if (input[cursor] === "(") {
      cursor = consumeBalanced(input, cursor, "(", ")");
      continue;
    }

    if (input[cursor] === "$") {
      cursor += input.startsWith("$$", cursor) ? 2 : 1;
      continue;
    }

    if (
      SIMPLE_MATH_CHAR_PATTERN.test(input[cursor]) ||
      "{}[]()".includes(input[cursor])
    ) {
      cursor += 1;
      continue;
    }

    break;
  }

  return sawCommand ? cursor : start;
}

function firstMeaningfulLine(content: string): string {
  const lines = content
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  return lines[0] ?? "";
}

export function stripLatexForPreview(text: string): string {
  const source = text.replace(/!\[[^\]]*]\([^)]*\)/g, " ");
  let output = "";
  let cursor = 0;

  while (cursor < source.length) {
    if (source.startsWith("$$", cursor) || source[cursor] === "$") {
      const end = consumeDelimitedMath(source, cursor);
      if (end > cursor) {
        output += ` ${MATH_PLACEHOLDER} `;
        cursor = end;
        continue;
      }
    }

    if (source.startsWith("\\begin{", cursor)) {
      const end = consumeLatexEnvironment(source, cursor);
      if (end > cursor) {
        output += ` ${MATH_PLACEHOLDER} `;
        cursor = end;
        continue;
      }
    }

    if (source[cursor] === "\\") {
      const end = consumeBareLatexRun(source, cursor);
      if (end > cursor) {
        output += ` ${MATH_PLACEHOLDER} `;
        cursor = end;
        continue;
      }
    }

    output += source[cursor];
    cursor += 1;
  }

  return collapseWhitespace(
    output
      .replace(/\$(?=\s|$)/g, " ")
      .replace(/[_^]\s*(\{[^{}]*\}|[^\s]+)/g, " ")
      .replace(/\\[A-Za-z*]+/g, " ")
      .replace(/[{}]/g, " ")
      .replace(new RegExp(`(?:${MATH_PLACEHOLDER}\\s*){2,}`, "g"), `${MATH_PLACEHOLDER} `)
      .replaceAll(MATH_PLACEHOLDER, "[수식]"),
  );
}

export function buildProblemPreview(
  problem: ProblemPreviewSource,
  maxLength = 100,
): string {
  const resolved = resolveProblemChoices(problem);
  const baseText =
    firstMeaningfulLine(resolved.stemText) ||
    firstMeaningfulLine(resolved.stemLatex);
  const preview = stripLatexForPreview(baseText);

  if (!preview) {
    return "문제";
  }

  if (preview.length <= maxLength) {
    return preview;
  }

  return `${preview.slice(0, maxLength).trimEnd()}...`;
}
