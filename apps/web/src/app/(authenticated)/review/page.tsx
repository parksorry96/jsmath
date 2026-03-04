"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Check,
  X,
  ChevronLeft,
  ChevronRight,
  Code,
  FileText,
  Keyboard,
  Inbox,
  Loader2,
  AlertCircle,
  ArrowLeft,
  Upload,
  Trash2,
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { LatexRenderer } from "@/components/math/latex-renderer";
import { api } from "@/lib/api";
import Link from "next/link";

// --- Types ---

interface ProblemChoice {
  label: string;
  contentText?: string;
  contentLatex?: string;
}

interface ProblemAsset {
  id: string;
  s3Key: string;
  kind: string;
  url?: string;
}

interface Problem {
  id: string;
  stemText: string;
  stemLatex?: string;
  problemType: string;
  choices?: ProblemChoice[];
  reviewStatus: string;
  classificationConfidence: number | null;
  assets?: ProblemAsset[];
  sourceFile?: string;
  startPage?: number;
}

interface PaginatedResponse {
  data: Problem[];
  total: number;
  page: number;
  limit: number;
}

interface SourceFileItem {
  id: string;
  filename: string;
  createdAt: string;
  ocrJobId: string | null;
  ocrStatus: string | null;
  problemCount: number;
}

// --- Helpers ---

const CIRCLE_NUMBERS = ["\u2460", "\u2461", "\u2462", "\u2463", "\u2464"];

function confidenceColor(c: number): string {
  if (c >= 0.9) return "text-green-400";
  if (c >= 0.75) return "text-yellow-400";
  return "text-red-400";
}

function confidenceBg(c: number): string {
  if (c >= 0.9) return "bg-green-400/10 border-green-400/30";
  if (c >= 0.75) return "bg-yellow-400/10 border-yellow-400/30";
  return "bg-red-400/10 border-red-400/30";
}

function getConfidence(problem: Problem): number {
  return problem.classificationConfidence ?? 0;
}

function getFirstAssetS3Key(problem: Problem): string | null {
  if (!problem.assets || problem.assets.length === 0) return null;
  // Prefer cropped problem image over full page image
  const cropAsset = problem.assets.find((a) => a.kind === "problem_crop");
  if (cropAsset?.s3Key) return cropAsset.s3Key;
  const pageAsset = problem.assets.find((a) => a.kind === "page_image");
  return pageAsset?.s3Key ?? problem.assets[0]?.s3Key ?? null;
}

function getDisplayContent(problem: Problem): string {
  return problem.stemLatex || problem.stemText || "";
}

function useAssetUrl(s3Key: string | null) {
  const { data } = useQuery({
    queryKey: ["asset-url", s3Key],
    queryFn: () =>
      api.get<{ url: string }>(
        `/files/assets/url?key=${encodeURIComponent(s3Key!)}`,
      ),
    enabled: !!s3Key,
    staleTime: 10 * 60 * 1000,
  });
  return data?.url ?? null;
}

const STATUS_LABELS: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  completed: { label: "완료", variant: "default" },
  processing: { label: "처리중", variant: "secondary" },
  pending: { label: "대기", variant: "outline" },
  failed: { label: "실패", variant: "destructive" },
};

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// --- File List Component ---

