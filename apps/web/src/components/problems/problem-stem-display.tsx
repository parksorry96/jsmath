"use client";

import { Fragment } from "react";
import { LatexRenderer } from "@/components/math/latex-renderer";
import { cn } from "@/lib/utils";

export interface ProblemStemBlock {
  type: "text" | "boxed_block";
  latex?: string;
  text?: string;
  box_index?: number;
}

export interface ProblemBoxLine {
  text?: string;
  latex?: string;
  row?: number;
  column?: number;
}

export interface ProblemBoxedBlock {
  kind?: string;
  label?: string | null;
  style?: string;
  layout?: string;
  column_count?: number;
  lines?: ProblemBoxLine[];
}

export interface ProblemLayoutMeta {
  boxed_blocks?: ProblemBoxedBlock[];
  structured_stem?: ProblemStemBlock[];
}

interface ProblemStemDisplayProps {
  stemLatex?: string | null;
  stemText?: string | null;
  layout?: ProblemLayoutMeta | null;
  className?: string;
}

function ExamStyleBox({ block }: { block: ProblemBoxedBlock }) {
  const lines = block.lines ?? [];
  const columnCount = Math.max(block.column_count ?? 1, 1);
  const label = block.label?.trim() || (block.kind === "view" ? "보기" : "");

  if (lines.length === 0) {
    return null;
  }

  return (
    <div className="relative my-4 rounded-[20px] border border-[#c8c1a8] bg-[#fbfaf4] px-5 pb-4 pt-5 text-[#2b2418] shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
      {label ? (
        <div className="absolute left-5 top-0 -translate-y-1/2 rounded-md border border-[#c8c1a8] bg-[#fbfaf4] px-2.5 py-0.5 text-[11px] font-semibold text-[#6f674d]">
          {label}
        </div>
      ) : null}

      <div
        className={cn("grid gap-x-6 gap-y-3", columnCount === 1 ? "gap-y-2.5" : "")}
        style={{ gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))` }}
      >
        {lines.map((line, index) => (
          <div
            key={`${block.kind ?? "box"}-${index}`}
            style={{
              gridColumn:
                typeof line.column === "number" ? `${line.column + 1}` : undefined,
              gridRow:
                typeof line.row === "number" ? `${line.row + 1}` : undefined,
            }}
            className="min-w-0 text-[15px] leading-7 text-[#2b2418]"
          >
            <LatexRenderer
              content={line.latex || line.text || ""}
              className="text-[15px] leading-7 text-[#2b2418]"
            />
          </div>
        ))}
      </div>
    </div>
  );
}

export function ProblemStemDisplay({
  stemLatex,
  stemText,
  layout,
  className,
}: ProblemStemDisplayProps) {
  const boxedBlocks = layout?.boxed_blocks ?? [];
  const structuredStem = layout?.structured_stem ?? [];
  const fallbackContent = stemLatex || stemText || "";

  if (boxedBlocks.length === 0 || structuredStem.length === 0) {
    return (
      <LatexRenderer
        content={fallbackContent}
        className={cn("text-sm leading-relaxed text-foreground", className)}
      />
    );
  }

  return (
    <div className={cn("space-y-3", className)}>
      {structuredStem.map((block, index) => {
        if (block.type === "boxed_block") {
          const boxedBlock =
            typeof block.box_index === "number"
              ? boxedBlocks[block.box_index]
              : undefined;
          if (!boxedBlock) {
            return null;
          }
          return <ExamStyleBox key={`boxed-${index}`} block={boxedBlock} />;
        }

        const content = block.latex || block.text || "";
        if (!content.trim()) {
          return null;
        }

        return (
          <Fragment key={`text-${index}`}>
            <LatexRenderer
              content={content}
              className="text-sm leading-relaxed text-foreground"
            />
          </Fragment>
        );
      })}
    </div>
  );
}
