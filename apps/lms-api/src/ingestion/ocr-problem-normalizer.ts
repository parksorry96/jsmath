import { ProblemType } from "@prisma/client";
import {
  getChoiceLabel,
  parseInlineChoiceSequence,
  resolveChoiceMarkerPosition,
  stripChoicePrefix as stripSharedChoicePrefix,
} from "../common/problem-choice-utils";

interface ParsedInlineChoice {
  content: string;
  position: number;
}

interface ParsedInlineChoiceSet {
  choices: ParsedInlineChoice[];
  stem: string;
}

export interface NormalizedProblemChoice {
  position: number;
  label: string;
  contentLatex: string;
  contentText: string;
}

export interface NormalizedOcrProblem {
  problemType: ProblemType;
  stemLatex: string;
  stemText: string;
  choices: NormalizedProblemChoice[];
}

const CHOICE_PREFIX_PATTERN =
  /^\s*(?:\\textcircled\{\s*[1-5]\s*\}|\\circled\{\s*[1-5]\s*\}|(?:\(|（)\s*[1-5]\s*(?:\)|）)|[1-5][.)]|[①②③④⑤])\s*/u;
const IMAGE_MARKDOWN_LINE_PATTERN = /^\s*!\[[^\]]*\]\([^)]+\)\s*$/gmu;
const BARE_URL_LINE_PATTERN = /^\s*https?:\/\/\S+\s*$/gmu;
const STANDALONE_SCORE_LINE_PATTERN = /^\s*\[\s*\d+\s*점\s*\]\s*$/u;
const LEADING_PROBLEM_NUMBER_PATTERN = /^\s*\d{1,3}\s*[.．](?!\d)\s*/u;

