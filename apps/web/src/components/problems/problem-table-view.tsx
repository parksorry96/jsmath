"use client";

import { Eye, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  PROBLEM_TYPE_LABELS,
} from "./constants";
import {
  getProblemCorrectRatePresentation,
  getProblemNumberLabel,
  getProblemReviewPresentation,
  getProblemSourcePresentation,
  getProblemUnitPath,
} from "./problem-presenters";
import type { Problem } from "./problem-types";

interface ProblemTableViewProps {
  problems: Problem[];
  selectedIds: Set<string>;
  onSelectionChange: (ids: Set<string>) => void;
  onPreview: (problem: Problem) => void;
  onDelete: (id: string) => void;
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
            const source = getProblemSourcePresentation(p);
            const numberLabel = getProblemNumberLabel(p);
            const unitPath = getProblemUnitPath(p);
            const correctRateInfo = getProblemCorrectRatePresentation(p);
            const reviewInfo = getProblemReviewPresentation(p);

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
                  {numberLabel === "?" ? index + 1 : numberLabel}
                </td>

                {/* 출처 */}
                <td className="p-3">
                  {source.line1 ? (
                    <div>
                      <div className="text-sm">{source.line1}</div>
                      {source.line2 && (
                        <div className="text-xs text-muted-foreground">
                          {source.line2}
                        </div>
                      )}
                    </div>
                  ) : (
                    <span className="text-sm">
                      {source.shortLabel || "\u2014"}
                    </span>
                  )}
                </td>

                {/* 단원 */}
                <td className="p-3">
                  {unitPath ? (
                    <span className="text-xs text-muted-foreground">
                      {unitPath}
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
                  {correctRateInfo.correctRate !== null ? (
                    <div className="flex items-center gap-2">
                      <div className="w-16 h-1 rounded-full bg-muted overflow-hidden">
                        <div
                          className={`h-full rounded-full ${correctRateInfo.barClassName ?? ""}`}
                          style={{ width: `${correctRateInfo.correctRate * 100}%` }}
                        />
                      </div>
                      <span
                        className={`text-xs ${correctRateInfo.textClassName ?? ""}`}
                      >
                        {(correctRateInfo.correctRate * 100).toFixed(0)}%
                      </span>
                    </div>
                  ) : (
                    <span className="text-muted-foreground">{"\u2014"}</span>
                  )}
                </td>

                {/* 포지션 */}
                <td className="p-3">
                  {correctRateInfo.position ? (
                    <Badge
                      variant="outline"
                      className={`text-xs ${correctRateInfo.positionClassName ?? ""}`}
                    >
                      {correctRateInfo.positionLabel}
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
