"use client";

import { Eye, Trash2 } from "lucide-react";
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

interface ProblemTableViewProps {
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

function getCorrectRateBarColor(rate: number): string {
  if (rate < 0.10) return "bg-red-500";
  if (rate <= 0.30) return "bg-orange-500";
  if (rate <= 0.60) return "bg-yellow-500";
  if (rate <= 0.80) return "bg-green-500";
  return "bg-emerald-400";
}

export function ProblemTableView({
  problems,
  selectedIds,
  onSelectionChange,
  onPreview,
  onDelete,
}: ProblemTableViewProps) {
  const allSelected =
    problems.length > 0 && problems.every((p) => selectedIds.has(p.id));

  function handleSelectAll() {
    if (allSelected) {
      onSelectionChange(new Set());
    } else {
      onSelectionChange(new Set(problems.map((p) => p.id)));
    }
  }

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
    <div className="flex-1 overflow-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50 sticky top-0">
            <th className="p-3 w-10">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={handleSelectAll}
                className="accent-primary"
              />
            </th>
            <th className="p-3 text-left font-medium">번호</th>
            <th className="p-3 text-left font-medium">출처</th>
            <th className="p-3 text-left font-medium">단원</th>
            <th className="p-3 text-left font-medium">유형</th>
            <th className="p-3 text-left font-medium">배점</th>
            <th className="p-3 text-left font-medium">정답률</th>
            <th className="p-3 text-left font-medium">포지션</th>
            <th className="p-3 text-left font-medium">검수</th>
            <th className="p-3 text-left font-medium">액션</th>
          </tr>
        </thead>
        <tbody>
          {problems.map((p, index) => {
            const examSource = p.examMeta
              ? formatExamSource(
                  p.examMeta.examYear,
                  p.examMeta.examMonth,
                  p.examMeta.examType,
                  p.examMeta.questionNumber,
                  p.examMeta.subject,
                )
              : null;

            const unitParts = [p.subject, p.unitMajor, p.unitMinor].filter(
              Boolean,
            );

            const correctRate = p.examMeta?.correctRate ?? null;
            const position = getPosition(correctRate);

            const reviewInfo = REVIEW_STATUS_STYLES[p.reviewStatus] ?? {
              label: p.reviewStatus,
              className: "bg-muted text-muted-foreground",
            };

            return (
              <tr
                key={p.id}
                className="border-b hover:bg-muted/30 cursor-pointer"
                onClick={() => onPreview(p)}
              >
                {/* Checkbox */}
                <td className="p-3 w-10">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(p.id)}
                    onChange={() => handleToggle(p.id)}
                    onClick={(e) => e.stopPropagation()}
                    className="accent-primary"
                  />
                </td>

                {/* 번호 */}
                <td className="p-3 font-bold">
                  {p.displayNumber || p.problemNumber || index + 1}
                </td>

                {/* 출처 */}
                <td className="p-3">
                  {examSource ? (
                    <div>
                      <div className="text-sm">{examSource.line1}</div>
                      {examSource.line2 && (
                        <div className="text-xs text-muted-foreground">
                          {examSource.line2}
                        </div>
                      )}
                    </div>
                  ) : (
                    <span className="text-sm">
                      {p.bookSource?.title || p.sourceFile || "\u2014"}
                    </span>
                  )}
                </td>

                {/* 단원 */}
                <td className="p-3">
                  {unitParts.length > 0 ? (
                    <span className="text-xs text-muted-foreground">
                      {unitParts.join(" > ")}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">{"\u2014"}</span>
                  )}
                </td>

                {/* 유형 */}
                <td className="p-3">
                  <Badge variant="outline" className="text-xs">
                    {PROBLEM_TYPE_LABELS[p.problemType] ?? p.problemType}
                  </Badge>
                </td>

                {/* 배점 */}
                <td className="p-3">
                  {p.examMeta?.pointValue
                    ? `${p.examMeta.pointValue}점`
                    : "\u2014"}
                </td>

                {/* 정답률 */}
                <td className="p-3">
                  {correctRate !== null ? (
                    <div className="flex items-center gap-2">
                      <div className="w-16 h-1 rounded-full bg-muted overflow-hidden">
                        <div
                          className={`h-full rounded-full ${getCorrectRateBarColor(correctRate)}`}
                          style={{ width: `${correctRate * 100}%` }}
                        />
                      </div>
                      <span
                        className={`text-xs ${getCorrectRateColor(correctRate)}`}
                      >
                        {(correctRate * 100).toFixed(0)}%
                      </span>
                    </div>
                  ) : (
                    <span className="text-muted-foreground">{"\u2014"}</span>
                  )}
                </td>

                {/* 포지션 */}
                <td className="p-3">
                  {position ? (
                    <Badge
                      variant="outline"
                      className={`text-xs ${POSITION_COLORS[position]}`}
                    >
                      {POSITION_LABELS[position]}
                    </Badge>
                  ) : (
                    <span className="text-muted-foreground">{"\u2014"}</span>
                  )}
                </td>

                {/* 검수 */}
                <td className="p-3">
                  <Badge
                    variant="outline"
                    className={`text-xs ${reviewInfo.className}`}
                  >
                    {reviewInfo.label}
                  </Badge>
                </td>

                {/* 액션 */}
                <td className="p-3">
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={(e) => {
                        e.stopPropagation();
                        onPreview(p);
                      }}
                    >
                      <Eye className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(p.id);
                      }}
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
