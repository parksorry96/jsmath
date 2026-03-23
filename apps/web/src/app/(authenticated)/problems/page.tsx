"use client";

import { Suspense, useState, useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Sparkles, LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { LatexRenderer } from "@/components/math/latex-renderer";
import { ProblemStemDisplay } from "@/components/problems/problem-stem-display";
import { ProblemSourcePreview } from "@/components/problems/problem-source-preview";
import { ProblemPresetBar } from "@/components/problems/problem-preset-bar";
import { ProblemFilterSidebar } from "@/components/problems/problem-filter-sidebar";
import { ProblemToolbar } from "@/components/problems/problem-toolbar";
import { ProblemTableView } from "@/components/problems/problem-table-view";
import { ProblemCardView } from "@/components/problems/problem-card-view";
import { ProblemDeleteDialog } from "@/components/problems/problem-delete-dialog";
import { ProblemChoiceList } from "@/components/problems/problem-choice-list";
import {
  getProblemNumberLabel,
  getProblemSourcePresentation,
} from "@/components/problems/problem-presenters";
import type { Problem, ProblemChoice } from "@/components/problems/problem-types";
import { useProblemFilters } from "@/components/problems/use-problem-filters";
import { PROBLEM_TYPE_LABELS } from "@/components/problems/constants";

interface ProblemsResponse {
  data: Problem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
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
    choices: ProblemChoice[];
    correctChoiceLabel: string | null;
    answerText: string;
    solutionText: string;
  };
}

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

function getVisiblePages(current: number, total: number) {
  const delta = 2;
  const range: number[] = [];
  for (
    let i = Math.max(1, current - delta);
    i <= Math.min(total, current + delta);
    i++
  ) {
    range.push(i);
  }
  return range;
}

/* ------------------------------------------------------------------ */
/*  Main content                                                       */
/* ------------------------------------------------------------------ */

