"use client";

import { cn } from "@/lib/utils";
import { Search, Sparkles } from "lucide-react";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/api";
import { EXAM_TYPE_LABELS, EXAM_MONTHS, POSITION_LABELS } from "./constants";
import { useProblemFilters } from "./use-problem-filters";

interface CurriculumNode {
  id: string;
  label: string;
  code: string;
  curriculumYear: number;
  level: number;
  parentId: string | null;
  sortOrder: number;
  gradeLevel: string | null;
}

const EXAM_YEARS = Array.from({ length: 10 }, (_, i) => 2025 - i);

const EXAM_TYPE_OPTIONS = Object.entries(EXAM_TYPE_LABELS).map(
  ([value, label]) => ({ value, label }),
);

const GRADE_OPTIONS = [
  { value: "고1", label: "고1" },
  { value: "고2", label: "고2" },
  { value: "고3", label: "고3" },
];

const POSITION_OPTIONS = Object.entries(POSITION_LABELS).map(
  ([value, label]) => ({ value, label }),
);

const DIFFICULTY_OPTIONS = [
  { value: "1", label: "1 (기초)" },
  { value: "2", label: "2 (쉬움)" },
  { value: "3", label: "3 (보통)" },
  { value: "4", label: "4 (어려움)" },
  { value: "5", label: "5 (최상)" },
];

const POINT_OPTIONS = [
  { value: "2", label: "2점" },
  { value: "3", label: "3점" },
  { value: "4", label: "4점" },
];

const REVIEW_STATUS_OPTIONS = [
  { value: "", label: "전체" },
  { value: "pending_review", label: "검수대기" },
  { value: "approved", label: "승인" },
  { value: "rejected", label: "반려" },
];

const PROBLEM_TYPE_OPTIONS = [
  { value: "multiple_choice", label: "객관식" },
  { value: "short_answer", label: "주관식" },
];

