"use client";

import { useState } from "react";
import {
  Search,
  FileText,
  Inbox,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Eye,
  Sparkles,
  LoaderCircle,
} from "lucide-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api } from "@/lib/api";
import { LatexRenderer } from "@/components/math/latex-renderer";
import { toast } from "sonner";

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
  bookSource?: {
    title?: string;
    chapter?: string;
    section?: string;
  } | null;
}

interface PaginatedResponse {
  data: Problem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

interface TwinProblemChoice {
  label: string;
  contentText: string;
  contentLatex: string;
}

interface TwinProblemResponse {
  sourceProblemId: string;
  model: string;
  generatedAt: string;
  problem: {
    title: string;
    variationNote: string;
    teacherNote: string;
    problemType: string;
    subject: string | null;
    unitMajor: string | null;
    unitMinor: string | null;
    difficulty: number | null;
    stemText: string;
    stemLatex: string;
    choices: TwinProblemChoice[];
    correctChoiceLabel: string | null;
    answerText: string;
    solutionText: string;
  };
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
  if (d <= 1) return "기초";
  if (d <= 2) return "쉬움";
  if (d <= 3) return "보통";
  if (d <= 4) return "약간 어려움";
  if (d <= 5) return "어려움";
  return "최상";
}

function difficultyColor(d: number | null): string {
  if (d === null) return "";
  if (d <= 1) return "bg-green-900/30 text-green-400";
  if (d <= 2) return "bg-emerald-900/30 text-emerald-400";
  if (d <= 3) return "bg-yellow-900/30 text-yellow-400";
  if (d <= 4) return "bg-orange-900/30 text-orange-400";
  if (d <= 5) return "bg-red-900/30 text-red-400";
  return "bg-purple-900/30 text-purple-400";
}

const PAGE_SIZE = 20;

export default function ProblemsPage() {
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMode, setSearchMode] = useState<"keyword" | "semantic">("keyword");
  const [reviewFilter, setReviewFilter] = useState<string>("");
  const [subjectFilter, setSubjectFilter] = useState<string>("");
  const [gradeLevelFilter, setGradeLevelFilter] = useState<string>("");
  const [difficultyFilter, setDifficultyFilter] = useState<string>("");
  const [bookTitleFilter, setBookTitleFilter] = useState<string>("");
  const [problemTypeFilter, setProblemTypeFilter] = useState<string>("");
  const [examYearFilter, setExamYearFilter] = useState<string>("");
  const [examTypeFilter, setExamTypeFilter] = useState<string>("");
  const [previewProblem, setPreviewProblem] = useState<Problem | null>(null);
  const [generatedTwin, setGeneratedTwin] = useState<TwinProblemResponse | null>(null);

  const { data: filterOptions } = useQuery({
    queryKey: ["problem-filter-options"],
    queryFn: () => api.get<{
      subjects: string[];
      gradeLevels: string[];
      textbooks: { filename: string; bookTitle: string | null }[];
      difficulties: number[];
      problemTypes: string[];
      examYears: number[];
      examTypes: string[];
    }>("/problems/filter-options"),
  });