function FileListView({
  onSelectJob,
}: {
  onSelectJob: (jobId: string, filename: string) => void;
}) {
  const queryClient = useQueryClient();
  const {
    data: files,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["source-files"],
    queryFn: () => api.get<SourceFileItem[]>("/files"),
  });

  const deleteMutation = useMutation({
    mutationFn: (fileId: string) => api.delete(`/files/${fileId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["source-files"] });
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">문제 검수</h1>
          <p className="text-muted-foreground">
            검수할 PDF를 선택하세요.
          </p>
        </div>
        <Button variant="secondary" size="sm" asChild>
          <Link href="/upload">
            <Upload className="mr-2 h-4 w-4" />
            PDF 업로드
          </Link>
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
      ) : isError ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <AlertCircle className="h-12 w-12 text-destructive" />
            <p className="mt-4 text-lg font-medium">
              파일 목록을 불러오지 못했습니다
            </p>
          </CardContent>
        </Card>
      ) : !files || files.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-20">
            <Inbox className="h-16 w-16 text-muted-foreground" />
            <p className="mt-4 text-lg font-medium text-foreground">
              업로드된 PDF가 없습니다
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              PDF를 업로드하면 OCR 후 검수할 수 있습니다.
            </p>
            <Button className="mt-4" variant="secondary" asChild>
              <Link href="/upload">PDF 업로드하기</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {files.map((file) => {
            const status = STATUS_LABELS[file.ocrStatus ?? "pending"] ?? STATUS_LABELS.pending;
            const isClickable = file.ocrStatus === "completed" && file.ocrJobId;

            return (
              <div
                key={file.id}
                className={`flex w-full items-center gap-4 rounded-xl border p-4 transition-colors ${
                  isClickable
                    ? "border-border hover:border-brand-beige hover:bg-brand-beige/5"
                    : "border-border/50 opacity-60"
                }`}
              >
                <button
                  disabled={!isClickable}
                  onClick={() => {
                    if (isClickable && file.ocrJobId) {
                      onSelectJob(file.ocrJobId, file.filename);
                    }
                  }}
                  className={`flex min-w-0 flex-1 items-center gap-4 text-left ${
                    isClickable ? "cursor-pointer" : "cursor-not-allowed"
                  }`}
                >
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-brand-dark">
                    <FileText className="h-6 w-6 text-brand-beige" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{file.filename}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(file.createdAt)}
                      {file.problemCount > 0 && ` · ${file.problemCount}문제`}
                    </p>
                  </div>
                  <Badge variant={status.variant}>{status.label}</Badge>
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm(`"${file.filename}"을(를) 삭제하시겠습니까?`)) {
                      deleteMutation.mutate(file.id);
                    }
                  }}
                  disabled={deleteMutation.isPending}
                  className="shrink-0 rounded-lg p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// --- Problem Review Component ---

function ProblemReviewView({
  ocrJobId,
  filename,
  onBack,
}: {
  ocrJobId: string;
  filename: string;
  onBack: () => void;
}) {
  const queryClient = useQueryClient();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showRawLatex, setShowRawLatex] = useState(false);
  const [actionFeedback, setActionFeedback] = useState<
    "approved" | "rejected" | null
  >(null);
  const [editingLatex, setEditingLatex] = useState<string | null>(null);

  // Fetch problems for this OCR job
  const {
    data: response,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ["review-queue", ocrJobId],
    queryFn: () =>
      api.get<PaginatedResponse>(
        `/problems?ocrJobId=${ocrJobId}&page=1&limit=200`,
      ),
  });

  const problems = response?.data ?? [];
  const total = response?.total ?? 0;
  const current = problems[currentIndex] ?? null;

  // Reset editing state when switching problems
  useEffect(() => {
    setEditingLatex(null);
  }, [currentIndex]);

  // Save LaTeX mutation
  const saveMutation = useMutation({
    mutationFn: ({ id, stemLatex }: { id: string; stemLatex: string }) =>
      api.patch(`/problems/${id}`, { stemLatex }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["review-queue", ocrJobId] });
      setEditingLatex(null);
    },
  });

  const reviewMutation = useMutation({
    mutationFn: ({
      problemId,
      action,
    }: {
      problemId: string;
      action: "approved" | "rejected";
    }) => api.post(`/problems/${problemId}/review`, { action }),
    onSuccess: (_data, variables) => {
      setActionFeedback(variables.action);
      setTimeout(() => {
        setActionFeedback(null);
        queryClient.invalidateQueries({ queryKey: ["review-queue", ocrJobId] });
        if (currentIndex < problems.length - 1) {
          setCurrentIndex((i) => i + 1);
        }
      }, 600);
    },
  });

  const goNext = useCallback(() => {
    setCurrentIndex((i) => Math.min(i + 1, problems.length - 1));
  }, [problems.length]);

  const goPrev = useCallback(() => {
    setCurrentIndex((i) => Math.max(i - 1, 0));
  }, []);

  const handleApprove = useCallback(() => {
    if (!current || reviewMutation.isPending) return;
    reviewMutation.mutate({ problemId: current.id, action: "approved" });
  }, [current, reviewMutation]);

  const handleReject = useCallback(() => {
    if (!current || reviewMutation.isPending) return;
    reviewMutation.mutate({ problemId: current.id, action: "rejected" });
  }, [current, reviewMutation]);

  // Asset URL for current problem
  const currentAssetKey = useMemo(
    () => (current ? getFirstAssetS3Key(current) : null),
    [current],
  );
  const imageUrl = useAssetUrl(currentAssetKey);

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      switch (e.key) {
        case "ArrowLeft":
          e.preventDefault();
          goPrev();
          break;
        case "ArrowRight":
          e.preventDefault();
          goNext();
          break;
        case "Enter":
          e.preventDefault();
          handleApprove();
          break;
        case "Backspace":
          e.preventDefault();
          handleReject();
          break;
        case "Escape":
          e.preventDefault();
          onBack();
          break;
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [goNext, goPrev, handleApprove, handleReject, onBack]);

  // --- Loading state ---
  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" />
            PDF 목록
          </Button>
          <h1 className="text-2xl font-bold tracking-tight">문제 검수</h1>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-[500px] rounded-xl" />
          <div className="space-y-4">
            <Skeleton className="h-[300px] rounded-xl" />
            <Skeleton className="h-[150px] rounded-xl" />
          </div>
        </div>
      </div>
    );
  }

  // --- Error state ---
  if (isError) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" />
            PDF 목록
          </Button>
          <h1 className="text-2xl font-bold tracking-tight">문제 검수</h1>
        </div>
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <AlertCircle className="h-12 w-12 text-destructive" />
            <p className="mt-4 text-lg font-medium">
              문제를 불러오지 못했습니다
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {error instanceof Error ? error.message : "Unknown error"}
            </p>
            <Button
              className="mt-6"
              onClick={() =>
                queryClient.invalidateQueries({
                  queryKey: ["review-queue", ocrJobId],
                })
              }
            >
              다시 시도
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // --- Empty state ---
  if (problems.length === 0) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" />
            PDF 목록
          </Button>
          <h1 className="text-2xl font-bold tracking-tight">문제 검수</h1>
        </div>
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-20">
            <Inbox className="h-16 w-16 text-muted-foreground" />
            <p className="mt-4 text-lg font-medium text-foreground">
              이 PDF에 문제가 없습니다
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const rawLatex = current!.stemLatex || current!.stemText || "";
  const displayContent = editingLatex ?? getDisplayContent(current!);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" />
            PDF 목록
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">문제 검수</h1>
            <p className="text-muted-foreground text-sm">{filename}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon">
                <Keyboard className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              <div className="space-y-1">
                <p>Enter: 승인</p>
                <p>Backspace: 거부</p>
                <p>Arrow Left/Right: 이동</p>
                <p>Esc: PDF 목록</p>
              </div>
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Navigation bar */}
      <div className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={goPrev}
          disabled={currentIndex === 0}
        >
          <ChevronLeft className="h-4 w-4" />
          <span className="hidden sm:inline">이전</span>
        </Button>

        <div className="flex items-center gap-4">
          <Badge variant="outline" className="text-sm">
            문제 {currentIndex + 1} / {problems.length}
            {total > problems.length && (
              <span className="text-muted-foreground">
                {" "}
                (전체 {total})
              </span>
            )}
          </Badge>

          <div
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${confidenceBg(getConfidence(current!))}`}
          >
            <span className={confidenceColor(getConfidence(current!))}>
              신뢰도 {Math.round(getConfidence(current!) * 100)}%
            </span>
          </div>
        </div>

        <Button
          variant="ghost"
          size="sm"
          onClick={goNext}
          disabled={currentIndex === problems.length - 1}
        >
          <span className="hidden sm:inline">다음</span>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Main content: two-column layout */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Left panel: Original PDF image */}
        <Card className="overflow-hidden">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-sm">
                <FileText className="h-4 w-4 text-brand-beige" />
                원본 이미지
              </CardTitle>
              {current!.sourceFile && (
                <span className="text-xs text-muted-foreground">
                  {current!.sourceFile}
                  {current!.startPage != null && ` - p.${current!.startPage}`}
                </span>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className="relative flex aspect-[3/4] items-center justify-center overflow-hidden rounded-lg border border-border bg-brand-dark">
              {imageUrl ? (
                <img
                  src={imageUrl}
                  alt={`Problem ${currentIndex + 1} original`}
                  className="h-full w-full object-contain"
                />
              ) : (
                <div className="flex flex-col items-center gap-2 text-muted-foreground">
                  <FileText className="h-10 w-10" />
                  <p className="text-sm">원본 이미지 없음</p>
                  <p className="text-xs">
                    문제 #{currentIndex + 1}
                  </p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Right panel: OCR result + raw source */}
        <div className="flex flex-col gap-4">
          {/* Right top: KaTeX rendered result */}
          <Card className="flex-1">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <span className="text-brand-beige">
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      className="h-4 w-4"
                    >
                      <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z" />
                    </svg>
                  </span>
                  변환 결과
                </CardTitle>
                <Badge variant="secondary" className="text-xs">
                  {current!.problemType}
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <div className="min-h-[200px] rounded-lg border border-border bg-brand-dark p-5">
                <LatexRenderer
                  content={displayContent}
                  className="text-sm leading-relaxed text-foreground"
                />

                {current!.choices && current!.choices.length > 0 && (
                  <div className="mt-5 space-y-2.5 border-t border-border pt-4">
                    {current!.choices.map((choice, i) => (
                      <div
                        key={i}
                        className="flex items-start gap-2 text-sm"
                      >
                        <span className="shrink-0 font-medium text-brand-beige">
                          {choice.label || CIRCLE_NUMBERS[i] || `(${i + 1})`}
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
            </CardContent>
          </Card>

          {/* Right bottom: Raw LaTeX source (editable) */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Code className="h-4 w-4 text-brand-beige" />
                  원본 LaTeX 소스
                </CardTitle>
                <div className="flex items-center gap-2">
                  {editingLatex !== null && editingLatex !== rawLatex && (
                    <Button
                      variant="default"
                      size="xs"
                      disabled={saveMutation.isPending}
                      onClick={() => {
                        if (!current) return;
                        saveMutation.mutate({
                          id: current.id,
                          stemLatex: editingLatex,
                        });
                      }}
                    >
                      {saveMutation.isPending ? (
                        <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                      ) : null}
                      저장
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => setShowRawLatex((v) => !v)}
                  >
                    {showRawLatex ? "숨기기" : "보기"}
                  </Button>
                </div>
              </div>
            </CardHeader>
            {showRawLatex && (
              <CardContent>
                <textarea
                  className="max-h-[300px] min-h-[150px] w-full resize-y overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-brand-dark p-4 font-mono text-xs leading-relaxed text-muted-foreground focus:border-brand-beige focus:outline-none focus:ring-1 focus:ring-brand-beige"
                  value={editingLatex ?? rawLatex}
                  onChange={(e) => setEditingLatex(e.target.value)}
                />
              </CardContent>
            )}
          </Card>
        </div>
      </div>

      {/* Action buttons */}
      <div
        className={`flex items-center justify-center gap-4 rounded-lg border p-4 transition-colors ${
          actionFeedback === "approved"
            ? "border-green-400/50 bg-green-400/10"
            : actionFeedback === "rejected"
              ? "border-red-400/50 bg-red-400/10"
              : "border-border bg-card"
        }`}
      >
        <Button
          variant="destructive"
          size="lg"
          className="min-w-[140px]"
          onClick={handleReject}
          disabled={reviewMutation.isPending}
        >
          {reviewMutation.isPending &&
          reviewMutation.variables?.action === "rejected" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <X className="h-4 w-4" />
          )}
          반려 (Backspace)
        </Button>

        <Button
          size="lg"
          className="min-w-[140px]"
          onClick={handleApprove}
          disabled={reviewMutation.isPending}
        >
          {reviewMutation.isPending &&
          reviewMutation.variables?.action === "approved" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Check className="h-4 w-4" />
          )}
          승인 (Enter)
        </Button>
      </div>

      {/* Review queue list */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">검수 대기열</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {problems.map((item, index) => (
              <button
                key={item.id}
                onClick={() => setCurrentIndex(index)}
                className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors ${
                  index === currentIndex
                    ? "border-brand-beige bg-brand-beige/5"
                    : "border-border hover:border-brand-warm"
                }`}
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-brand-dark text-xs font-bold text-brand-beige">
                  {index + 1}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">
                    {(item.stemText || item.stemLatex || "").split("\n")[0]}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {item.sourceFile ?? "Unknown source"}
                    {item.startPage != null && ` p.${item.startPage}`}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {item.reviewStatus !== "pending_review" && (
                    <Badge
                      variant={
                        item.reviewStatus === "approved"
                          ? "default"
                          : item.reviewStatus === "rejected"
                            ? "destructive"
                            : "secondary"
                      }
                      className="text-xs"
                    >
                      {item.reviewStatus === "approved"
                        ? "승인"
                        : item.reviewStatus === "rejected"
                          ? "반려"
                          : item.reviewStatus}
                    </Badge>
                  )}
                  <span
                    className={`text-xs font-medium ${confidenceColor(getConfidence(item))}`}
                  >
                    {Math.round(getConfidence(item) * 100)}%
                  </span>
                </div>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// --- Main Page Component ---

export default function ReviewPage() {
  const [selectedJob, setSelectedJob] = useState<{
    ocrJobId: string;
    filename: string;
  } | null>(null);

  if (!selectedJob) {
    return (
      <FileListView
        onSelectJob={(ocrJobId, filename) =>
          setSelectedJob({ ocrJobId, filename })
        }
      />
    );
  }

  return (
    <ProblemReviewView
      ocrJobId={selectedJob.ocrJobId}
      filename={selectedJob.filename}
      onBack={() => setSelectedJob(null)}
    />
  );
}