export function ProblemFilterSidebar() {
  const { filters, setFilter, setFilters, resetFilters } =
    useProblemFilters();

  const [searchInput, setSearchInput] = useState(filters.q);

  // Curriculum cascade queries
  const curriculumYear = filters.curriculumYear
    ? Number(filters.curriculumYear)
    : 2015;

  // Track local selection for cascade (derived from curriculumNodeId + queries)
  const [selectedSubjectNode, setSelectedSubjectNode] = useState<string>("");
  const [selectedMajorNode, setSelectedMajorNode] = useState<string>("");
  const [selectedMinorNode, setSelectedMinorNode] = useState<string>("");

  const { data: curriculumSubjects } = useQuery({
    queryKey: ["curriculum-subjects", curriculumYear],
    queryFn: () =>
      api.get<CurriculumNode[]>(
        `/curriculum/subjects?year=${curriculumYear}`,
      ),
  });

  const { data: majorUnits } = useQuery({
    queryKey: ["curriculum-children", selectedSubjectNode],
    queryFn: () =>
      api.get<CurriculumNode[]>(
        `/curriculum/${selectedSubjectNode}/children`,
      ),
    enabled: !!selectedSubjectNode,
  });

  const { data: minorUnits } = useQuery({
    queryKey: ["curriculum-children", selectedMajorNode],
    queryFn: () =>
      api.get<CurriculumNode[]>(
        `/curriculum/${selectedMajorNode}/children`,
      ),
    enabled: !!selectedMajorNode,
  });

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setFilter("q", searchInput);
  }

  function handleCurriculumYearChange(year: string) {
    setSelectedSubjectNode("");
    setSelectedMajorNode("");
    setSelectedMinorNode("");
    setFilters({ curriculumYear: year, curriculumNodeId: "" });
  }

  function handleSubjectChange(nodeId: string) {
    setSelectedSubjectNode(nodeId);
    setSelectedMajorNode("");
    setSelectedMinorNode("");
    setFilter("curriculumNodeId", nodeId);
  }

  function handleMajorChange(nodeId: string) {
    setSelectedMajorNode(nodeId);
    setSelectedMinorNode("");
    setFilter("curriculumNodeId", nodeId || selectedSubjectNode);
  }

  function handleMinorChange(nodeId: string) {
    setSelectedMinorNode(nodeId);
    setFilter(
      "curriculumNodeId",
      nodeId || selectedMajorNode || selectedSubjectNode,
    );
  }

  function handleReset() {
    setSelectedSubjectNode("");
    setSelectedMajorNode("");
    setSelectedMinorNode("");
    setSearchInput("");
    resetFilters();
  }

  const hasAnyFilter =
    filters.q ||
    filters.examYear ||
    filters.examMonth ||
    filters.examType ||
    filters.gradeLevel ||
    filters.curriculumNodeId ||
    filters.difficulty ||
    filters.position ||
    filters.correctRateMin ||
    filters.correctRateMax ||
    filters.pointValue ||
    filters.reviewStatus ||
    filters.problemType;

  return (
    <div className="w-[260px] border-r overflow-y-auto flex-shrink-0 p-4 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold">필터</span>
        {hasAnyFilter && (
          <button
            onClick={handleReset}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            초기화
          </button>
        )}
      </div>

      {/* Search */}
      <div className="space-y-2">
        <div className="flex rounded-md border border-border bg-muted/30 p-0.5">
          <button
            type="button"
            className={cn(
              "flex-1 rounded px-2 py-1 text-xs font-medium transition-colors",
              filters.searchMode !== "semantic"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
            onClick={() => setFilter("searchMode", "keyword")}
          >
            <Search className="mr-1 inline h-3 w-3" />
            키워드
          </button>
          <button
            type="button"
            className={cn(
              "flex-1 rounded px-2 py-1 text-xs font-medium transition-colors",
              filters.searchMode === "semantic"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
            onClick={() => setFilter("searchMode", "semantic")}
          >
            <Sparkles className="mr-1 inline h-3 w-3" />
            의미
          </button>
        </div>
        <form onSubmit={handleSearch}>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder={
                filters.searchMode === "semantic"
                  ? "자연어로 설명..."
                  : "키워드 검색..."
              }
              className="pl-8 h-8 text-xs"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
          </div>
        </form>
      </div>

      {/* 시험 출처 */}
      <div className="space-y-3">
        <div className="text-xs font-semibold text-muted-foreground mb-2">
          시험 출처
        </div>

        {/* Year */}
        <Select
          value={filters.examYear}
          onValueChange={(v) => setFilter("examYear", v === "__all__" ? "" : v)}
        >
          <SelectTrigger size="sm" className="w-full text-xs">
            <SelectValue placeholder="출제연도" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">연도 전체</SelectItem>
            {EXAM_YEARS.map((y) => (
              <SelectItem key={y} value={String(y)}>
                {y}년
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Month */}
        <div className="flex flex-wrap gap-1.5">
          {EXAM_MONTHS.map((m) => (
            <button
              key={m}
              onClick={() =>
                setFilter(
                  "examMonth",
                  filters.examMonth === String(m) ? "" : String(m),
                )
              }
              className={cn(
                "px-2.5 py-1 rounded text-xs transition-colors",
                filters.examMonth === String(m)
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80",
              )}
            >
              {m}월
            </button>
          ))}
        </div>

        {/* Exam type */}
        <div className="flex flex-wrap gap-1.5">
          {EXAM_TYPE_OPTIONS.map((item) => (
            <button
              key={item.value}
              onClick={() =>
                setFilter(
                  "examType",
                  filters.examType === item.value ? "" : item.value,
                )
              }
              className={cn(
                "px-2.5 py-1 rounded text-xs transition-colors",
                filters.examType === item.value
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>

        {/* Grade */}
        <div className="flex flex-wrap gap-1.5">
          {GRADE_OPTIONS.map((item) => (
            <button
              key={item.value}
              onClick={() =>
                setFilter(
                  "gradeLevel",
                  filters.gradeLevel === item.value ? "" : item.value,
                )
              }
              className={cn(
                "px-2.5 py-1 rounded text-xs transition-colors",
                filters.gradeLevel === item.value
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {/* 교육과정 */}
      <div className="space-y-3">
        <div className="text-xs font-semibold text-muted-foreground mb-2">
          교육과정
        </div>

        {/* Curriculum year toggle */}
        <div className="flex gap-1.5">
          {[2015, 2022].map((y) => (
            <button
              key={y}
              onClick={() => handleCurriculumYearChange(String(y))}
              className={cn(
                "px-2.5 py-1 rounded text-xs transition-colors",
                curriculumYear === y
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80",
              )}
            >
              {y}
            </button>
          ))}
        </div>

        {/* Subject */}
        {curriculumSubjects && curriculumSubjects.length > 0 && (
          <Select
            value={selectedSubjectNode}
            onValueChange={(v) =>
              handleSubjectChange(v === "__all__" ? "" : v)
            }
          >
            <SelectTrigger size="sm" className="w-full text-xs">
              <SelectValue placeholder="과목 전체" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">과목 전체</SelectItem>
              {curriculumSubjects.map((node) => (
                <SelectItem key={node.id} value={node.id}>
                  {node.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* Major unit */}
        {majorUnits && majorUnits.length > 0 && (
          <Select
            value={selectedMajorNode}
            onValueChange={(v) =>
              handleMajorChange(v === "__all__" ? "" : v)
            }
          >
            <SelectTrigger size="sm" className="w-full text-xs">
              <SelectValue placeholder="대단원 전체" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">대단원 전체</SelectItem>
              {majorUnits.map((node) => (
                <SelectItem key={node.id} value={node.id}>
                  {node.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* Minor unit */}
        {minorUnits && minorUnits.length > 0 && (
          <Select
            value={selectedMinorNode}
            onValueChange={(v) =>
              handleMinorChange(v === "__all__" ? "" : v)
            }
          >
            <SelectTrigger size="sm" className="w-full text-xs">
              <SelectValue placeholder="소단원 전체" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">소단원 전체</SelectItem>
              {minorUnits.map((node) => (
                <SelectItem key={node.id} value={node.id}>
                  {node.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* 난이도 · 포지션 */}
      <div className="space-y-3">
        <div className="text-xs font-semibold text-muted-foreground mb-2">
          난이도 · 포지션
        </div>

        {/* Difficulty */}
        <Select
          value={filters.difficulty}
          onValueChange={(v) =>
            setFilter("difficulty", v === "__all__" ? "" : v)
          }
        >
          <SelectTrigger size="sm" className="w-full text-xs">
            <SelectValue placeholder="난이도 전체" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">난이도 전체</SelectItem>
            {DIFFICULTY_OPTIONS.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Position */}
        <div className="flex flex-wrap gap-1.5">
          {POSITION_OPTIONS.map((item) => (
            <button
              key={item.value}
              onClick={() =>
                setFilter(
                  "position",
                  filters.position === item.value ? "" : item.value,
                )
              }
              className={cn(
                "px-2.5 py-1 rounded text-xs transition-colors",
                filters.position === item.value
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>

        {/* Correct rate range */}
        <div className="flex items-center gap-2">
          <Input
            type="number"
            min={0}
            max={100}
            placeholder="정답률 min"
            className="h-8 text-xs"
            value={filters.correctRateMin}
            onChange={(e) => setFilter("correctRateMin", e.target.value)}
          />
          <span className="text-xs text-muted-foreground">~</span>
          <Input
            type="number"
            min={0}
            max={100}
            placeholder="max"
            className="h-8 text-xs"
            value={filters.correctRateMax}
            onChange={(e) => setFilter("correctRateMax", e.target.value)}
          />
        </div>

        {/* Point value */}
        <div className="flex flex-wrap gap-1.5">
          {POINT_OPTIONS.map((item) => (
            <button
              key={item.value}
              onClick={() =>
                setFilter(
                  "pointValue",
                  filters.pointValue === item.value ? "" : item.value,
                )
              }
              className={cn(
                "px-2.5 py-1 rounded text-xs transition-colors",
                filters.pointValue === item.value
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {/* 검수 상태 */}
      <div className="space-y-3">
        <div className="text-xs font-semibold text-muted-foreground mb-2">
          검수 상태
        </div>
        <div className="flex flex-wrap gap-1.5">
          {REVIEW_STATUS_OPTIONS.map((item) => (
            <button
              key={item.value}
              onClick={() => setFilter("reviewStatus", item.value)}
              className={cn(
                "px-2.5 py-1 rounded text-xs transition-colors",
                filters.reviewStatus === item.value
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {/* 문항유형 */}
      <div className="space-y-3">
        <div className="text-xs font-semibold text-muted-foreground mb-2">
          문항유형
        </div>
        <div className="flex flex-wrap gap-1.5">
          {PROBLEM_TYPE_OPTIONS.map((item) => (
            <button
              key={item.value}
              onClick={() =>
                setFilter(
                  "problemType",
                  filters.problemType === item.value ? "" : item.value,
                )
              }
              className={cn(
                "px-2.5 py-1 rounded text-xs transition-colors",
                filters.problemType === item.value
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
