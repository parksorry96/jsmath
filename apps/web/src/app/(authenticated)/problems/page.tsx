"use client";

import { useState } from "react";
import {
  Search,
  FileText,
  Inbox,
  Loader2,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";

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
}

interface PaginatedResponse {
  data: Problem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

const PROBLEM_TYPE_LABELS: Record<string, string> = {
  multiple_choice: "객관식",
  short_answer: "주관식",
  essay: "서술형",
  true_false: "O/X",
};

const REVIEW_STATUS_LABELS: Record<
  string,
  { label: string; className: string }
> = {
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
    className: "bg-blue-900/30 text-blue-400 border-blue-400/30",
  },
};

function difficultyLabel(d: number | null): string | null {
  if (d === null) return null;
  if (d <= 2) return "하";
  if (d <= 4) return "중";
  return "상";
}

function difficultyColor(d: number | null): string {
  if (d === null) return "";
  if (d <= 2) return "bg-green-900/30 text-green-400";
  if (d <= 4) return "bg-yellow-900/30 text-yellow-400";
  return "bg-red-900/30 text-red-400";
}

function stripLatexForPreview(text: string): string {
  return text
    .replace(/\$\$[\s\S]*?\$\$/g, '[수식]')  // block math
    .replace(/\$[^$]+?\$/g, '[수식]')          // inline math
    .replace(/\\[a-zA-Z]+\{[^}]*\}/g, '')     // \command{...}
    .replace(/\\[a-zA-Z]+/g, '')               // \command
    .replace(/[{}]/g, '')                       // stray braces
    .replace(/\s+/g, ' ')                       // collapse whitespace
    .trim();
}

const PAGE_SIZE = 20;

export default function ProblemsPage() {
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [reviewFilter, setReviewFilter] = useState<string>("");

  const queryString = [
    `page=${page}`,
    `limit=${PAGE_SIZE}`,
    searchQuery && `q=${encodeURIComponent(searchQuery)}`,
    reviewFilter && `reviewStatus=${reviewFilter}`,
  ]
    .filter(Boolean)
    .join("&");

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["problems", page, searchQuery, reviewFilter],
    queryFn: () =>
      api.get<PaginatedResponse>(`/problems?${queryString}`),
  });

  const problems = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 0;

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setSearchQuery(searchInput);
    setPage(1);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">문제은행</h1>
        <p className="text-muted-foreground">
          OCR로 추출된 수학 문제를 검색하고 관리합니다.
        </p>
      </div>

      {/* Search + Filters */}
      <form onSubmit={handleSearch} className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="문제 내용, 단원, 키워드로 검색..."
            className="pl-9 bg-brand-charcoal border-transparent"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </div>
        <Button type="submit" variant="secondary">
          <Search className="mr-2 h-4 w-4" />
          검색
        </Button>
      </form>

      {/* Review status filter */}
      <div className="flex items-center gap-2">
        {[
          { value: "", label: "전체" },
          { value: "pending_review", label: "검수대기" },
          { value: "approved", label: "승인" },
          { value: "rejected", label: "반려" },
        ].map((f) => (
          <Button
            key={f.value}
            variant={reviewFilter === f.value ? "default" : "secondary"}
            size="sm"
            onClick={() => {
              setReviewFilter(f.value);
              setPage(1);
            }}
          >
            {f.label}
          </Button>
        ))}
        {total > 0 && (
          <span className="ml-auto text-sm text-muted-foreground">
            총 {total.toLocaleString("ko-KR")}개
          </span>
        )}
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-[72px] rounded-xl" />
          ))}
        </div>
      )}

      {/* Error */}
      {isError && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <AlertCircle className="h-12 w-12 text-destructive" />
            <p className="mt-4 text-lg font-medium">
              문제 목록을 불러오지 못했습니다
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {error instanceof Error ? error.message : "Unknown error"}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Empty */}
      {!isLoading && !isError && problems.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-20">
            <Inbox className="h-16 w-16 text-muted-foreground" />
            <p className="mt-4 text-lg font-medium text-foreground">
              {searchQuery ? "검색 결과가 없습니다" : "등록된 문제가 없습니다"}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {searchQuery
                ? "다른 키워드로 검색해보세요."
                : "PDF를 업로드하면 OCR로 문제가 추출됩니다."}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Problem list */}
      {!isLoading && !isError && problems.length > 0 && (
        <div className="space-y-2">
          {problems.map((problem, index) => {
            const reviewInfo =
              REVIEW_STATUS_LABELS[problem.reviewStatus] ?? {
                label: problem.reviewStatus,
                className: "bg-muted text-muted-foreground",
              };
            const typeLabel =
              PROBLEM_TYPE_LABELS[problem.problemType] ?? problem.problemType;
            const diffLabel = difficultyLabel(problem.difficulty);

            return (
              <Card
                key={problem.id}
                className="transition-colors hover:border-brand-beige"
              >
                <CardContent className="flex items-center gap-4 p-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-dark text-sm font-bold text-brand-beige">
                    {problem.displayNumber ||
                      problem.problemNumber ||
                      (page - 1) * PAGE_SIZE + index + 1}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {stripLatexForPreview(
                        (problem.stemText || problem.stemLatex || "").split("\n")[0].slice(0, 120)
                      )}
                    </p>
                    <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                      {problem.subject && <span>{problem.subject}</span>}
                      {problem.unitMajor && (
                        <>
                          <span>&middot;</span>
                          <span>{problem.unitMajor}</span>
                        </>
                      )}
                      {problem.sourceFile && (
                        <>
                          <span>&middot;</span>
                          <span className="flex items-center gap-1">
                            <FileText className="h-3 w-3" />
                            {problem.sourceFile}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant="outline" className="text-xs">
                      {typeLabel}
                    </Badge>
                    {diffLabel && (
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${difficultyColor(problem.difficulty)}`}
                      >
                        {diffLabel}
                      </span>
                    )}
                    <span
                      className={`rounded-full border px-2 py-0.5 text-xs font-medium ${reviewInfo.className}`}
                    >
                      {reviewInfo.label}
                    </span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
          >
            <ChevronLeft className="h-4 w-4" />
            이전
          </Button>
          <span className="text-sm text-muted-foreground">
            {page} / {totalPages}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
          >
            다음
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
