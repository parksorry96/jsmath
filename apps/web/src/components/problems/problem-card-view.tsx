"use client";

import { Eye, Trash2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  PROBLEM_TYPE_LABELS,
  difficultyLabel,
  difficultyColor,
} from "./constants";
import {
  getProblemCorrectRatePresentation,
  getProblemNumberLabel,
  getProblemReviewPresentation,
  getProblemSourcePresentation,
} from "./problem-presenters";
import type { Problem } from "./problem-types";

interface ProblemCardViewProps {
  problems: Problem[];
  selectedIds: Set<string>;
  onSelectionChange: (ids: Set<string>) => void;
  onPreview: (problem: Problem) => void;
  onDelete: (id: string) => void;
}

export function ProblemCardView({
  problems,
  selectedIds,
  onSelectionChange,
  onPreview,
  onDelete,
}: ProblemCardViewProps) {
  function handleToggle(id: string) {
    const next = new Set(selectedIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    onSelectionChange(next);
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 p-4">
      {problems.map((p) => {
        const source = getProblemSourcePresentation(p);
        const correctRateInfo = getProblemCorrectRatePresentation(p);
        const diffLabel = difficultyLabel(p.difficulty);
        const numberLabel = getProblemNumberLabel(p);
        const reviewInfo = getProblemReviewPresentation(p);

        return (
          <Card
            key={p.id}
            className="transition-colors hover:border-brand-beige flex flex-col"
          >
            <CardContent className="flex flex-col flex-1 p-4 gap-3">
              {/* Top row: number badge + checkbox + source */}
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={selectedIds.has(p.id)}
                  onChange={() => handleToggle(p.id)}
                  onClick={(e) => e.stopPropagation()}
                  className="accent-primary mt-1.5 shrink-0"
                />
                <div className="flex min-h-9 min-w-12 shrink-0 items-center justify-center rounded-lg bg-brand-dark px-2 text-xs font-bold text-brand-beige">
                  {numberLabel}
                </div>
                <div className="min-w-0 flex-1">
                  {source.shortLabel && (
                    <p className="text-sm font-medium truncate">{source.shortLabel}</p>
                  )}
                  {source.line2 && (
                    <p className="text-xs text-muted-foreground truncate">
                      {source.line2}
                    </p>
                  )}
                  {!source.shortLabel && (
                    <p className="text-sm text-muted-foreground">출처 미상</p>
                  )}
                </div>
              </div>

              {/* Stem preview */}
              <p className="text-xs text-muted-foreground line-clamp-2 min-h-[2.5rem]">
                {p.stemText || p.stemLatex || "내용 없음"}
              </p>

              {/* Badges row */}
              <div className="flex flex-wrap items-center gap-1.5 mt-auto">
                <Badge variant="outline" className="text-[10px]">
                  {PROBLEM_TYPE_LABELS[p.problemType] ?? p.problemType}
                </Badge>

                {diffLabel && (
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${difficultyColor(p.difficulty)}`}
                  >
                    {diffLabel}
                  </span>
                )}

                {correctRateInfo.correctRate !== null && (
                  <span
                    className={`text-[10px] font-medium ${correctRateInfo.textClassName ?? ""}`}
                  >
                    {(correctRateInfo.correctRate * 100).toFixed(0)}%
                  </span>
                )}

                {correctRateInfo.position && (
                  <Badge
                    variant="outline"
                    className={`text-[10px] ${correctRateInfo.positionClassName ?? ""}`}
                  >
                    {correctRateInfo.positionLabel}
                  </Badge>
                )}

                {p.examMeta?.pointValue && (
                  <Badge variant="outline" className="text-[10px]">
                    {p.examMeta.pointValue}점
                  </Badge>
                )}

                <Badge
                  variant="outline"
                  className={`text-[10px] ${reviewInfo.className}`}
                >
                  {reviewInfo.label}
                </Badge>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 pt-1 border-t border-border">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1 text-xs"
                  onClick={() => onPreview(p)}
                >
                  <Eye className="mr-1 h-3.5 w-3.5" />
                  미리보기
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => onDelete(p.id)}
                  className="text-destructive hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
