"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  Check,
  X,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Code,
  FileText,
  Inbox,
  Loader2,
  AlertCircle,
  ArrowLeft,
  Upload,
  Trash2,
  Sparkles,
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
  analysisStatus?: string;
  classificationConfidence: number | null;
  assets?: ProblemAsset[];
  sourceFile?: string;
  startPage?: number;
  bookSource?: {
    chapter?: string;
    section?: string;
  };
  answerMatchStatus?: string;
  solutionLatex?: string;
}

interface AnalysisResult {
  solutionStrategy?: string;
  requiredConcepts?: string[];
  solutionSteps?: (string | { concept: string; description: string })[];
  estimatedTimeSec?: number;
  commonMistakes?: string[];
  difficultyRefined?: number;
  isCommon?: boolean;
  pointValue?: number;
  positionType?: string;
  questionFormat?: string;
  answerText?: string;
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
  documentType?: string;
  bookTitle?: string;
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

function getDisplayContent(problem: Problem): string {
  return problem.stemLatex || problem.stemText || "";
}

function formatTimeSec(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m === 0) return `${s}초`;
  if (s === 0) return `${m}분`;
  return `${m}분 ${s}초`;
}

function difficultyBadgeClass(d: number): string {
  if (d <= 2) return "bg-green-500/20 text-green-400 border-green-500/30";
  if (d <= 3) return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
  return "bg-red-500/20 text-red-400 border-red-500/30";
}

const STATUS_LABELS: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  completed: { label: "완료", variant: "default" },
  processing: { label: "처리중", variant: "secondary" },
  pending: { label: "대기", variant: "outline" },
  failed: { label: "실패", variant: "destructive" },
};

const POSITION_TYPE_LABELS: Record<string, string> = {
  normal: "일반",
  semi_killer: "준킬러",
  killer: "킬러",
};

const QUESTION_FORMAT_LABELS: Record<string, string> = {
  multiple_choice_5: "5지선다",
  short_answer: "주관식",
};

const PROBLEM_TYPE_LABELS: Record<string, string> = {
  multiple_choice: "객관식",
  short_answer: "주관식",
  written_solution: "서술형",
  essay: "서술형",
  true_false: "O/X",
};

const REVIEW_STATUS_LABELS: Record<string, string> = {
  approved: "승인",
  rejected: "반려",
  pending_review: "검수대기",
  auto_approved: "자동승인",
};

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

