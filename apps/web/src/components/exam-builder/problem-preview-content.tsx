"use client";

import { resolveProblemChoices } from "@/components/exam-builder/choice-utils";
import { LatexRenderer } from "@/components/math/latex-renderer";
import { cn } from "@/lib/utils";

export interface ExamBuilderProblem {
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

type ChoiceLayout = ReturnType<typeof resolveProblemChoices>["choiceLayout"];
type ResolvedChoice = ReturnType<typeof resolveProblemChoices>["choices"][number];
type ChoiceVariant = "modal" | "page" | "panel";
type ContentVariant = Exclude<ChoiceVariant, "modal">;

function getChoiceDisplayLabel(choice: ResolvedChoice, index: number) {
  return choice.label || `(${choice.position || index + 1})`;
}

export function ExamBuilderProblemChoices({
  choices,
  layout,
  variant,
}: {
  choices: ResolvedChoice[];
  layout: ChoiceLayout;
  variant: ChoiceVariant;
}) {
  if (choices.length === 0) {
    return null;
  }

  if (variant === "modal") {
    if (layout === "spread") {
      return (
        <div className="grid grid-cols-5 gap-2 rounded-md border border-border bg-brand-charcoal px-3 py-3">
          {choices.map((choice, index) => (
            <div
              key={`${choice.position}-${choice.label}-${index}`}
              className="flex min-w-0 items-baseline gap-1 text-sm"
            >
              <span className="shrink-0 text-brand-beige">
                {getChoiceDisplayLabel(choice, index)}
              </span>
              <LatexRenderer content={choice.contentLatex || choice.contentText} />
            </div>
          ))}
        </div>
      );
    }

    return (
      <div className="space-y-1.5">
        {choices.map((choice, index) => (
          <div
            key={`${choice.position}-${choice.label}-${index}`}
            className="flex items-start gap-2 rounded-md border border-border bg-brand-charcoal px-3 py-2"
          >
            <span className="shrink-0 text-sm font-medium text-brand-beige">
              {getChoiceDisplayLabel(choice, index)}
            </span>
            <div className="text-sm">
              <LatexRenderer content={choice.contentLatex || choice.contentText} />
            </div>
          </div>
        ))}
      </div>
    );
  }

  const spreadWrapperClass =
    variant === "page"
      ? "mt-1 ml-4 grid grid-cols-5 gap-x-3 gap-y-1 text-[0.92em]"
      : "mt-1 ml-3 grid grid-cols-5 gap-x-2 gap-y-1 text-[0.92em]";
  const spreadContentClass = variant === "panel" ? "min-w-0 leading-snug" : "min-w-0";
  const stackedWrapperClass =
    variant === "page"
      ? "mt-1.5 ml-4 flex flex-col gap-1"
      : "mt-0.5 ml-3 flex flex-col gap-px";
  const stackedItemClass =
    variant === "page"
      ? "flex items-baseline gap-1.5"
      : "flex items-baseline gap-1";

  if (layout === "spread") {
    return (
      <div className={spreadWrapperClass}>
        {choices.map((choice, index) => (
          <div
            key={`${choice.position}-${choice.label}-${index}`}
            className="flex min-w-0 items-baseline gap-1"
          >
            <span className="shrink-0">{getChoiceDisplayLabel(choice, index)}</span>
            <LatexRenderer
              content={choice.contentLatex || choice.contentText}
              className={spreadContentClass}
            />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className={stackedWrapperClass}>
      {choices.map((choice, index) => (
        <div
          key={`${choice.position}-${choice.label}-${index}`}
          className={stackedItemClass}
        >
          <span className="shrink-0">{getChoiceDisplayLabel(choice, index)}</span>
          <LatexRenderer
            content={choice.contentLatex || choice.contentText}
            className="min-w-0"
          />
        </div>
      ))}
    </div>
  );
}

export function ExamBuilderProblemContent({
  problem,
  number,
  variant,
  className,
}: {
  problem: ExamBuilderProblem;
  number: number;
  variant: ContentVariant;
  className?: string;
}) {
  const resolvedProblem = resolveProblemChoices(problem);
  const gapClass = variant === "page" ? "flex gap-1.5" : "flex gap-1";
  const stemClass = variant === "page" ? "leading-relaxed" : "leading-snug";

  return (
    <div className={cn("w-full", className)}>
      <div className={gapClass}>
        <span className="shrink-0 font-bold">{number}.</span>
        <div className="min-w-0 flex-1">
          <LatexRenderer content={resolvedProblem.stemContent} className={stemClass} />
        </div>
      </div>

      <ExamBuilderProblemChoices
        choices={resolvedProblem.choices}
        layout={resolvedProblem.choiceLayout}
        variant={variant}
      />
    </div>
  );
}
