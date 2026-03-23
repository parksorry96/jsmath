"use client";

import { Table2, LayoutGrid } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useProblemFilters } from "./use-problem-filters";

interface ProblemToolbarProps {
  selectedCount: number;
  totalCount: number;
  allSelected: boolean;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onDeleteSelected: () => void;
}

const SORT_OPTIONS = [
  { value: "newest", label: "최신순" },
  { value: "correct_rate_asc", label: "정답률 낮은순" },
  { value: "correct_rate_desc", label: "정답률 높은순" },
  { value: "point_value_desc", label: "배점순" },
];

const ELECTIVE_OPTIONS = [
  { value: "", label: "전체" },
  { value: "확률과 통계", label: "확통" },
  { value: "미적분", label: "미적분" },
  { value: "기하", label: "기하" },
];

export function ProblemToolbar({
  selectedCount,
  totalCount,
  allSelected,
  onSelectAll,
  onDeselectAll,
  onDeleteSelected,
}: ProblemToolbarProps) {
  const { filters, setFilter } = useProblemFilters();

  return (
    <div className="flex items-center gap-3 border-b px-5 py-2">
      {/* Select all */}
      <label className="flex items-center gap-2 text-sm cursor-pointer">
        <input
          type="checkbox"
          checked={allSelected && totalCount > 0}
          onChange={allSelected ? onDeselectAll : onSelectAll}
          className="accent-primary"
        />
        <span className="text-muted-foreground">
          전체선택 ({selectedCount}/{totalCount})
        </span>
      </label>

      {/* Bulk actions */}
      <Button
        variant="destructive"
        size="sm"
        disabled={selectedCount === 0}
        onClick={onDeleteSelected}
      >
        삭제
      </Button>
      <Button variant="outline" size="sm" disabled>
        과제에 추가
      </Button>

      <div className="flex-1" />

      {/* Sort */}
      <Select
        value={filters.sortBy || "newest"}
        onValueChange={(v) => setFilter("sortBy", v)}
      >
        <SelectTrigger size="sm" className="w-auto text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SORT_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="flex items-center gap-1 rounded-md border border-border bg-muted/30 p-0.5">
        {ELECTIVE_OPTIONS.map((opt) => {
          const active = (filters.electiveSubject || "") === opt.value;
          return (
            <button
              key={opt.label}
              type="button"
              className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
                active
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setFilter("electiveSubject", opt.value)}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      {/* View toggle */}
      <div className="flex rounded-md border border-border bg-muted/30 p-0.5">
        <button
          type="button"
          className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
            filters.viewMode !== "card"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => setFilter("viewMode", "table")}
        >
          <Table2 className="mr-1 inline h-3 w-3" />
          테이블
        </button>
        <button
          type="button"
          className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
            filters.viewMode === "card"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => setFilter("viewMode", "card")}
        >
          <LayoutGrid className="mr-1 inline h-3 w-3" />
          카드
        </button>
      </div>
    </div>
  );
}
