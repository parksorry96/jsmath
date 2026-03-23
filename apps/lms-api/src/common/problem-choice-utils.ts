export type ChoiceLayout = "spread" | "stacked";
export type ChoiceMarkerStyle = "basic" | "latex-aware";
export type InlineChoiceSequenceMode = "exact" | "prefix";

export interface ParsedInlineChoice {
  content: string;
  position: number;
}

export interface ParsedInlineChoiceSequence {
  choices: ParsedInlineChoice[];
  stem: string;
}

export interface ChoiceParsingOptions {
  markerStyle?: ChoiceMarkerStyle;
  normalizeInput?: (value: string) => string;
  sequenceMode?: InlineChoiceSequenceMode;
}

export const CIRCLED_CHOICE_LABELS = ["", "①", "②", "③", "④", "⑤"] as const;

const CIRCLED_TO_POSITION: Record<string, number> = {
  "①": 1,
  "②": 2,
  "③": 3,
  "④": 4,
  "⑤": 5,
};

const BASIC_CHOICE_PREFIX_PATTERN =
  /^\s*(?:\(\d+\)|\d+[.)]|[①②③④⑤⑥⑦⑧⑨⑩])\s*/u;
const LATEX_AWARE_CHOICE_PREFIX_PATTERN =
  /^\s*(?:\\textcircled\{\s*[1-5]\s*\}|\\circled\{\s*[1-5]\s*\}|(?:\(|（)\s*[1-5]\s*(?:\)|）)|[1-5][.)]|[①②③④⑤])\s*/u;

const BASIC_INLINE_CHOICE_PATTERN = /\(\s*([1-5])\s*\)|([①②③④⑤])/gu;
const LATEX_AWARE_INLINE_CHOICE_PATTERN =
  /(^|[\s])(\\textcircled\{\s*[1-5]\s*\}|\\circled\{\s*[1-5]\s*\}|(?:\(|（)\s*[1-5]\s*(?:\)|）)|[①②③④⑤]|[1-5][.)])/gmu;

function getChoicePrefixPattern(markerStyle: ChoiceMarkerStyle) {
  return markerStyle === "latex-aware"
    ? LATEX_AWARE_CHOICE_PREFIX_PATTERN
    : BASIC_CHOICE_PREFIX_PATTERN;
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

function normalizeChoiceInput(
  value: unknown,
  normalizeInput?: (value: string) => string,
): string {
  const text = toText(value);
  return normalizeInput ? normalizeInput(text).trim() : text.trim();
}

function findInlineChoiceMarkers(
  value: string,
  markerStyle: ChoiceMarkerStyle,
) {
  if (markerStyle === "latex-aware") {
    return Array.from(value.matchAll(LATEX_AWARE_INLINE_CHOICE_PATTERN)).map(
      (match) => ({
        index: (match.index ?? 0) + (match[1]?.length ?? 0),
        marker: match[2] ?? "",
        position: resolveChoiceMarkerPosition(match[2] ?? ""),
      }),
    );
  }

  return Array.from(value.matchAll(BASIC_INLINE_CHOICE_PATTERN)).map((match) => ({
    index: match.index ?? 0,
    marker: match[0],
    position: resolveChoiceMarkerPosition(match[0]),
  }));
}

export function resolveChoiceMarkerPosition(marker: string): number {
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

export function getChoiceLabel(position: number, label?: string | null): string {
  return label?.trim() || CIRCLED_CHOICE_LABELS[position] || `(${position})`;
}

export function stripChoicePrefix(
  value: unknown,
  options: ChoiceParsingOptions = {},
): string {
  const normalized = normalizeChoiceInput(value, options.normalizeInput);
  if (!normalized) {
    return "";
  }

  const stripped = normalized
    .replace(getChoicePrefixPattern(options.markerStyle ?? "basic"), "")
    .trim();

  return stripped.length > 0 ? stripped : normalized;
}

export function parseInlineChoiceSequence(
  value: unknown,
  options: ChoiceParsingOptions = {},
): ParsedInlineChoiceSequence | null {
  const markerStyle = options.markerStyle ?? "basic";
  const sequenceMode = options.sequenceMode ?? "exact";
  const normalized = normalizeChoiceInput(value, options.normalizeInput);
  if (!normalized) {
    return null;
  }

  const matches = findInlineChoiceMarkers(normalized, markerStyle);
  if (matches.length < 4) {
    return null;
  }

  for (let start = 0; start < matches.length; start += 1) {
    if (matches[start].position !== 1) {
      continue;
    }

    const sequence =
      sequenceMode === "prefix"
        ? buildPrefixSequence(matches.slice(start))
        : matches.slice(start);

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

function buildPrefixSequence(
  matches: Array<{ index: number; marker: string; position: number }>,
) {
  const sequence: Array<{ index: number; marker: string; position: number }> = [];
  let expectedPosition = 1;

  for (const candidate of matches) {
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

  return sequence;
}

export function isSpreadChoiceContent(
  value: string,
  options: ChoiceParsingOptions = {},
): boolean {
  const normalized = stripChoicePrefix(value, options).replace(/\s+/g, " ").trim();
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

export function resolveChoiceLayout(
  values: string[],
  options: ChoiceParsingOptions = {},
): ChoiceLayout {
  if (values.length < 4 || values.length > 5) {
    return "stacked";
  }

  return values.every((value) => isSpreadChoiceContent(value, options))
    ? "spread"
    : "stacked";
}
