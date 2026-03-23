import {
  getChoiceLabel,
  parseInlineChoiceSequence,
  resolveChoiceLayout as resolveSharedChoiceLayout,
  stripChoicePrefix as stripSharedChoicePrefix,
} from "../common/problem-choice-utils";

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

function normalizeLineEndings(value: string): string {
  return repairLatexControlChars(value).replace(/\r\n?/g, "\n");
}

function toFiniteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
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

export function stripChoicePrefix(value: unknown): string {
  return stripSharedChoicePrefix(value, {
    normalizeInput: normalizeLineEndings,
  });
}

function resolveChoiceLayout(choices: PrintableChoice[]): "spread" | "stacked" {
  return resolveSharedChoiceLayout(
    choices.map((choice) => choice.contentLatex || choice.contentText),
  );
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
        label: getChoiceLabel(position, toText(choice.label)),
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

  const latexSplit = parseInlineChoiceSequence(problem.stemLatex, {
    normalizeInput: normalizeLineEndings,
  });
  const textSplit = parseInlineChoiceSequence(problem.stemText, {
    normalizeInput: normalizeLineEndings,
  });
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
          label: getChoiceLabel(position),
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
