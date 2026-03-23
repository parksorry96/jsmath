import {
  getChoiceLabel,
  parseInlineChoiceSequence,
  resolveChoiceLayout as resolveSharedChoiceLayout,
  stripChoicePrefix as stripSharedChoicePrefix,
} from "@jsmath/shared-types/problem-choice-utils";

export interface ChoiceSource {
  contentLatex?: string | null;
  contentText?: string | null;
  label?: string | null;
  position?: number | null;
}

export interface ResolvedChoice {
  content: string;
  contentLatex: string;
  contentText: string;
  label: string;
  position: number;
}

export interface ResolvedProblemChoices {
  choiceLayout: "spread" | "stacked";
  choices: ResolvedChoice[];
  stemContent: string;
  stemLatex: string;
  stemText: string;
}

export function stripChoicePrefix(content: string | null | undefined): string {
  return stripSharedChoicePrefix(content);
}

function normalizeLineEndings(content: string | null | undefined): string {
  return (content ?? "").replace(/\r\n?/g, "\n").trim();
}

function resolveChoiceLayout(choices: ResolvedChoice[]): "spread" | "stacked" {
  return resolveSharedChoiceLayout(
    choices.map((choice) => choice.contentLatex || choice.contentText || choice.content),
  );
}

function buildResolvedChoices(
  sources: ChoiceSource[] | null | undefined,
): ResolvedChoice[] {
  if (!sources || sources.length === 0) {
    return [];
  }

  return [...sources]
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map((choice, index) => {
      const position = choice.position ?? index + 1;
      const contentLatex = stripChoicePrefix(choice.contentLatex);
      const contentText = stripChoicePrefix(choice.contentText);

      return {
        content: contentLatex || contentText,
        contentLatex,
        contentText,
        label: getChoiceLabel(position, choice.label),
        position,
      };
    });
}

export function resolveProblemChoices(problem: {
  choices?: ChoiceSource[] | null;
  problemType?: string | null;
  stemLatex?: string | null;
  stemText?: string | null;
}): ResolvedProblemChoices {
  const existingChoices = buildResolvedChoices(problem.choices);
  if (existingChoices.length > 0) {
    const stemLatex = normalizeLineEndings(problem.stemLatex);
    const stemText = normalizeLineEndings(problem.stemText);

    return {
      choiceLayout: resolveChoiceLayout(existingChoices),
      choices: existingChoices,
      stemContent: stemLatex || stemText,
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
    const choices = Array.from({ length: derivedCount }, (_, index) => {
      const latexChoice = latexSplit?.choices[index]?.content ?? "";
      const textChoice = textSplit?.choices[index]?.content ?? "";
      const position = latexSplit?.choices[index]?.position ?? textSplit?.choices[index]?.position ?? index + 1;

      return {
        content: stripChoicePrefix(latexChoice || textChoice),
        contentLatex: stripChoicePrefix(latexChoice),
        contentText: stripChoicePrefix(textChoice),
        label: getChoiceLabel(position),
        position,
      };
    }).filter((choice) => choice.content);

    const stemLatex = latexSplit?.stem ?? normalizeLineEndings(problem.stemLatex);
    const stemText = textSplit?.stem ?? normalizeLineEndings(problem.stemText);

    if (choices.length >= 4) {
      return {
        choiceLayout: resolveChoiceLayout(choices),
        choices,
        stemContent: stemLatex || stemText,
        stemLatex,
        stemText,
      };
    }
  }

  const stemLatex = normalizeLineEndings(problem.stemLatex);
  const stemText = normalizeLineEndings(problem.stemText);

  return {
    choiceLayout: "stacked",
    choices: [],
    stemContent: stemLatex || stemText,
    stemLatex,
    stemText,
  };
}
