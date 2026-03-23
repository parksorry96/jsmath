import {
  formatExamSource,
  formatProblemNumberLabel,
  formatRawExamSource,
  getCorrectRateBarColor,
  getCorrectRateColor,
  getPosition,
  POSITION_COLORS,
  POSITION_LABELS,
  REVIEW_STATUS_STYLES,
} from "./constants";
import type { Problem } from "./problem-types";

export interface ProblemSourcePresentation {
  line1: string;
  line2: string;
  shortLabel: string | null;
  title: string;
  detail: string;
}

export interface ProblemReviewPresentation {
  label: string;
  className: string;
}

export interface ProblemCorrectRatePresentation {
  correctRate: number | null;
  position: string | null;
  positionLabel: string | null;
  positionClassName: string | null;
  textClassName: string | null;
  barClassName: string | null;
}

export function getProblemSourcePresentation(
  problem: Pick<
    Problem,
    "bookSource" | "examMeta" | "examSource" | "sourceFile" | "subject" | "unitMajor" | "unitMinor"
  >,
): ProblemSourcePresentation {
  const examSource = problem.examMeta
    ? formatExamSource(
        problem.examMeta.examYear,
        problem.examMeta.examMonth,
        problem.examMeta.examType,
        problem.examMeta.questionNumber,
        problem.examMeta.subject,
      )
    : formatRawExamSource(problem.examSource);
  const shortLabel =
    examSource.line1 || problem.bookSource?.title || problem.sourceFile || null;

  return {
    line1: examSource.line1,
    line2: examSource.line2,
    shortLabel,
    title: shortLabel || "출처 미상",
    detail:
      [
        examSource.line2 || problem.bookSource?.chapter || problem.subject,
        problem.bookSource?.section || problem.unitMajor,
      ]
        .filter(Boolean)
        .join(" · ") || problem.unitMinor || "단원 정보 없음",
  };
}

export function getProblemNumberLabel(
  problem: Pick<
    Problem,
    "problemNumber" | "displayNumber" | "examMeta" | "examSource"
  >,
  fallbackLabel = "?",
): string {
  const label = formatProblemNumberLabel(
    problem.problemNumber,
    problem.displayNumber,
    problem.examMeta?.isCommon || problem.examSource?.isCommon
      ? null
      : (problem.examMeta?.subject ?? problem.examSource?.subject ?? null),
  );

  return label === "?" ? fallbackLabel : label;
}

export function getProblemUnitPath(
  problem: Pick<Problem, "subject" | "unitMajor" | "unitMinor">,
): string | null {
  const parts = [problem.subject, problem.unitMajor, problem.unitMinor].filter(
    Boolean,
  );
  return parts.length > 0 ? parts.join(" > ") : null;
}

export function getProblemReviewPresentation(
  problem: Pick<Problem, "reviewStatus">,
): ProblemReviewPresentation {
  return REVIEW_STATUS_STYLES[problem.reviewStatus] ?? {
    label: problem.reviewStatus,
    className: "bg-muted text-muted-foreground",
  };
}

export function getProblemCorrectRatePresentation(
  problem: Pick<Problem, "examMeta">,
): ProblemCorrectRatePresentation {
  const correctRate = problem.examMeta?.correctRate ?? null;
  const position = getPosition(correctRate);

  return {
    correctRate,
    position,
    positionLabel: position ? POSITION_LABELS[position] : null,
    positionClassName: position ? POSITION_COLORS[position] : null,
    textClassName:
      correctRate !== null ? getCorrectRateColor(correctRate) : null,
    barClassName: correctRate !== null ? getCorrectRateBarColor(correctRate) : null,
  };
}
