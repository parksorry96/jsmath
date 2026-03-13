"use client";

import { useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  Inbox,
  RotateCcw,
  CheckCircle2,
  XCircle,
  BookX,
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
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
import { SolutionViewer } from "@/components/math/solution-viewer";
import { toast } from "sonner";

// --- Types ---

interface WrongAnswer {
  id: string;
  errorType: string;
  resolved: boolean;
  retryCount: number;
  createdAt: string;
  problem: {
    id: string;
    stemText: string;
    stemLatex: string;
    problemType: string;
    difficulty: number | null;
    choices?: Array<{
      label?: string;
      contentText?: string;
      contentLatex?: string;
    }>;
    solutionText?: string | null;
    solutionSteps?: Array<{
      step: number;
      title: string;
      content: string;
      explanation?: string;
    }> | null;
    alternativeSolutions?: Array<{
      method: string;
      steps: Array<{ step: number; title: string; content: string }>;
    }> | null;
  };
}

interface WrongAnswerPaginatedResponse {
  data: WrongAnswer[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

interface WrongAnswerStats {
  conceptGap: number;
  patternGap: number;
  calculationError: number;
  carelessMistake: number;
  resolved: number;
  unresolved: number;
  recentCount: number;
  total: number;
}

// --- Constants ---

const ERROR_TYPE_CONFIG: Record<
  string,
  { label: string; className: string }
> = {
  concept_gap: {
    label: "개념 부족",
    className: "bg-red-900/30 text-red-400 border-red-400/30",
  },
  pattern_gap: {
    label: "패턴 부족",
    className: "bg-orange-900/30 text-orange-400 border-orange-400/30",
  },
  calculation_error: {
    label: "계산 실수",
    className: "bg-yellow-900/30 text-yellow-400 border-yellow-400/30",
  },
  careless_mistake: {
    label: "부주의",
    className: "bg-blue-900/30 text-blue-400 border-blue-400/30",
  },
};

const PAGE_SIZE = 20;

export default function WrongAnswersPage() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [errorTypeFilter, setErrorTypeFilter] = useState<string>("");
  const [resolvedFilter, setResolvedFilter] = useState<string>("");
  const [selectedItem, setSelectedItem] = useState<WrongAnswer | null>(null);
  const [retryMode, setRetryMode] = useState(false);

  // --- Queries ---

  const queryString = [
    `page=${page}`,
    `limit=${PAGE_SIZE}`,
    errorTypeFilter && `errorType=${errorTypeFilter}`,
    resolvedFilter && `resolved=${resolvedFilter}`,
  ]
    .filter(Boolean)
    .join("&");

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["wrong-answers", page, errorTypeFilter, resolvedFilter],
    queryFn: () =>
      api.get<WrongAnswerPaginatedResponse>(`/wrong-answers?${queryString}`),
  });

  const { data: stats } = useQuery({
    queryKey: ["wrong-answers-stats"],
    queryFn: () => api.get<WrongAnswerStats>("/wrong-answers/stats"),
  });

  const items = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 0;

  // --- Mutations ---

  const resolveMutation = useMutation({
    mutationFn: (id: string) =>
      api.patch<void>(`/wrong-answers/${id}/resolve`),
    onSuccess: () => {
      toast.success("해결 완료로 표시했습니다.");
      queryClient.invalidateQueries({ queryKey: ["wrong-answers"] });
      queryClient.invalidateQueries({ queryKey: ["wrong-answers-stats"] });
      setSelectedItem(null);
    },
    onError: (err) => {
      toast.error(
        err instanceof Error ? err.message : "처리에 실패했습니다.",
      );
    },
  });

  const retryMutation = useMutation({
    mutationFn: ({ id, isCorrect }: { id: string; isCorrect: boolean }) =>
      api.post<void>(`/wrong-answers/${id}/retry`, { isCorrect }),
    onSuccess: () => {
      toast.success("재시도 결과를 기록했습니다.");
      queryClient.invalidateQueries({ queryKey: ["wrong-answers"] });
      queryClient.invalidateQueries({ queryKey: ["wrong-answers-stats"] });
      setRetryMode(false);
    },
    onError: (err) => {
      toast.error(
        err instanceof Error ? err.message : "처리에 실패했습니다.",
      );
    },
  });

  // --- Helpers ---

  function formatDate(dateStr: string) {
    return new Date(dateStr).toLocaleDateString("ko-KR", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }

  function openDetail(item: WrongAnswer) {
    setSelectedItem(item);
    setRetryMode(false);
  }

  function closeDetail() {
    setSelectedItem(null);
    setRetryMode(false);
  }

  // --- Render ---

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">오답노트</h1>
        <p className="text-muted-foreground">
          틀린 문제를 유형별로 분석하고 재도전합니다.
        </p>
      </div>

      {/* Stats cards */}
      {stats && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
          {(
            [
              ["concept_gap", stats.conceptGap],
              ["pattern_gap", stats.patternGap],
              ["calculation_error", stats.calculationError],
              ["careless_mistake", stats.carelessMistake],
            ] as const
          ).map(([type, count]) => {
            const config = ERROR_TYPE_CONFIG[type];
            return (
              <Card key={type}>
                <CardContent className="p-4">
                  <p className="text-xs text-muted-foreground">
                    {config.label}
                  </p>
                  <p className="mt-1 text-2xl font-bold">{count}</p>
                </CardContent>
              </Card>
            );
          })}
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">미해결</p>
              <p className="mt-1 text-2xl font-bold text-orange-400">
                {stats.unresolved}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">해결</p>
              <p className="mt-1 text-2xl font-bold text-green-400">
                {stats.resolved}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <select
          className="rounded-md bg-brand-charcoal border border-transparent px-3 py-1.5 text-sm text-foreground"
          value={errorTypeFilter}
          onChange={(e) => {
            setErrorTypeFilter(e.target.value);
            setPage(1);
          }}
        >
          <option value="">오류유형 전체</option>
          {Object.entries(ERROR_TYPE_CONFIG).map(([key, config]) => (
            <option key={key} value={key}>
              {config.label}
            </option>
          ))}
        </select>

        <div className="flex rounded-lg border border-border bg-brand-charcoal p-0.5">
          {[
            { value: "", label: "전체" },
            { value: "false", label: "미해결" },
            { value: "true", label: "해결" },
          ].map((f) => (
            <button
              key={f.value}
              type="button"
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                resolvedFilter === f.value
                  ? "bg-brand-dark text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => {
                setResolvedFilter(f.value);
                setPage(1);
              }}
            >
              {f.label}
            </button>
          ))}
        </div>

        {(errorTypeFilter || resolvedFilter) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setErrorTypeFilter("");
              setResolvedFilter("");
              setPage(1);
            }}
          >
            필터 초기화
          </Button>
        )}

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
              오답 목록을 불러오지 못했습니다
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {error instanceof Error ? error.message : "Unknown error"}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Empty */}
      {!isLoading && !isError && items.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-20">
            <Inbox className="h-16 w-16 text-muted-foreground" />
            <p className="mt-4 text-lg font-medium text-foreground">
              오답이 없습니다
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              퀴즈를 풀면 틀린 문제가 여기에 기록됩니다.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Wrong answer list */}
      {!isLoading && !isError && items.length > 0 && (
        <div className="space-y-2">
          {items.map((item) => {
            const typeConfig =
              ERROR_TYPE_CONFIG[item.errorType] ?? {
                label: item.errorType,
                className: "bg-muted text-muted-foreground",
              };

            return (
              <Card
                key={item.id}
                className="cursor-pointer transition-colors hover:border-brand-beige"
                onClick={() => openDetail(item)}
              >
                <CardContent className="flex items-start gap-4 p-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-dark">
                    <BookX className="h-5 w-5 text-brand-beige" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="line-clamp-2 text-sm font-medium">
                      <LatexRenderer
                        content={
                          item.problem.stemLatex ||
                          item.problem.stemText ||
                          ""
                        }
                        className="text-sm leading-relaxed"
                      />
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {formatDate(item.createdAt)}
                      {item.retryCount > 0 && (
                        <span className="ml-2">
                          재시도 {item.retryCount}회
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className={`rounded-full border px-2 py-0.5 text-xs font-medium ${typeConfig.className}`}
                    >
                      {typeConfig.label}
                    </span>
                    {item.resolved ? (
                      <Badge
                        variant="outline"
                        className="bg-green-900/30 text-green-400 border-green-400/30"
                      >
                        해결
                      </Badge>
                    ) : (
                      <Badge
                        variant="outline"
                        className="bg-orange-900/30 text-orange-400 border-orange-400/30"
                      >
                        미해결
                      </Badge>
                    )}
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

      {/* Detail dialog */}
      <Dialog
        open={selectedItem !== null}
        onOpenChange={(open) => !open && closeDetail()}
      >
        <DialogContent className="flex max-h-[90vh] max-w-3xl flex-col overflow-hidden p-0">
          {selectedItem && (
            <>
              <DialogHeader className="border-b border-border px-6 py-5">
                <DialogTitle className="flex items-center gap-2">
                  <span>오답 상세</span>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-xs font-medium ${
                      (
                        ERROR_TYPE_CONFIG[selectedItem.errorType] ?? {
                          className: "bg-muted text-muted-foreground",
                        }
                      ).className
                    }`}
                  >
                    {(
                      ERROR_TYPE_CONFIG[selectedItem.errorType] ?? {
                        label: selectedItem.errorType,
                      }
                    ).label}
                  </span>
                  {selectedItem.resolved ? (
                    <Badge
                      variant="outline"
                      className="bg-green-900/30 text-green-400 border-green-400/30"
                    >
                      해결
                    </Badge>
                  ) : (
                    <Badge
                      variant="outline"
                      className="bg-orange-900/30 text-orange-400 border-orange-400/30"
                    >
                      미해결
                    </Badge>
                  )}
                </DialogTitle>
                <DialogDescription>
                  {formatDate(selectedItem.createdAt)}
                  {selectedItem.retryCount > 0 &&
                    ` / 재시도 ${selectedItem.retryCount}회`}
                </DialogDescription>
              </DialogHeader>

              <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
                <div className="space-y-6">
                  {/* Problem content */}
                  <div className="space-y-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                      문제
                    </p>
                    <div className="rounded-xl border border-border bg-brand-dark p-5">
                      <LatexRenderer
                        content={
                          selectedItem.problem.stemLatex ||
                          selectedItem.problem.stemText ||
                          ""
                        }
                        className="text-sm leading-relaxed text-foreground"
                      />

                      {selectedItem.problem.choices &&
                        selectedItem.problem.choices.length > 0 && (
                          <div className="mt-5 space-y-2.5 border-t border-border pt-4">
                            {selectedItem.problem.choices.map(
                              (choice, choiceIndex) => (
                                <div
                                  key={`choice-${choiceIndex}`}
                                  className="flex items-start gap-2 text-sm"
                                >
                                  <span className="shrink-0 font-medium text-brand-beige">
                                    {choice.label || `${choiceIndex + 1}.`}
                                  </span>
                                  <LatexRenderer
                                    content={
                                      choice.contentLatex ||
                                      choice.contentText ||
                                      ""
                                    }
                                    className="leading-relaxed"
                                  />
                                </div>
                              ),
                            )}
                          </div>
                        )}
                    </div>
                  </div>

                  {/* Solution */}
                  {!retryMode && (
                    <div className="space-y-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                        풀이
                      </p>
                      <SolutionViewer
                        solutionText={selectedItem.problem.solutionText}
                        solutionSteps={selectedItem.problem.solutionSteps}
                        alternativeSolutions={
                          selectedItem.problem.alternativeSolutions
                        }
                      />
                    </div>
                  )}

                  {/* Retry mode */}
                  {retryMode && (
                    <div className="space-y-4 rounded-2xl border border-border bg-card/80 p-5">
                      <p className="text-sm font-medium text-foreground">
                        이 문제를 다시 풀어보세요. 결과를 아래에서 선택해주세요.
                      </p>
                      <div className="flex items-center gap-3">
                        <Button
                          onClick={() =>
                            retryMutation.mutate({
                              id: selectedItem.id,
                              isCorrect: true,
                            })
                          }
                          disabled={retryMutation.isPending}
                          className="flex-1"
                        >
                          <CheckCircle2 className="mr-2 h-4 w-4" />
                          맞았어요
                        </Button>
                        <Button
                          variant="secondary"
                          onClick={() =>
                            retryMutation.mutate({
                              id: selectedItem.id,
                              isCorrect: false,
                            })
                          }
                          disabled={retryMutation.isPending}
                          className="flex-1"
                        >
                          <XCircle className="mr-2 h-4 w-4" />
                          틀렸어요
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center justify-end gap-2 border-t border-border px-6 py-4">
                {!retryMode && (
                  <Button
                    variant="secondary"
                    onClick={() => setRetryMode(true)}
                  >
                    <RotateCcw className="mr-2 h-4 w-4" />
                    재도전
                  </Button>
                )}
                {retryMode && (
                  <Button
                    variant="ghost"
                    onClick={() => setRetryMode(false)}
                  >
                    취소
                  </Button>
                )}
                {!selectedItem.resolved && (
                  <Button
                    onClick={() => resolveMutation.mutate(selectedItem.id)}
                    disabled={resolveMutation.isPending}
                  >
                    <CheckCircle2 className="mr-2 h-4 w-4" />
                    해결 완료
                  </Button>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