  const queryString = [
    `page=${page}`,
    `limit=${PAGE_SIZE}`,
    searchQuery && `q=${encodeURIComponent(searchQuery)}`,
    searchMode === "semantic" && searchQuery && `searchMode=semantic`,
    reviewFilter && `reviewStatus=${reviewFilter}`,
    subjectFilter && `subject=${encodeURIComponent(subjectFilter)}`,
    gradeLevelFilter && `gradeLevel=${encodeURIComponent(gradeLevelFilter)}`,
    difficultyFilter && `difficulty=${difficultyFilter}`,
    bookTitleFilter && `bookTitle=${encodeURIComponent(bookTitleFilter)}`,
    problemTypeFilter && `problemType=${problemTypeFilter}`,
    examYearFilter && `examYear=${examYearFilter}`,
    examTypeFilter && `examType=${encodeURIComponent(examTypeFilter)}`,
  ]
    .filter(Boolean)
    .join("&");

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["problems", page, searchQuery, searchMode, reviewFilter, subjectFilter, gradeLevelFilter, difficultyFilter, bookTitleFilter, problemTypeFilter, examYearFilter, examTypeFilter],
    queryFn: () =>
      api.get<PaginatedResponse>(`/problems?${queryString}`),
  });

  const problems = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 0;

  const twinMutation = useMutation({
    mutationFn: (problemId: string) =>
      api.post<TwinProblemResponse>(`/problems/${problemId}/generate-twin`),
    onSuccess: (result) => {
      setGeneratedTwin(result);
    },
    onError: (error) => {
      toast.error(
        error instanceof Error
          ? error.message
          : "쌍둥이 문제를 생성하지 못했습니다.",
      );
    },
  });

  function getProblemSource(problem: Problem) {
    const title = problem.bookSource?.title || problem.sourceFile || "출처 미상";
    const detail = [
      problem.bookSource?.chapter || problem.subject,
      problem.bookSource?.section || problem.unitMajor,
    ]
      .filter(Boolean)
      .join(" · ");

    return {
      title,
      detail: detail || problem.unitMinor || "단원 정보 없음",
      label: problem.displayNumber || problem.problemNumber || null,
    };
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setSearchQuery(searchInput);
    setPage(1);
  }

  function openPreview(problem: Problem) {
    setPreviewProblem(problem);
    setGeneratedTwin(null);
    twinMutation.reset();
  }

  function closePreview() {
    setPreviewProblem(null);
    setGeneratedTwin(null);
    twinMutation.reset();
  }

  const activeTwin =
    generatedTwin && generatedTwin.sourceProblemId === previewProblem?.id
      ? generatedTwin
      : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">문제은행</h1>
        <p className="text-muted-foreground">
          OCR로 추출된 수학 문제를 검색하고 관리합니다.
        </p>
      </div>

      {/* Search mode toggle + Search */}
      <div className="flex items-center gap-2">
        <div className="flex rounded-lg border border-border bg-brand-charcoal p-0.5">
          <button
            type="button"
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              searchMode === "keyword"
                ? "bg-brand-dark text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => { setSearchMode("keyword"); setPage(1); }}
          >
            <Search className="mr-1.5 inline h-3.5 w-3.5" />
            키워드 검색
          </button>
          <button
            type="button"
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              searchMode === "semantic"
                ? "bg-brand-dark text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => { setSearchMode("semantic"); setPage(1); }}
          >
            <Sparkles className="mr-1.5 inline h-3.5 w-3.5" />
            의미 검색
          </button>
        </div>
      </div>

      <form onSubmit={handleSearch} className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={
              searchMode === "semantic"
                ? "찾고 싶은 문제 유형을 자연어로 설명하세요"
                : "문제 내용, 단원, 키워드로 검색..."
            }
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

      {/* Advanced Filters */}
      <div className="flex flex-wrap items-center gap-3">
        {filterOptions?.subjects && filterOptions.subjects.length > 0 && (
          <select
            className="rounded-md bg-brand-charcoal border border-transparent px-3 py-1.5 text-sm text-foreground"
            value={subjectFilter}
            onChange={(e) => { setSubjectFilter(e.target.value); setPage(1); }}
          >
            <option value="">과목 전체</option>
            {filterOptions.subjects.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        )}

        {filterOptions?.gradeLevels && filterOptions.gradeLevels.length > 0 && (
          <select
            className="rounded-md bg-brand-charcoal border border-transparent px-3 py-1.5 text-sm text-foreground"
            value={gradeLevelFilter}
            onChange={(e) => { setGradeLevelFilter(e.target.value); setPage(1); }}
          >
            <option value="">학년 전체</option>
            {filterOptions.gradeLevels.map((g) => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
        )}

        {filterOptions?.difficulties && filterOptions.difficulties.length > 0 && (
          <select
            className="rounded-md bg-brand-charcoal border border-transparent px-3 py-1.5 text-sm text-foreground"
            value={difficultyFilter}
            onChange={(e) => { setDifficultyFilter(e.target.value); setPage(1); }}
          >
            <option value="">난이도 전체</option>
            {filterOptions.difficulties.map((d) => (
              <option key={d} value={String(d)}>
                {`${d} (${difficultyLabel(d)})`}
              </option>
            ))}
          </select>
        )}

        {filterOptions?.textbooks && filterOptions.textbooks.length > 0 && (
          <select
            className="rounded-md bg-brand-charcoal border border-transparent px-3 py-1.5 text-sm text-foreground"
            value={bookTitleFilter}
            onChange={(e) => { setBookTitleFilter(e.target.value); setPage(1); }}
          >
            <option value="">교재 전체</option>
            {filterOptions.textbooks.map((t) => (
              <option key={t.filename} value={t.bookTitle || t.filename}>
                {t.bookTitle || t.filename}
              </option>
            ))}
          </select>
        )}

        {filterOptions?.problemTypes && filterOptions.problemTypes.length > 0 && (
          <select
            className="rounded-md bg-brand-charcoal border border-transparent px-3 py-1.5 text-sm text-foreground"
            value={problemTypeFilter}
            onChange={(e) => { setProblemTypeFilter(e.target.value); setPage(1); }}
          >
            <option value="">유형 전체</option>
            {filterOptions.problemTypes.map((pt) => (
              <option key={pt} value={pt}>
                {PROBLEM_TYPE_LABELS[pt] ?? pt}
              </option>
            ))}
          </select>
        )}

        {filterOptions?.examYears && filterOptions.examYears.length > 0 && (
          <select
            className="rounded-md bg-brand-charcoal border border-transparent px-3 py-1.5 text-sm text-foreground"
            value={examYearFilter}
            onChange={(e) => { setExamYearFilter(e.target.value); setPage(1); }}
          >
            <option value="">출제연도 전체</option>
            {filterOptions.examYears.map((y) => (
              <option key={y} value={String(y)}>{y}년</option>
            ))}
          </select>
        )}

        {filterOptions?.examTypes && filterOptions.examTypes.length > 0 && (
          <select
            className="rounded-md bg-brand-charcoal border border-transparent px-3 py-1.5 text-sm text-foreground"
            value={examTypeFilter}
            onChange={(e) => { setExamTypeFilter(e.target.value); setPage(1); }}
          >
            <option value="">시험유형 전체</option>
            {filterOptions.examTypes.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        )}

        {(subjectFilter || gradeLevelFilter || difficultyFilter || bookTitleFilter || problemTypeFilter || examYearFilter || examTypeFilter) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSubjectFilter("");
              setGradeLevelFilter("");
              setDifficultyFilter("");
              setBookTitleFilter("");
              setProblemTypeFilter("");
              setExamYearFilter("");
              setExamTypeFilter("");
              setPage(1);
            }}
          >
            필터 초기화
          </Button>
        )}
      </div>

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
                <CardContent className="flex items-start gap-4 p-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-dark text-sm font-bold text-brand-beige">
                    {problem.displayNumber ||
                      problem.problemNumber ||
                      (page - 1) * PAGE_SIZE + index + 1}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium">
                        {getProblemSource(problem).title}
                      </p>
                      {getProblemSource(problem).label && (
                        <Badge variant="outline" className="shrink-0 text-[10px]">
                          {getProblemSource(problem).label}
                        </Badge>
                      )}
                    </div>
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {getProblemSource(problem).detail}
                    </p>
                    <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                      {problem.bookSource?.title && problem.sourceFile && (
                        <>
                          <span>&middot;</span>
                          <span className="flex items-center gap-1">
                            <FileText className="h-3 w-3" />
                            {problem.sourceFile}
                          </span>
                        </>
                      )}
                      {problem.startPage !== null && (
                        <>
                          <span>&middot;</span>
                          <span>{`p.${problem.startPage}`}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openPreview(problem)}
                    >
                      <Eye className="mr-1 h-4 w-4" />
                      미리보기
                    </Button>
                    {problem.similarity != null && (
                      <span className="rounded-full bg-violet-900/30 px-2 py-0.5 text-xs font-medium text-violet-400">
                        {(problem.similarity * 100).toFixed(1)}%
                      </span>
                    )}
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

      <Dialog
        open={previewProblem !== null}
        onOpenChange={(open) => !open && closePreview()}
      >
        <DialogContent className="flex max-h-[90vh] max-w-4xl flex-col overflow-hidden p-0">
          {previewProblem && (
            <>
              <DialogHeader className="border-b border-border px-6 py-5">
                <DialogTitle className="flex items-center gap-2">
                  <span>
                    {previewProblem.displayNumber ||
                      previewProblem.problemNumber ||
                      "문제 미리보기"}
                  </span>
                  <Badge variant="outline">
                    {getProblemSource(previewProblem).title}
                  </Badge>
                </DialogTitle>
                <DialogDescription>
                  {getProblemSource(previewProblem).detail}
                </DialogDescription>
              </DialogHeader>
              <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
                <div className="space-y-6">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                        원문 문제
                      </p>
                    </div>
                    <div className="rounded-xl border border-border bg-brand-dark p-5">
                      <LatexRenderer
                        content={previewProblem.stemLatex || previewProblem.stemText || ""}
                        className="text-sm leading-relaxed text-foreground"
                      />

                      {previewProblem.choices && previewProblem.choices.length > 0 && (
                        <div className="mt-5 space-y-2.5 border-t border-border pt-4">
                          {previewProblem.choices.map((choice, choiceIndex) => (
                            <div
                              key={`${previewProblem.id}-choice-${choiceIndex}`}
                              className="flex items-start gap-2 text-sm"
                            >
                              <span className="shrink-0 font-medium text-brand-beige">
                                {choice.label || `${choiceIndex + 1}.`}
                              </span>
                              <LatexRenderer
                                content={choice.contentLatex || choice.contentText || ""}
                                className="leading-relaxed"
                              />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="space-y-4 rounded-2xl border border-border bg-card/80 p-5">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                          GPT 쌍둥이 문제
                        </p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          같은 개념과 난이도를 유지하면서 조건을 바꾼 새 문항을 생성합니다.
                        </p>
                      </div>
                      <Button
                        onClick={() => twinMutation.mutate(previewProblem.id)}
                        disabled={twinMutation.isPending}
                      >
                        {twinMutation.isPending ? (
                          <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <Sparkles className="mr-2 h-4 w-4" />
                        )}
                        {activeTwin ? "다시 생성" : "쌍둥이 문제 만들기"}
                      </Button>
                    </div>

                    {twinMutation.isPending && (
                      <div className="space-y-3">
                        <Skeleton className="h-5 w-40" />
                        <Skeleton className="h-24 w-full rounded-xl" />
                        <Skeleton className="h-20 w-full rounded-xl" />
                      </div>
                    )}

                    {activeTwin && (
                      <div className="space-y-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge>{activeTwin.problem.title}</Badge>
                          <Badge variant="outline">{activeTwin.model}</Badge>
                          <Badge variant="outline">
                            {PROBLEM_TYPE_LABELS[activeTwin.problem.problemType] ??
                              activeTwin.problem.problemType}
                          </Badge>
                          {activeTwin.problem.subject && (
                            <Badge variant="outline">{activeTwin.problem.subject}</Badge>
                          )}
                          {difficultyLabel(activeTwin.problem.difficulty) && (
                            <span
                              className={`rounded-full px-2 py-0.5 text-xs font-medium ${difficultyColor(activeTwin.problem.difficulty)}`}
                            >
                              {difficultyLabel(activeTwin.problem.difficulty)}
                            </span>
                          )}
                        </div>

                        <div className="grid gap-3 md:grid-cols-2">
                          <div className="rounded-xl border border-border bg-brand-dark/50 p-4">
                            <p className="text-xs font-medium text-muted-foreground">
                              변형 포인트
                            </p>
                            <p className="mt-2 text-sm leading-relaxed">
                              {activeTwin.problem.variationNote}
                            </p>
                          </div>
                          <div className="rounded-xl border border-border bg-brand-dark/50 p-4">
                            <p className="text-xs font-medium text-muted-foreground">
                              유지한 핵심
                            </p>
                            <p className="mt-2 text-sm leading-relaxed">
                              {activeTwin.problem.teacherNote}
                            </p>
                          </div>
                        </div>

                        <div className="rounded-xl border border-border bg-brand-dark p-5">
                          <LatexRenderer
                            content={
                              activeTwin.problem.stemLatex ||
                              activeTwin.problem.stemText ||
                              ""
                            }
                            className="text-sm leading-relaxed text-foreground"
                          />

                          {activeTwin.problem.choices.length > 0 && (
                            <div className="mt-5 space-y-2.5 border-t border-border pt-4">
                              {activeTwin.problem.choices.map((choice, choiceIndex) => (
                                <div
                                  key={`${activeTwin.sourceProblemId}-twin-choice-${choiceIndex}`}
                                  className="flex items-start gap-2 text-sm"
                                >
                                  <span className="shrink-0 font-medium text-brand-beige">
                                    {choice.label || `${choiceIndex + 1}.`}
                                  </span>
                                  <LatexRenderer
                                    content={choice.contentLatex || choice.contentText || ""}
                                    className="leading-relaxed"
                                  />
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        <div className="grid gap-3 md:grid-cols-2">
                          <div className="rounded-xl border border-border bg-brand-dark/50 p-4">
                            <p className="text-xs font-medium text-muted-foreground">
                              정답
                            </p>
                            {activeTwin.problem.correctChoiceLabel && (
                              <Badge variant="outline" className="mt-2">
                                정답 선지 {activeTwin.problem.correctChoiceLabel}
                              </Badge>
                            )}
                            <LatexRenderer
                              content={activeTwin.problem.answerText}
                              className="mt-3 text-sm leading-relaxed"
                            />
                          </div>
                          <div className="rounded-xl border border-border bg-brand-dark/50 p-4">
                            <p className="text-xs font-medium text-muted-foreground">
                              풀이
                            </p>
                            <LatexRenderer
                              content={activeTwin.problem.solutionText}
                              className="mt-3 text-sm leading-relaxed"
                            />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
