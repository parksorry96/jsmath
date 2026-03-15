"use client";

import { resolveProblemChoices } from "@/components/exam-builder/choice-utils";
import { LatexRenderer } from "@/components/math/latex-renderer";

export interface Problem {
  id: string;
  displayNumber: string | null;
  problemNumber: string | null;
  stemText: string;
  stemLatex: string;
  problemType: string;
  difficulty: number | null;
  subject: string | null;
  unitMajor: string | null;
  choices?: {
    label: string;
    contentLatex: string;
    contentText: string;
    position: number;
  }[];
  answerText?: string | null;
}

export interface ExamPreviewPageProps {
  problems: Problem[];
  startIndex: number;
  problemsPerPage: number;
  pageNumber: number;
  totalPages: number;
  title: string;
  docType: "exam" | "workbook";
  schoolName?: string;
  examDate?: string;
  duration?: string;
  showNameField?: boolean;
  showHeader?: boolean;
}

const CIRCLED_NUMBERS = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩"];

function ProblemChoices({
  choices,
  layout,
}: {
  choices: ReturnType<typeof resolveProblemChoices>["choices"];
  layout: ReturnType<typeof resolveProblemChoices>["choiceLayout"];
}) {
  if (choices.length === 0) {
    return null;
  }

  if (layout === "spread") {
    return (
      <div className="mt-1 ml-4 grid grid-cols-5 gap-x-3 gap-y-1 text-[0.92em]">
        {choices.map((choice) => (
          <div key={`${choice.position}-${choice.label}`} className="flex min-w-0 items-baseline gap-1">
            <span className="shrink-0">{CIRCLED_NUMBERS[choice.position - 1] ?? `(${choice.position})`}</span>
            <LatexRenderer
              content={choice.contentLatex || choice.contentText}
              className="min-w-0"
            />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="mt-1.5 ml-4 flex flex-col gap-1">
      {choices.map((choice, idx) => (
        <div key={`${choice.position}-${choice.label}-${idx}`} className="flex gap-1.5 items-baseline">
          <span className="shrink-0">
            {CIRCLED_NUMBERS[idx] ?? `(${idx + 1})`}
          </span>
          <LatexRenderer
            content={choice.contentLatex || choice.contentText}
            className="min-w-0"
          />
        </div>
      ))}
    </div>
  );
}

/** Layout config per problemsPerPage setting */
function getLayoutConfig(problemsPerPage: number) {
  switch (problemsPerPage) {
    case 2:
      return { columns: 1, textSize: "text-base", gap: "gap-6", choiceGap: "gap-2" };
    case 3:
      return { columns: 1, textSize: "text-sm", gap: "gap-4", choiceGap: "gap-1.5" };
    case 4:
      return { columns: 2, textSize: "text-sm", gap: "gap-3", choiceGap: "gap-1" };
    case 5:
      return { columns: 2, textSize: "text-xs sm:text-sm", gap: "gap-2", choiceGap: "gap-1" };
    case 6:
      return { columns: 2, textSize: "text-xs", gap: "gap-2", choiceGap: "gap-0.5" };
    default:
      return { columns: 2, textSize: "text-sm", gap: "gap-3", choiceGap: "gap-1" };
  }
}

export function ExamPreviewPage({
  problems,
  startIndex,
  problemsPerPage,
  pageNumber,
  totalPages,
  title,
  docType,
  schoolName,
  examDate,
  duration,
  showNameField = true,
  showHeader = false,
}: ExamPreviewPageProps) {
  const layout = getLayoutConfig(problemsPerPage);

  return (
    <div className="w-full aspect-[210/297] bg-white text-black border border-gray-300 shadow-md rounded-sm overflow-hidden flex flex-col">
      {/* Header - page 1 only */}
      {showHeader && (
        <div className="px-8 pt-6 pb-3 border-b border-gray-400">
          <h1 className="text-lg font-bold text-center">{title}</h1>
          <div className="flex items-center justify-between mt-2 text-xs text-gray-600">
            <div className="flex items-center gap-4">
              {schoolName && <span>{schoolName}</span>}
              {examDate && <span>{examDate}</span>}
            </div>
            {duration && <span>{duration}</span>}
          </div>
          {showNameField && (
            <div className="flex items-center gap-2 mt-2 text-xs">
              <span className="text-gray-600">
                {docType === "exam" ? "이름:" : "이름:"}
              </span>
              <div className="flex-1 border-b border-gray-400 min-w-[120px]" />
            </div>
          )}
        </div>
      )}

      {/* Problem content area */}
      <div className={`flex-1 px-8 py-4 overflow-hidden ${layout.textSize}`}>
        {layout.columns === 1 ? (
          <div className={`flex flex-col ${layout.gap}`}>
            {problems.map((problem, i) => (
              <ProblemBlock
                key={problem.id}
                problem={problem}
                number={startIndex + i + 1}
                layout={layout}
              />
            ))}
          </div>
        ) : (
          <div className="columns-2 gap-6 h-full">
            {problems.map((problem, i) => (
              <ProblemBlock
                key={problem.id}
                problem={problem}
                number={startIndex + i + 1}
                layout={layout}
              />
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-8 py-2 text-center text-xs text-gray-400">
        - {pageNumber} / {totalPages} -
      </div>
    </div>
  );
}

function ProblemBlock({
  problem,
  number,
  layout,
}: {
  problem: Problem;
  number: number;
  layout: ReturnType<typeof getLayoutConfig>;
}) {
  const resolvedProblem = resolveProblemChoices(problem);

  return (
    <div
      data-problem-id={problem.id}
      className="break-inside-avoid mb-2"
    >
      {/* Problem stem */}
      <div className="flex gap-1.5">
        <span className="font-bold shrink-0">{number}.</span>
        <div className="min-w-0 flex-1">
          <LatexRenderer
            content={resolvedProblem.stemContent}
            className="leading-relaxed"
          />
        </div>
      </div>

      <ProblemChoices
        choices={resolvedProblem.choices}
        layout={resolvedProblem.choiceLayout}
      />
    </div>
  );
}

export default ExamPreviewPage;