type ConfidenceFilter = "all" | "high" | "medium" | "low";
type StatusFilter = "all" | "pending_review" | "approved" | "rejected";

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
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium">{file.filename}</p>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        file.documentType === 'textbook'
                          ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                          : 'bg-brand-charcoal text-muted-foreground'
                      }`}>
                        {file.documentType === 'textbook' ? '교재' : '시험지'}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(file.createdAt)}
                      {file.problemCount > 0 && ` · ${file.problemCount}문제`}
                    </p>
                    {file.bookTitle && (
                      <span className="text-sm text-muted-foreground">{file.bookTitle}</span>
                    )}
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

// --- Compact Problem Strip ---

function ProblemStrip({
  problems,
  currentIndex,
  onSelect,
}: {
  problems: Problem[];
  currentIndex: number;
  onSelect: (index: number) => void;
}) {
  const stripRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const btn = strip.children[currentIndex] as HTMLElement | undefined;
    if (!btn) return;
    btn.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }, [currentIndex]);

  return (
    <div
      ref={stripRef}
      className="flex gap-1 overflow-x-auto py-1"
      style={{ scrollbarWidth: "thin" }}
    >
      {problems.map((p, i) => {
        const isActive = i === currentIndex;
        const statusClass =
          p.reviewStatus === "approved"
            ? "bg-green-500/70 text-white"
            : p.reviewStatus === "rejected"
              ? "bg-red-500/70 text-white"
              : p.reviewStatus === "auto_approved"
                ? "bg-blue-500/70 text-white"
                : "bg-brand-charcoal text-muted-foreground";

        return (
          <button
            key={p.id}
            onClick={() => onSelect(i)}
            className={`flex h-7 min-w-[1.75rem] shrink-0 items-center justify-center rounded text-[11px] font-medium transition-all ${statusClass} ${
              isActive
                ? "ring-2 ring-brand-beige ring-offset-1 ring-offset-background scale-110 z-10"
                : "hover:brightness-125"
            }`}
          >
            {i + 1}
          </button>
        );
      })}
    </div>
  );
}

// --- Analysis Section Component ---

function AnalysisSection({
  problem,
  ocrJobId,
}: {
  problem: Problem;
  ocrJobId: string;
}) {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(true);
  const prevStatusRef = useRef(problem.analysisStatus);

  useEffect(() => {
    if (prevStatusRef.current !== "completed" && problem.analysisStatus === "completed") {
      setExpanded(true);
    }
    prevStatusRef.current = problem.analysisStatus;
  }, [problem.analysisStatus]);

  const analysisQuery = useQuery({
    queryKey: ["analysis", problem.id],
    queryFn: () => api.get<AnalysisResult>(`/problems/${problem.id}/analysis`),
    enabled: problem.analysisStatus === "completed",
    staleTime: 60_000,
  });

  const analyzeMutation = useMutation({
    mutationFn: () =>
      api.post("/problems/analyze", { ocrJobId, problemIds: [problem.id] }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["review-queue", ocrJobId] });
    },
  });

  const isAnalyzing = problem.analysisStatus === "analyzing" || analyzeMutation.isPending;
  const isFailed = problem.analysisStatus === "failed";
  const isCompleted = problem.analysisStatus === "completed";
  const analysis = analysisQuery.data;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Sparkles className="h-4 w-4 text-brand-beige" />
            AI 분석
          </CardTitle>
          <div className="flex items-center gap-2">
            {isCompleted && (
              <Badge variant="default" className="text-xs">분석 완료</Badge>
            )}
            {isFailed && (
              <Badge variant="destructive" className="text-xs">분석 실패</Badge>
            )}
            {isCompleted ? (
              <Button
                variant="ghost"
                size="xs"
                onClick={() => setExpanded((v) => !v)}
              >
                <ChevronDown className={`h-3 w-3 transition-transform ${expanded ? "rotate-180" : ""}`} />
                {expanded ? "접기" : "펼치기"}
              </Button>
            ) : isAnalyzing ? (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                AI가 분석 중입니다...
              </div>
            ) : (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => analyzeMutation.mutate()}
              >
                <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                {isFailed ? "다시 분석" : "AI 분석 시작"}
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      {expanded && isCompleted && analysis && (
        <CardContent>
          <div className="space-y-4 rounded-lg border border-border bg-brand-dark p-4 text-sm">
            {analysis.difficultyRefined != null && (
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">정밀 난이도:</span>
                <Badge variant="outline" className={difficultyBadgeClass(analysis.difficultyRefined)}>
                  {analysis.difficultyRefined}등급
                </Badge>
              </div>
            )}

            {analysis.answerText && (
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">정답:</span>
                <LatexRenderer content={analysis.answerText} className="inline text-xs font-mono" />
              </div>
            )}

            {analysis.solutionStrategy && (
              <div>
                <p className="mb-1 font-medium text-muted-foreground">풀이 전략</p>
                <LatexRenderer content={analysis.solutionStrategy} className="text-foreground" />
              </div>
            )}

            {analysis.requiredConcepts && analysis.requiredConcepts.length > 0 && (
              <div>
                <p className="mb-1.5 font-medium text-muted-foreground">필요 개념</p>
                <div className="flex flex-wrap gap-1.5">
                  {analysis.requiredConcepts.map((c, i) => (
                    <Badge key={i} variant="secondary" className="text-xs">{c}</Badge>
                  ))}
                </div>
              </div>
            )}

            {analysis.solutionSteps && analysis.solutionSteps.length > 0 && (
              <div>
                <p className="mb-1.5 font-medium text-muted-foreground">풀이 단계</p>
                <ol className="list-decimal space-y-1.5 pl-5 text-foreground">
                  {analysis.solutionSteps.map((s, i) => (
                    <li key={i}>
                      {typeof s === "string" ? (
                        <LatexRenderer content={s} className="inline" />
                      ) : (
                        <div>
                          <strong>{s.concept}</strong>
                          <LatexRenderer content={s.description} className="mt-0.5" />
                        </div>
                      )}
                    </li>
                  ))}
                </ol>
              </div>
            )}

            {analysis.estimatedTimeSec != null && (
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">예상 풀이시간:</span>
                <span className="text-foreground">{formatTimeSec(analysis.estimatedTimeSec)}</span>
              </div>
            )}

            {analysis.commonMistakes && analysis.commonMistakes.length > 0 && (
              <div>
                <p className="mb-1.5 font-medium text-muted-foreground">흔한 실수</p>
                <ul className="list-disc space-y-1.5 pl-5 text-foreground">
                  {analysis.commonMistakes.map((m, i) => (
                    <li key={i}>
                      {typeof m === "string" ? <LatexRenderer content={m} className="inline" /> : String(m)}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {(analysis.isCommon != null || analysis.pointValue != null || analysis.positionType || analysis.questionFormat) && (
              <div>
                <p className="mb-1.5 font-medium text-muted-foreground">수능 정보</p>
                <div className="flex flex-wrap gap-2">
                  {analysis.isCommon != null && (
                    <Badge variant="outline" className="text-xs">
                      {analysis.isCommon ? "공통" : "선택"}
                    </Badge>
                  )}
                  {analysis.pointValue != null && (
                    <Badge variant="outline" className="text-xs">{analysis.pointValue}점</Badge>
                  )}
                  {analysis.positionType && (
                    <Badge variant="outline" className="text-xs">{POSITION_TYPE_LABELS[analysis.positionType] ?? analysis.positionType}</Badge>
                  )}
                  {analysis.questionFormat && (
                    <Badge variant="outline" className="text-xs">{QUESTION_FORMAT_LABELS[analysis.questionFormat] ?? analysis.questionFormat}</Badge>
                  )}
                </div>
              </div>
            )}
          </div>
        </CardContent>
      )}
    </Card>
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
  const [actionFeedback, setActionFeedback] = useState<"approved" | "rejected" | null>(null);
  const [editingLatex, setEditingLatex] = useState<string | null>(null);
  const [confidenceFilter, setConfidenceFilter] = useState<ConfidenceFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

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
    refetchInterval: (query) => {
      const problems = query.state.data?.data;
      if (problems?.some((p) => p.analysisStatus === "analyzing")) {
        return 3000;
      }
      return false;
    },
  });

  const allProblems = response?.data ?? [];
  const total = response?.total ?? 0;

  // Client-side filtering
  const filteredProblems = useMemo(() => {
    return allProblems.filter((p) => {
      if (statusFilter !== "all" && p.reviewStatus !== statusFilter) return false;
      if (confidenceFilter !== "all") {
        const c = getConfidence(p);
        if (confidenceFilter === "high" && c < 0.9) return false;
        if (confidenceFilter === "medium" && (c < 0.75 || c >= 0.9)) return false;
        if (confidenceFilter === "low" && c >= 0.75) return false;
      }
      return true;
    });
  }, [allProblems, statusFilter, confidenceFilter]);

  // Use filtered problems for display, but currentIndex refers to filteredProblems
  const problems = filteredProblems;
  const current = problems[currentIndex] ?? null;

  // Clamp currentIndex when filters change
  useEffect(() => {
    setCurrentIndex((i) => Math.min(i, Math.max(0, problems.length - 1)));
  }, [problems.length]);

  // Reset editing state when switching problems
  useEffect(() => {
    setEditingLatex(null);
  }, [currentIndex]);

  // Progress stats (from all problems, not filtered)
  const reviewedCount = allProblems.filter((p) => p.reviewStatus !== "pending_review").length;
  const approvedCount = allProblems.filter((p) => p.reviewStatus === "approved" || p.reviewStatus === "auto_approved").length;
  const rejectedCount = allProblems.filter((p) => p.reviewStatus === "rejected").length;
  const progressPercent = allProblems.length > 0 ? Math.round((reviewedCount / allProblems.length) * 100) : 0;

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
        // Auto-advance to next unreviewed in filtered list
        const nextIdx = problems.findIndex(
          (p, i) => i > currentIndex && p.reviewStatus === "pending_review"
        );
        if (nextIdx >= 0) {
          setCurrentIndex(nextIdx);
        } else if (currentIndex < problems.length - 1) {
          setCurrentIndex((i) => i + 1);
        }
      }, 400);
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
      <div className="space-y-4">
        <Skeleton className="h-12 rounded-lg" />
        <Skeleton className="h-10 rounded-lg" />
        <Skeleton className="h-[400px] rounded-xl" />
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
  if (allProblems.length === 0) {
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

  // --- Filter results empty ---
  if (problems.length === 0) {
    return (
      <div className="space-y-4">
        <StickyHeader
          filename={filename}
          onBack={onBack}
          problems={problems}
          allProblems={allProblems}
          currentIndex={0}
          reviewedCount={reviewedCount}
          progressPercent={progressPercent}
          approvedCount={approvedCount}
          rejectedCount={rejectedCount}
          confidenceFilter={confidenceFilter}
          statusFilter={statusFilter}
          onConfidenceFilter={setConfidenceFilter}
          onStatusFilter={setStatusFilter}
          onSelect={setCurrentIndex}
          onApprove={handleApprove}
          onReject={handleReject}
          isPending={reviewMutation.isPending}
          actionFeedback={actionFeedback}
        />
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Inbox className="h-12 w-12 text-muted-foreground" />
            <p className="mt-4 text-sm text-muted-foreground">
              필터 조건에 맞는 문제가 없습니다
            </p>
            <Button
              variant="ghost"
              size="sm"
              className="mt-2"
              onClick={() => { setConfidenceFilter("all"); setStatusFilter("all"); }}
            >
              필터 초기화
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const rawLatex = current!.stemLatex || current!.stemText || "";
  const displayContent = editingLatex ?? getDisplayContent(current!);

  return (
    <div className="space-y-4">
      {/* Sticky header with nav, actions, filters */}
      <StickyHeader
        filename={filename}
        onBack={onBack}
        problems={problems}
        allProblems={allProblems}
        currentIndex={currentIndex}
        reviewedCount={reviewedCount}
        progressPercent={progressPercent}
        approvedCount={approvedCount}
        rejectedCount={rejectedCount}
        confidenceFilter={confidenceFilter}
        statusFilter={statusFilter}
        onConfidenceFilter={setConfidenceFilter}
        onStatusFilter={setStatusFilter}
        onSelect={setCurrentIndex}
        onApprove={handleApprove}
        onReject={handleReject}
        isPending={reviewMutation.isPending}
        actionFeedback={actionFeedback}
        goNext={goNext}
        goPrev={goPrev}
        current={current!}
      />

      {/* Metadata chips */}
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary" className="text-xs">
          {PROBLEM_TYPE_LABELS[current!.problemType] ?? current!.problemType}
        </Badge>
        {current!.bookSource?.chapter && (
          <Badge variant="outline" className="text-xs">
            {current!.bookSource.chapter}
            {current!.bookSource.section && ` ${current!.bookSource.section}`}
          </Badge>
        )}
        {current!.answerMatchStatus && current!.answerMatchStatus !== "no_answer_key" && (
          <span
            className={`text-xs px-2 py-0.5 rounded-full border ${
              current!.answerMatchStatus === "matched"
                ? "bg-green-500/20 text-green-400 border-green-500/30"
                : "bg-yellow-500/20 text-yellow-400 border-yellow-500/30"
            }`}
          >
            {current!.answerMatchStatus === "matched" ? "해설 매칭" : "매칭 안됨"}
          </span>
        )}
        {current!.sourceFile && (
          <span className="text-xs text-muted-foreground">
            {current!.sourceFile}
            {current!.startPage != null && ` p.${current!.startPage}`}
          </span>
        )}
        <div
          className={`ml-auto inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${confidenceBg(getConfidence(current!))}`}
        >
          <span className={confidenceColor(getConfidence(current!))}>
            신뢰도 {Math.round(getConfidence(current!) * 100)}%
          </span>
        </div>
      </div>

      {/* OCR Result — full width */}
      <Card>
        <CardContent className="p-5">
          <div className="min-h-[200px] rounded-lg border border-border bg-brand-dark p-5">
            <LatexRenderer
              content={displayContent}
              className="text-sm leading-relaxed text-foreground"
            />

            {current!.choices && current!.choices.length > 0 && (
              <div className="mt-5 space-y-2.5 border-t border-border pt-4">
                {current!.choices.map((choice, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm">
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

            {current!.solutionLatex && (
              <div className="mt-4 rounded-lg border border-blue-500/30 bg-blue-500/10 p-3">
                <h4 className="text-sm font-medium text-blue-400 mb-2">해설지 풀이</h4>
                <LatexRenderer
                  content={current!.solutionLatex}
                  className="text-sm text-foreground"
                />
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* AI Analysis — default expanded */}
      <AnalysisSection problem={current!} ocrJobId={ocrJobId} />

      {/* Raw LaTeX source — collapsed by default */}
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
                <ChevronDown className={`mr-1 h-3 w-3 transition-transform ${showRawLatex ? "rotate-180" : ""}`} />
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
  );
}

// --- Sticky Header Component ---

function StickyHeader({
  filename,
  onBack,
  problems,
  allProblems,
  currentIndex,
  reviewedCount,
  progressPercent,
  approvedCount,
  rejectedCount,
  confidenceFilter,
  statusFilter,
  onConfidenceFilter,
  onStatusFilter,
  onSelect,
  onApprove,
  onReject,
  isPending,
  actionFeedback,
  goNext,
  goPrev,
  current,
}: {
  filename: string;
  onBack: () => void;
  problems: Problem[];
  allProblems: Problem[];
  currentIndex: number;
  reviewedCount: number;
  progressPercent: number;
  approvedCount: number;
  rejectedCount: number;
  confidenceFilter: ConfidenceFilter;
  statusFilter: StatusFilter;
  onConfidenceFilter: (f: ConfidenceFilter) => void;
  onStatusFilter: (f: StatusFilter) => void;
  onSelect: (i: number) => void;
  onApprove: () => void;
  onReject: () => void;
  isPending: boolean;
  actionFeedback: "approved" | "rejected" | null;
  goNext?: () => void;
  goPrev?: () => void;
  current?: Problem;
}) {
  return (
    <div className="sticky top-0 z-20 -mx-6 -mt-6 mb-4 space-y-0 border-b border-border bg-background px-6 pb-3 pt-6">
      {/* Row 1: Back + filename + actions + progress */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack} className="shrink-0">
          <ArrowLeft className="h-4 w-4" />
          <span className="hidden sm:inline">목록</span>
        </Button>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{filename}</p>
        </div>

        {/* Keyboard hint */}
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="hidden text-[10px] text-muted-foreground sm:inline">
              ← → 이동 · Enter 승인 · Backspace 반려
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">
            <div className="space-y-1">
              <p>Enter: 승인</p>
              <p>Backspace: 반려</p>
              <p>Arrow Left/Right: 이동</p>
              <p>Esc: PDF 목록</p>
            </div>
          </TooltipContent>
        </Tooltip>

        {/* Action buttons */}
        <div className={`flex items-center gap-2 rounded-lg border px-2 py-1 transition-colors ${
          actionFeedback === "approved"
            ? "border-green-400/50 bg-green-400/10"
            : actionFeedback === "rejected"
              ? "border-red-400/50 bg-red-400/10"
              : "border-transparent"
        }`}>
          <Button
            variant="destructive"
            size="sm"
            onClick={onReject}
            disabled={isPending || !current}
          >
            {isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <X className="h-3.5 w-3.5" />
            )}
            <span className="hidden sm:inline ml-1">반려</span>
          </Button>
          <Button
            size="sm"
            onClick={onApprove}
            disabled={isPending || !current}
          >
            {isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Check className="h-3.5 w-3.5" />
            )}
            <span className="hidden sm:inline ml-1">승인</span>
          </Button>
        </div>
      </div>

      {/* Row 2: Progress bar */}
      <div className="mt-2 flex items-center gap-3">
        <div className="flex-1 h-1.5 rounded-full bg-brand-charcoal overflow-hidden">
          <div
            className="h-full rounded-full bg-brand-beige transition-all"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        <span className="shrink-0 text-xs text-muted-foreground">
          {reviewedCount}/{allProblems.length}
          <span className="ml-1.5 text-green-400">{approvedCount}승인</span>
          {rejectedCount > 0 && (
            <span className="ml-1 text-red-400">{rejectedCount}반려</span>
          )}
        </span>
      </div>

      {/* Row 3: Problem strip with nav */}
      <div className="mt-2 flex items-center gap-2">
        {goPrev && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            onClick={goPrev}
            disabled={currentIndex === 0}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
        )}
        <div className="min-w-0 flex-1">
          <ProblemStrip
            problems={problems}
            currentIndex={currentIndex}
            onSelect={onSelect}
          />
        </div>
        {goNext && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            onClick={goNext}
            disabled={currentIndex === problems.length - 1}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Row 4: Filters */}
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        <span className="text-muted-foreground">상태:</span>
        {([
          ["all", "전체"],
          ["pending_review", "미검수"],
          ["approved", "승인"],
          ["rejected", "반려"],
        ] as [StatusFilter, string][]).map(([val, label]) => (
          <button
            key={val}
            onClick={() => onStatusFilter(val)}
            className={`rounded-full px-2.5 py-1 transition-colors ${
              statusFilter === val
                ? "bg-brand-beige text-brand-dark font-medium"
                : "bg-brand-charcoal text-muted-foreground hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}

        <span className="ml-2 text-muted-foreground">신뢰도:</span>
        {([
          ["all", "전체"],
          ["high", "≥90%"],
          ["medium", "75-90%"],
          ["low", "<75%"],
        ] as [ConfidenceFilter, string][]).map(([val, label]) => (
          <button
            key={val}
            onClick={() => onConfidenceFilter(val)}
            className={`rounded-full px-2.5 py-1 transition-colors ${
              confidenceFilter === val
                ? "bg-brand-beige text-brand-dark font-medium"
                : "bg-brand-charcoal text-muted-foreground hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}

        {(statusFilter !== "all" || confidenceFilter !== "all") && (
          <span className="ml-auto text-muted-foreground">
            {problems.length}개 표시
          </span>
        )}
      </div>
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