function normalizeLineEndings(content: string | null | undefined): string {
  return (content ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(IMAGE_MARKDOWN_LINE_PATTERN, "")
    .replace(BARE_URL_LINE_PATTERN, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripLeadingProblemNumber(content: string | null | undefined): string {
  const normalized = normalizeLineEndings(content);
  if (!normalized) {
    return "";
  }

  const [firstLine, ...rest] = normalized.split("\n");
  const strippedFirstLine = firstLine.replace(LEADING_PROBLEM_NUMBER_PATTERN, "").trim();

  return [strippedFirstLine, ...rest]
    .filter((line) => line.trim().length > 0)
    .join("\n")
    .trim();
}

function stripChoicePrefix(content: string | null | undefined): string {
  return stripSharedChoicePrefix(content, {
    markerStyle: "latex-aware",
    normalizeInput: normalizeLineEndings,
  });
}

function resolveMarkerPosition(marker: string): number {
  return resolveChoiceMarkerPosition(marker);
}

function isLeadingProblemNumberStemLine(line: string, lineIndex: number): boolean {
  return lineIndex === 0 && /^\s*[1-5]\.(?!\d)\s*\S/u.test(line);
}

function parseChoiceLine(
  line: string,
  lineIndex: number,
): ParsedInlineChoice | null {
  if (isLeadingProblemNumberStemLine(line, lineIndex)) {
    return null;
  }

  const prefixMatch = line.match(CHOICE_PREFIX_PATTERN);
  if (!prefixMatch) {
    return null;
  }

  const position = resolveMarkerPosition(prefixMatch[0].trim());
  if (position === 0) {
    return null;
  }

  return {
    position,
    content: stripChoicePrefix(line),
  };
}

function parseInlineChoices(content: string | null | undefined): ParsedInlineChoiceSet | null {
  return parseInlineChoiceSequence(content, {
    markerStyle: "latex-aware",
    normalizeInput: normalizeLineEndings,
    sequenceMode: "prefix",
  });
}

function parseLineChoices(content: string | null | undefined): ParsedInlineChoiceSet | null {
  const normalized = normalizeLineEndings(content);
  if (!normalized) {
    return null;
  }

  const lines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 5) {
    return null;
  }

  const choiceStarts = lines
    .map((line, lineIndex) => {
      const parsed = parseChoiceLine(line, lineIndex);
      if (!parsed) {
        return null;
      }

      return {
        content: parsed.content,
        lineIndex,
        position: parsed.position,
      };
    })
    .filter(
      (
        choice,
      ): choice is {
        content: string;
        lineIndex: number;
        position: number;
      } => Boolean(choice),
    );

  if (choiceStarts.length < 4) {
    return null;
  }

  let bestWindow:
    | {
        score: number;
        span: number;
        uniqueCount: number;
        starts: Array<{ content: string; lineIndex: number; position: number }>;
      }
    | null = null;

  for (let startIndex = 0; startIndex < choiceStarts.length; startIndex += 1) {
    const uniqueByPosition = new Map<number, { content: string; lineIndex: number; position: number }>();

    for (let endIndex = startIndex; endIndex < choiceStarts.length; endIndex += 1) {
      const candidate = choiceStarts[endIndex];
      if (!uniqueByPosition.has(candidate.position)) {
        uniqueByPosition.set(candidate.position, candidate);
      }

      const orderedPositions = Array.from(uniqueByPosition.keys()).sort((a, b) => a - b);
      const uniqueCount = orderedPositions.length;
      const hasMinimumSequence =
        orderedPositions.length >= 4 &&
        orderedPositions[0] === 1 &&
        orderedPositions[1] === 2 &&
        orderedPositions[2] === 3 &&
        orderedPositions[3] === 4;

      if (!hasMinimumSequence) {
        continue;
      }

      const span = choiceStarts[endIndex].lineIndex - choiceStarts[startIndex].lineIndex;
      const duplicateCount = endIndex - startIndex + 1 - uniqueCount;
      const nonChoiceBetween = span - (endIndex - startIndex);
      const score = uniqueCount * 100 - span * 5 - duplicateCount * 30 - nonChoiceBetween * 10;
      const starts = orderedPositions
        .map((position) => uniqueByPosition.get(position))
        .filter(
          (
            choice,
          ): choice is { content: string; lineIndex: number; position: number } => Boolean(choice),
        )
        .sort((a, b) => a.lineIndex - b.lineIndex);

      if (
        !bestWindow ||
        score > bestWindow.score ||
        (score === bestWindow.score && uniqueCount > bestWindow.uniqueCount) ||
        (score === bestWindow.score &&
          uniqueCount === bestWindow.uniqueCount &&
          span < bestWindow.span)
      ) {
        bestWindow = {
          score,
          span,
          uniqueCount,
          starts,
        };
      }
    }
  }

  if (!bestWindow || bestWindow.starts.length < 4) {
    return null;
  }

  const allChoiceStartLines = new Set(choiceStarts.map((choice) => choice.lineIndex));
  const firstChoiceLine = bestWindow.starts[0].lineIndex;
  const stemLines = lines.filter((line, lineIndex) => {
    if (lineIndex >= firstChoiceLine) {
      return false;
    }
    if (!allChoiceStartLines.has(lineIndex)) {
      return true;
    }
    return isLeadingProblemNumberStemLine(line, lineIndex);
  });
  if (stemLines.length === 0) {
    return null;
  }

  const nextBoundaryByLine = new Map<number, number>();
  for (let index = 0; index < choiceStarts.length; index += 1) {
    const current = choiceStarts[index];
    const next = choiceStarts[index + 1];
    nextBoundaryByLine.set(current.lineIndex, next?.lineIndex ?? lines.length);
  }

  const choices = bestWindow.starts
    .map((choiceStart) => {
      const nextBoundary = nextBoundaryByLine.get(choiceStart.lineIndex) ?? lines.length;
      const parts = [stripChoicePrefix(lines[choiceStart.lineIndex])];
      for (let lineIndex = choiceStart.lineIndex + 1; lineIndex < nextBoundary; lineIndex += 1) {
        if (!STANDALONE_SCORE_LINE_PATTERN.test(lines[lineIndex])) {
          parts.push(lines[lineIndex]);
        }
      }

      const content = parts.join(" ").trim();
      if (!content) {
        return null;
      }

      return {
        content,
        position: choiceStart.position,
      };
    })
    .filter((choice): choice is ParsedInlineChoice => Boolean(choice))
    .sort((a, b) => a.position - b.position);

  if (choices.length < 4) {
    return null;
  }

  return {
    choices,
    stem: stemLines.join("\n").trim(),
  };
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function toPosition(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(1, Math.floor(value));
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.max(1, Math.floor(parsed));
    }
  }

  return fallback;
}

function normalizeExistingChoices(value: unknown): NormalizedProblemChoice[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((choice, index) => {
      const record = toRecord(choice);
      if (!record) {
        return null;
      }

      const position = toPosition(record.position, index + 1);
      const contentLatex = stripChoicePrefix(
        typeof record.contentLatex === "string" ? record.contentLatex : null,
      );
      const contentText = stripChoicePrefix(
        typeof record.contentText === "string" ? record.contentText : null,
      );

      if (!contentLatex && !contentText) {
        return null;
      }

      return {
        position,
        label: getChoiceLabel(
          position,
          typeof record.label === "string" ? record.label : null,
        ),
        contentLatex: contentLatex || contentText,
        contentText: contentText || contentLatex,
      };
    })
    .filter((choice): choice is NormalizedProblemChoice => Boolean(choice))
    .sort((a, b) => a.position - b.position);
}

function deriveChoicesFromStem(
  stemLatex: string,
  stemText: string,
): {
  cleanedStemLatex: string;
  cleanedStemText: string;
  choices: NormalizedProblemChoice[];
} {
  const latexSplit = parseLineChoices(stemLatex) ?? parseInlineChoices(stemLatex);
  const textSplit = parseLineChoices(stemText) ?? parseInlineChoices(stemText);
  const derivedCount =
    latexSplit?.choices.length ?? textSplit?.choices.length ?? 0;

  if (derivedCount < 4) {
    return {
      cleanedStemLatex: stemLatex,
      cleanedStemText: stemText,
      choices: [],
    };
  }

  const choices = Array.from({ length: derivedCount }, (_, index) => {
    const position =
      latexSplit?.choices[index]?.position ??
      textSplit?.choices[index]?.position ??
      index + 1;
    const contentLatex = stripChoicePrefix(latexSplit?.choices[index]?.content);
    const contentText = stripChoicePrefix(textSplit?.choices[index]?.content);

    if (!contentLatex && !contentText) {
      return null;
    }

    return {
      position,
      label: getChoiceLabel(position),
      contentLatex: contentLatex || contentText,
      contentText: contentText || contentLatex,
    };
  }).filter((choice): choice is NormalizedProblemChoice => Boolean(choice));

  return {
    cleanedStemLatex:
      latexSplit?.stem ??
      ((!stemLatex || stemLatex === stemText) && textSplit ? textSplit.stem : stemLatex),
    cleanedStemText: textSplit?.stem ?? stemText,
    choices: choices.length >= 4 ? choices : [],
  };
}

export function normalizeOcrProblem(problem: Record<string, unknown>): NormalizedOcrProblem {
  const stemLatex = stripLeadingProblemNumber(
    typeof problem.stemLatex === "string" ? problem.stemLatex : null,
  );
  const stemText = stripLeadingProblemNumber(
    typeof problem.stemText === "string" ? problem.stemText : null,
  );

  const originalType =
    typeof problem.problemType === "string" &&
    Object.values(ProblemType).includes(problem.problemType as ProblemType)
      ? (problem.problemType as ProblemType)
      : null;

  // Only derive choices from the stem when the problem is already MCQ or unclassified.
  // Explicitly non-MCQ types (short_answer, essay) must not be force-upgraded.
  const allowDeriveFromStem =
    originalType === null ||
    originalType === ProblemType.multiple_choice;

  const existingChoices = normalizeExistingChoices(problem.choices);
  const derived = allowDeriveFromStem
    ? deriveChoicesFromStem(stemLatex, stemText)
    : { cleanedStemLatex: stemLatex, cleanedStemText: stemText, choices: [] as NormalizedProblemChoice[] };
  const choices = existingChoices.length >= 4 ? existingChoices : derived.choices;

  return {
    problemType:
      choices.length >= 4
        ? ProblemType.multiple_choice
        : originalType ?? ProblemType.short_answer,
    stemLatex: stripLeadingProblemNumber(choices.length >= 4 ? derived.cleanedStemLatex : stemLatex),
    stemText: stripLeadingProblemNumber(choices.length >= 4 ? derived.cleanedStemText : stemText),
    choices,
  };
}