function ProblemsPageContent() {
  const { filters, setFilter, apiQueryString } = useProblemFilters();
  const queryClient = useQueryClient();

  // Selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleteTarget, setDeleteTarget] = useState<string[] | null>(null);

  // Preview dialog state
  const [previewProblem, setPreviewProblem] = useState<Problem | null>(null);
  const [generatedTwin, setGeneratedTwin] =
    useState<TwinProblemResponse | null>(null);

  // Main problems query
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["problems", apiQueryString],
    queryFn: () => api.get<ProblemsResponse>(`/problems?${apiQueryString}`),
  });

  // Twin problem mutation
  const twinMutation = useMutation({
    mutationFn: (problemId: string) =>
      api.post<TwinProblemResponse>(`/problems/${problemId}/generate-twin`),
    onSuccess: (result) => {
      setGeneratedTwin(result);
    },
    onError: (err) => {
      toast.error(
        err instanceof Error
          ? err.message
          : "쌍둥이 문제를 생성하지 못했습니다.",
      );
    },
  });

  const problems = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;
  const currentPage = parseInt(filters.page || "1");

  const activeTwin =
    generatedTwin && generatedTwin.sourceProblemId === previewProblem?.id
      ? generatedTwin
      : null;
  const previewSource = previewProblem
    ? getProblemSourcePresentation(previewProblem)
    : null;
  const previewNumberLabel = previewProblem
    ? getProblemNumberLabel(previewProblem, "문제 미리보기")
    : null;

  // Selection handlers
  const handleSelectAll = useCallback(() => {
    setSelectedIds((prev) =>
      prev.size === problems.length
        ? new Set()
        : new Set(problems.map((p) => p.id)),
    );
  }, [problems]);

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

  return (
    <div className="flex flex-col h-full">
      <ProblemPresetBar totalCount={total} />
      <div className="flex flex-1 min-h-0">
        <ProblemFilterSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <ProblemToolbar
            selectedCount={selectedIds.size}
            totalCount={problems.length}
            allSelected={
              selectedIds.size === problems.length && problems.length > 0
            }
            onSelectAll={handleSelectAll}
            onDeselectAll={() => setSelectedIds(new Set())}
            onDeleteSelected={() => setDeleteTarget([...selectedIds])}
          />

          {isLoading ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="animate-pulse text-muted-foreground">
                로딩 중...
              </div>
            </div>
          ) : isError ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center text-destructive">
                <p className="text-lg font-medium">문제를 불러오지 못했습니다</p>
                <p className="text-sm mt-1 text-muted-foreground">
                  {error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다"}
                </p>
              </div>
            </div>
          ) : problems.length === 0 ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center text-muted-foreground">
                <p className="text-lg font-medium">검색 결과가 없습니다</p>
                <p className="text-sm mt-1">필터 조건을 변경해보세요</p>
              </div>
            </div>
          ) : filters.viewMode === "card" ? (
            <ProblemCardView
              problems={problems}
              selectedIds={selectedIds}
              onSelectionChange={setSelectedIds}
              onPreview={openPreview}
              onDelete={(id) => setDeleteTarget([id])}
            />
          ) : (
            <ProblemTableView
              problems={problems}
              selectedIds={selectedIds}
              onSelectionChange={setSelectedIds}
              onPreview={openPreview}
              onDelete={(id) => setDeleteTarget([id])}
            />
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="border-t px-5 py-3 flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                {(currentPage - 1) * 20 + 1}-
                {Math.min(currentPage * 20, total)} /{" "}
                {total.toLocaleString()} 문항
              </span>
              <div className="flex gap-1">
                <button
                  onClick={() =>
                    setFilter("page", String(currentPage - 1))
                  }
                  disabled={currentPage <= 1}
                  className="px-2 py-1 text-xs rounded bg-muted text-muted-foreground disabled:opacity-50"
                >
                  이전
                </button>
                {getVisiblePages(currentPage, totalPages).map((pageNum) => (
                  <button
                    key={pageNum}
                    onClick={() => setFilter("page", String(pageNum))}
                    className={cn(
                      "px-2 py-1 text-xs rounded",
                      currentPage === pageNum
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    {pageNum}
                  </button>
                ))}
                <button
                  onClick={() =>
                    setFilter("page", String(currentPage + 1))
                  }
                  disabled={currentPage >= totalPages}
                  className="px-2 py-1 text-xs rounded bg-muted text-muted-foreground disabled:opacity-50"
                >
                  다음
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Preview Dialog */}
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
                    {previewNumberLabel}
                  </span>
                  <Badge variant="outline">
                    {previewSource?.title}
                  </Badge>
                </DialogTitle>
                <DialogDescription>
                  {previewSource?.detail}
                </DialogDescription>
              </DialogHeader>
              <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
                <div className="space-y-6">
                  <ProblemSourcePreview assets={previewProblem.assets} />

                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                        OCR 추출 문제
                      </p>
                    </div>
                    <div className="rounded-xl border border-border bg-brand-dark p-5">
                      <ProblemStemDisplay
                        stemLatex={previewProblem.stemLatex}
                        stemText={previewProblem.stemText}
                        layout={previewProblem.bbox}
                        className="text-sm leading-relaxed text-foreground"
                      />

                      <ProblemChoiceList
                        keyPrefix={previewProblem.id}
                        choices={previewProblem.choices}
                        className="mt-5 space-y-2.5 border-t border-border pt-4"
                        itemClassName="flex items-start gap-2 text-sm"
                        labelClassName="shrink-0 font-medium text-brand-beige"
                        contentClassName="leading-relaxed"
                      />
                    </div>
                  </div>

                  <div className="space-y-4 rounded-2xl border border-border bg-card/80 p-5">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                          GPT 쌍둥이 문제
                        </p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          같은 개념과 난이도를 유지하면서 조건을 바꾼 새 문항을
                          생성합니다.
                        </p>
                      </div>
                      <Button
                        onClick={() =>
                          twinMutation.mutate(previewProblem.id)
                        }
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
                            {PROBLEM_TYPE_LABELS[
                              activeTwin.problem.problemType
                            ] ?? activeTwin.problem.problemType}
                          </Badge>
                          {activeTwin.problem.subject && (
                            <Badge variant="outline">
                              {activeTwin.problem.subject}
                            </Badge>
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

                          <ProblemChoiceList
                            keyPrefix={activeTwin.sourceProblemId}
                            choices={activeTwin.problem.choices}
                            className="mt-5 space-y-2.5 border-t border-border pt-4"
                            itemClassName="flex items-start gap-2 text-sm"
                            labelClassName="shrink-0 font-medium text-brand-beige"
                            contentClassName="leading-relaxed"
                          />
                        </div>

                        <div className="rounded-xl border border-border bg-brand-dark/50 p-4">
                          <div className="flex items-center gap-3">
                            <p className="text-xs font-medium text-muted-foreground">
                              정답
                            </p>
                            {activeTwin.problem.correctChoiceLabel && (
                              <Badge variant="outline" className="text-xs">
                                {activeTwin.problem.correctChoiceLabel}
                              </Badge>
                            )}
                            <LatexRenderer
                              content={activeTwin.problem.answerText}
                              className="text-sm font-medium"
                            />
                          </div>
                          <div className="mt-4 border-t border-border pt-4">
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

      {/* Delete Dialog */}
      <ProblemDeleteDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        problemIds={deleteTarget ?? []}
        onSuccess={() => {
          setDeleteTarget(null);
          setSelectedIds(new Set());
          queryClient.invalidateQueries({ queryKey: ["problems"] });
        }}
      />
    </div>
  );
}

export default function ProblemsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex-1 flex items-center justify-center">
          <div className="animate-pulse text-muted-foreground">로딩 중...</div>
        </div>
      }
    >
      <ProblemsPageContent />
    </Suspense>
  );
}
