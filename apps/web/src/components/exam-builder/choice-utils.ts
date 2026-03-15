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

const CHOICE_PREFIX_PATTERN = /^\s*(?:\(\d+\)|\d+[.)]|[①②③④⑤⑥⑦⑧⑨⑩])\s*/u;
const INLINE_CHOICE_PATTERN = /\(\s*([1-5])\s*\)|([①②③④⑤])/gu;
const CIRCLED_CHOICE_LABELS = ["", "①", "②", "③", "④", "⑤"];
const CIRCLED_TO_POSITION: Record<string, number> = {
  "①": 1,
  "②": 2,
  "③": 3,
  "④": 4,
  "⑤": 5,
};

interface ParsedInlineChoices {
  choices: Array<{ content: string; position: number }>;
  stem: string;
}

export function stripChoicePrefix(content: string | null | undefined): string {
  const normalized = (content ?? "").trim();
  if (!normalized) {
    return "";
  }

  const stripped = normalized.replace(CHOICE_PREFIX_PATTERN, "").trim();
  return stripped.length > 0 ? stripped : normalized;
}

function normalizeLineEndings(content: string | null | undefined): string {
  return (content ?? "").replace(/\r\n?/g, "\n").trim();
}

function parseInlineChoices(content: string | null | undefined): ParsedInlineChoices | null {
  const normalized = normalizeLineEndings(content);
  if (!normalized) {
    return null;
  }

  const matches = Array.from(normalized.matchAll(INLINE_CHOICE_PATTERN)).map((match) => ({
    index: match.index ?? 0,
    marker: match[0],
    position: match[1] ? Number(match[1]) : CIRCLED_TO_POSITION[match[2] ?? ""] ?? 0,
  }));

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
        content: normalized.slice(match.index + match.marker.length, nextIndex).trim(),
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

function isSpreadChoiceContent(content: string): boolean {
  const normalized = stripChoicePrefix(content).replace(/\s+/g, " ").trim();
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

function resolveChoiceLayout(choices: ResolvedChoice[]): "spread" | "stacked" {
  if (choices.length < 4 || choices.length > 5) {
    return "stacked";
  }

  return choices.every((choice) =>
    isSpreadChoiceContent(choice.contentLatex || choice.contentText || choice.content),
  )
    ? "spread"
    : "stacked";
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
        label:
          (choice.label ?? "").trim() ||
          CIRCLED_CHOICE_LABELS[position] ||
          `(${position})`,
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

  const latexSplit = parseInlineChoices(problem.stemLatex);
  const textSplit = parseInlineChoices(problem.stemText);
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
        label: CIRCLED_CHOICE_LABELS[position] || `(${position})`,
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
