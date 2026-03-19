"use client";

import { Eye, Trash2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  formatExamSource,
  getPosition,
  getCorrectRateColor,
  POSITION_LABELS,
  POSITION_COLORS,
} from "./constants";

interface ProblemExamMeta {
  examYear: number;
  examMonth: number;
  examType: string;
  subject: string;
  questionNumber: number;
  correctAnswer: string | null;
  correctRate: number | null;
  pointValue: number | null;
  choiceRates: Record<string, number> | null;
  isCommon: boolean | null;
}

interface Problem {
  id: string;
  displayNumber: string | null;
  problemNumber: string | null;
  stemText: string;
  stemLatex: string;
  problemType: string;
  reviewStatus: string;
  gradeLevel: string | null;
  subject: string | null;
  unitMajor: string | null;
  unitMinor: string | null;
  difficulty: number | null;
  classificationConfidence: number | null;
  sourceFile: string | null;
  startPage: number | null;
  createdAt: string;
  similarity?: number;
  choices?: Array<{
    label?: string;
    contentText?: string;
    contentLatex?: string;
  }>;
  assets?: Array<{
    id: string;
    kind: string;
    s3Key: string;
  }>;
  bookSource?: {
    title?: string;
    chapter?: string;
    section?: string;
  } | null;
  examMeta?: ProblemExamMeta | null;
}

interface ProblemCardViewProps {
  problems: Problem[];
  selectedIds: Set<string>;
  onSelectionChange: (ids: Set<string>) => void;
  onPreview: (problem: Problem) => void;
  onDelete: (id: string) => void;
}

const PROBLEM_TYPE_LABELS: Record<string, string> = {
  multiple_choice: "객관식",
  short_answer: "주관식",
  essay: "서술형",
};

const REVIEW_STATUS_STYLES: Record<string, { label: string; className: string }> = {
  approved: {
    label: "승인",
    className: "bg-green-900/30 text-green-400 border-green-400/30",
  },
  pending_review: {
    label: "검수대기",
    className: "bg-yellow-900/30 text-yellow-400 border-yellow-400/30",
  },
  rejected: {
    label: "반려",
    className: "bg-red-900/30 text-red-400 border-red-400/30",
  },
  auto_approved: {
    label: "자동승인",
    className: "bg-green-900/30 text-green-400 border-green-400/30",
  },
};

function difficultyLabel(d: number | null): string | null {
  if (d === null) return null;
  if (d <= 1) return "기초";
  if (d <= 2) return "쉬움";
  if (d <= 3) return "보통";
  if (d <= 4) return "어려움";
  if (d <= 5) return "최상";
  return "최상";
}

function difficultyColor(d: number | null): string {
  if (d === null) return "";
  if (d <= 1) return "bg-green-900/30 text-green-400";
  if (d <= 2) return "bg-emerald-900/30 text-emerald-400";
  if (d <= 3) return "bg-yellow-900/30 text-yellow-400";
  if (d <= 4) return "bg-orange-900/30 text-orange-400";
  return "bg-red-900/30 text-red-400";
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
        const examSource = p.examMeta
          ? formatExamSource(
              p.examMeta.examYear,
              p.examMeta.examMonth,
              p.examMeta.examType,
              p.examMeta.questionNumber,
              p.examMeta.subject,
            )
          : null;

        const correctRate = p.examMeta?.correctRate ?? null;
        const position = getPosition(correctRate);
        const diffLabel = difficultyLabel(p.difficulty);

        const reviewInfo = REVIEW_STATUS_STYLES[p.reviewStatus] ?? {
          label: p.reviewStatus,
          className: "bg-muted text-muted-foreground",
        };

        const sourceLabel =
          examSource && examSource.line1
            ? examSource.line1
            : p.bookSource?.title || p.sourceFile || null;

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
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-dark text-sm font-bold text-brand-beige">
                  {p.displayNumber || p.problemNumber || "?"}
                </div>
                <div className="min-w-0 flex-1">
                  {sourceLabel && (
                    <p className="text-sm font-medium truncate">{sourceLabel}</p>
                  )}
                  {examSource?.line2 && (
                    <p className="text-xs text-muted-foreground truncate">
                      {examSource.line2}
                    </p>
                  )}
                  {!sourceLabel && (
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

                {correctRate !== null && (
                  <span
                    className={`text-[10px] font-medium ${getCorrectRateColor(correctRate)}`}
                  >
                    {(correctRate * 100).toFixed(0)}%
                  </span>
                )}

                {position && (
                  <Badge
                    variant="outline"
                    className={`text-[10px] ${POSITION_COLORS[position]}`}
                  >
                    {POSITION_LABELS[position]}
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
