"use client";

import { LatexRenderer } from "@/components/math/latex-renderer";
import type { ProblemChoice } from "./problem-types";

interface ProblemChoiceListProps {
  choices: ProblemChoice[] | null | undefined;
  className?: string;
  itemClassName?: string;
  labelClassName?: string;
  contentClassName?: string;
  keyPrefix: string;
}

export function ProblemChoiceList({
  choices,
  className,
  itemClassName = "flex items-start gap-2 text-sm",
  labelClassName = "shrink-0 font-medium text-brand-beige",
  contentClassName = "leading-relaxed",
  keyPrefix,
}: ProblemChoiceListProps) {
  if (!choices || choices.length === 0) {
    return null;
  }

  return (
    <div className={className}>
      {choices.map((choice, choiceIndex) => (
        <div
          key={`${keyPrefix}-choice-${choiceIndex}`}
          className={itemClassName}
        >
          <span className={labelClassName}>
            {choice.label || `${choiceIndex + 1}.`}
          </span>
          <LatexRenderer
            content={choice.contentLatex || choice.contentText || ""}
            className={contentClassName}
          />
        </div>
      ))}
    </div>
  );
}
