import { ProblemType } from "@prisma/client";

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

const CIRCLED_CHOICE_LABELS = ["", "①", "②", "③", "④", "⑤"];
const CIRCLED_TO_POSITION: Record<string, number> = {
  "①": 1,
  "②": 2,
  "③": 3,
  "④": 4,
  "⑤": 5,
};

const CHOICE_PREFIX_PATTERN =
  /^\s*(?:\\textcircled\{\s*[1-5]\s*\}|\\circled\{\s*[1-5]\s*\}|(?:\(|（)\s*[1-5]\s*(?:\)|）)|[1-5][.)]|[①②③④⑤])\s*/u;
const INLINE_CHOICE_PATTERN =
  /(^|[\s])(\\textcircled\{\s*[1-5]\s*\}|\\circled\{\s*[1-5]\s*\}|(?:\(|（)\s*[1-5]\s*(?:\)|）)|[①②③④⑤]|[1-5][.)])/gmu;

function normalizeLineEndings(content: string | null | undefined): string {
  return (content ?? "").replace(/\r\n?/g, "\n").trim();
}

function stripChoicePrefix(content: string | null | undefined): string {
  const normalized = normalizeLineEndings(content);
  if (!normalized) {
    return "";
  }

  const stripped = normalized.replace(CHOICE_PREFIX_PATTERN, "").trim();
  return stripped.length > 0 ? stripped : normalized;
}

function resolveMarkerPosition(marker: string): number {
  if (marker in CIRCLED_TO_POSITION) {
    return CIRCLED_TO_POSITION[marker];
  }

  const match = marker.match(
    /\\textcircled\{\s*([1-5])\s*\}|\\circled\{\s*([1-5])\s*\}|(?:\(|（)\s*([1-5])\s*(?:\)|）)|([1-5])[.)]/u,
  );
  if (!match) {
    return 0;
  }

  for (let index = 1; index <= 4; index += 1) {
    if (match[index]) {
      return Number(match[index]);
    }
  }

  return 0;
}

function parseInlineChoices(content: string | null | undefined): ParsedInlineChoiceSet | null {
  const normalized = normalizeLineEndings(content);
  if (!normalized) {
    return null;
  }

  const matches = Array.from(normalized.matchAll(INLINE_CHOICE_PATTERN)).map((match) => ({
    index: (match.index ?? 0) + (match[1]?.length ?? 0),
    marker: match[2],
    position: resolveMarkerPosition(match[2]),
  }));

  if (matches.length < 4) {
    return null;
  }

  for (let start = 0; start < matches.length; start += 1) {
    if (matches[start].position !== 1) {
      continue;
    }

    const sequence: typeof matches = [];
    let expectedPosition = 1;
    for (const candidate of matches.slice(start)) {
      if (candidate.position === expectedPosition) {
        sequence.push(candidate);
        expectedPosition += 1;
        if (expectedPosition > 5) {
          break;
        }
        continue;
      }

      if (sequence.length > 0) {
        break;
      }
    }

    if (sequence.length < 4) {
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
        content: stripChoicePrefix(
          normalized.slice(match.index + match.marker.length, nextIndex),
        ),
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
        label:
          (typeof record.label === "string" && record.label.trim()) ||
          CIRCLED_CHOICE_LABELS[position] ||
          `(${position})`,
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
  const latexSplit = parseInlineChoices(stemLatex);
  const textSplit = parseInlineChoices(stemText);
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
      label: CIRCLED_CHOICE_LABELS[position] || `(${position})`,
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
  const stemLatex = normalizeLineEndings(
    typeof problem.stemLatex === "string" ? problem.stemLatex : null,
  );
  const stemText = normalizeLineEndings(
    typeof problem.stemText === "string" ? problem.stemText : null,
  );
  const existingChoices = normalizeExistingChoices(problem.choices);
  const derived = deriveChoicesFromStem(stemLatex, stemText);
  const choices = existingChoices.length >= 4 ? existingChoices : derived.choices;

  return {
    problemType:
      choices.length >= 4
        ? ProblemType.multiple_choice
        : typeof problem.problemType === "string" &&
            Object.values(ProblemType).includes(problem.problemType as ProblemType)
          ? (problem.problemType as ProblemType)
          : ProblemType.short_answer,
    stemLatex: choices.length >= 4 ? derived.cleanedStemLatex : stemLatex,
    stemText: choices.length >= 4 ? derived.cleanedStemText : stemText,
    choices,
  };
}
