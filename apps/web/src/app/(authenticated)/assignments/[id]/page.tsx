"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Calendar,
  GraduationCap,
  Users,
  Plus,
  Search,
  Loader2,
  AlertCircle,
  Inbox,
  Check,
  X,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Send,
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LatexRenderer } from "@/components/math/latex-renderer";

// --- Types ---

interface AssignmentProblem {
  id: string;
  order: number;
  problem: {
    id: string;
    displayNumber: string | null;
    problemNumber: string | null;
    stemText: string;
    stemLatex: string;
    problemType: string;
    difficulty: number | null;
    choices?: { label: string; contentText?: string; contentLatex?: string }[];
    answerText?: string;
  };
}

interface Assignment {
  id: string;
  classId: string;
  title: string;
  description: string | null;
  type: string;
  dueAt: string | null;
  maxScore: number;
  status: string;
  createdAt: string;
  class?: { id: string; title: string; _count?: { enrollments: number } };
  problems?: AssignmentProblem[];
}

interface Submission {
  id: string;
  studentId: string;
  assignmentId: string;
  status: string;
  score: number | null;
  maxScore: number;
  feedback: string | null;
  submittedAt: string | null;
  gradedAt: string | null;
  student?: {
    id: string;
    name: string;
    email: string;
  };
  answers?: {
    problemId: string;
    answer: string;
    isCorrect: boolean | null;
    score: number | null;
  }[];
  photos?: {
    id: string;
    url: string;
    aiFeedback?: string;
  }[];
}

interface SearchProblem {
  id: string;
  displayNumber: string | null;
  problemNumber: string | null;
  stemText: string;
  stemLatex: string;
  problemType: string;
  difficulty: number | null;
  unitMajor: string | null;
  subject: string | null;
}

interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// --- Helpers ---

const TYPE_LABELS: Record<string, string> = {
  problem_set: "문제풀이",
  text_task: "일반과제",
};

const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  draft: { label: "초안", className: "bg-muted text-muted-foreground" },
  published: {
    label: "배포됨",
    className: "bg-green-900/30 text-green-400 border-green-400/30",
  },
  closed: {
    label: "마감",
    className: "bg-red-900/30 text-red-400 border-red-400/30",
  },
};

const SUBMISSION_STATUS: Record<string, { label: string; className: string }> =
  {
    pending: { label: "미제출", className: "text-muted-foreground" },
    submitted: {
      label: "제출완료",
      className: "text-blue-400",
    },
    graded: {
      label: "채점완료",
      className: "text-green-400",
    },
    returned: {
      label: "반환됨",
      className: "text-yellow-400",
    },
  };

const CIRCLE_NUMBERS = ["\u2460", "\u2461", "\u2462", "\u2463", "\u2464"];

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "short",
    day: "numeric",
    weekday: "short",
  });
}

function stripLatexForPreview(text: string): string {
  return text
    .replace(/\$\$[\s\S]*?\$\$/g, "[수식]")
    .replace(/\$[^$]+?\$/g, "[수식]")
    .replace(/\\[a-zA-Z]+\{[^}]*\}/g, "")
    .replace(/\\[a-zA-Z]+/g, "")
    .replace(/[{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// --- Add Problem Modal ---

function AddProblemModal({
  open,
  onOpenChange,
  assignmentId,
  existingProblemIds,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assignmentId: string;
  existingProblemIds: Set<string>;
}) {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [selected, setSelected] = useState<SearchProblem[]>([]);

  const queryString = [
    `page=${page}`,
    `limit=10`,
    `reviewStatus=approved`,
    searchQuery && `q=${encodeURIComponent(searchQuery)}`,
  ]
    .filter(Boolean)
    .join("&");

  const { data, isLoading } = useQuery({
    queryKey: ["problems-for-assignment", page, searchQuery],
    queryFn: () =>
      api.get<PaginatedResponse<SearchProblem>>(`/problems?${queryString}`),
    enabled: open,
  });

  const addMutation = useMutation({
    mutationFn: (problemIds: string[]) =>
      api.post(`/assignments/${assignmentId}/problems`, { problemIds }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["assignment", assignmentId] });
      setSelected([]);
      onOpenChange(false);
    },
  });

  const problems = data?.data ?? [];
  const totalPages = data?.totalPages ?? 0;
  const selectedIds = new Set(selected.map((p) => p.id));

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setSearchQuery(searchInput);
    setPage(1);
  }

  function toggleProblem(problem: SearchProblem) {
    setSelected((prev) => {
      if (prev.find((p) => p.id === problem.id))
        return prev.filter((p) => p.id !== problem.id);
      return [...prev, problem];
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>문제 추가</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSearch} className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="문제 검색..."
              className="pl-9 bg-brand-charcoal border-transparent"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
          </div>
          <Button type="submit" variant="secondary" size="sm">
            검색
          </Button>
        </form>

        {selected.length > 0 && (
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              <Check className="mr-1 inline h-3 w-3 text-green-400" />
              {selected.length}개 선택됨
            </span>
            <Button
              size="sm"
              onClick={() => addMutation.mutate(selected.map((p) => p.id))}
              disabled={addMutation.isPending}
            >
              {addMutation.isPending ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Plus className="mr-1.5 h-3.5 w-3.5" />
              )}
              추가
            </Button>
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-y-auto space-y-2">
          {isLoading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-16 rounded-lg" />
            ))
          ) : problems.length === 0 ? (
            <div className="flex flex-col items-center py-10 text-muted-foreground">
              <Inbox className="h-10 w-10" />
              <p className="mt-2 text-sm">검색 결과가 없습니다</p>
            </div>
          ) : (
            problems.map((problem) => {
              const alreadyAdded = existingProblemIds.has(problem.id);
              const isSelected = selectedIds.has(problem.id);
              return (
                <button
                  key={problem.id}
                  type="button"
                  disabled={alreadyAdded}
                  onClick={() => toggleProblem(problem)}
                  className={`w-full rounded-lg border p-3 text-left transition-colors ${
                    alreadyAdded
                      ? "border-border/50 opacity-50 cursor-not-allowed"
                      : isSelected
                        ? "border-brand-beige bg-brand-beige/10"
                        : "border-border hover:border-brand-beige/50"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold ${
                        alreadyAdded
                          ? "bg-green-900/30 text-green-400"
                          : isSelected
                            ? "bg-brand-beige text-brand-dark"
                            : "bg-brand-dark text-brand-beige"
                      }`}
                    >
                      {alreadyAdded ? (
                        <Check className="h-4 w-4" />
                      ) : isSelected ? (
                        <Check className="h-4 w-4" />
                      ) : (
                        problem.displayNumber || problem.problemNumber || "?"
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">
                        {stripLatexForPreview(
                          (problem.stemText || problem.stemLatex || "")
                            .split("\n")[0]
                            .slice(0, 100)
                        )}
                      </p>
                      <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                        {problem.subject && <span>{problem.subject}</span>}
                        {problem.unitMajor && (
                          <>
                            <span>&middot;</span>
                            <span>{problem.unitMajor}</span>
                          </>
                        )}
                        {alreadyAdded && <span>(이미 추가됨)</span>}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-4 pt-2 border-t border-border">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
            >
              <ChevronLeft className="h-4 w-4" />
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
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// --- Grading Row ---

function GradingRow({
  submission,
  assignmentType,
  problems,
}: {
  submission: Submission;
  assignmentType: string;
  problems: AssignmentProblem[];
}) {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [score, setScore] = useState(
    submission.score != null ? String(submission.score) : ""
  );
  const [feedback, setFeedback] = useState(submission.feedback ?? "");

  const gradeMutation = useMutation({
    mutationFn: (body: { score: number; feedback?: string }) =>
      api.post(`/submissions/${submission.id}/grade`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["submissions"] });
    },
  });

  const statusInfo = SUBMISSION_STATUS[submission.status] ?? {
    label: submission.status,
    className: "text-muted-foreground",
  };

  function handleGrade() {
    const numScore = Number(score);
    if (isNaN(numScore) || numScore < 0) return;
    gradeMutation.mutate({
      score: numScore,
      feedback: feedback.trim() || undefined,
    });
  }

  return (
    <div className="rounded-lg border border-border">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-3 p-3 text-left hover:bg-brand-charcoal/30 transition-colors"
      >
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-dark text-xs font-medium text-brand-beige">
          {(submission.student?.name ?? "?")[0]}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">
            {submission.student?.name ?? "학생"}
          </p>
          <p className="text-xs text-muted-foreground">
            {submission.submittedAt
              ? formatDate(submission.submittedAt)
              : "미제출"}
          </p>
        </div>
        <span className={`text-xs font-medium ${statusInfo.className}`}>
          {statusInfo.label}
        </span>
        {submission.score != null && (
          <span className="text-sm font-bold text-brand-beige">
            {submission.score}/{submission.maxScore}
          </span>
        )}
        <ChevronDown
          className={`h-4 w-4 text-muted-foreground transition-transform ${
            expanded ? "rotate-180" : ""
          }`}
        />
      </button>

      {expanded && (
        <div className="border-t border-border p-4 space-y-4">
          {/* For problem_set: show answers */}
          {assignmentType === "problem_set" &&
            submission.answers &&
            submission.answers.length > 0 && (
              <div className="space-y-3">
                <h4 className="text-sm font-medium text-muted-foreground">
                  답안
                </h4>
                {submission.answers.map((ans, i) => {
                  const prob = problems.find(
                    (p) => p.problem.id === ans.problemId
                  );
                  return (
                    <div
                      key={ans.problemId}
                      className="flex items-start gap-3 rounded-lg bg-brand-dark p-3"
                    >
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-brand-charcoal text-xs font-bold text-brand-beige">
                        {i + 1}
                      </span>
                      <div className="min-w-0 flex-1 space-y-1">
                        <p className="text-xs text-muted-foreground">
                          학생 답:{" "}
                          <span className="text-foreground">{ans.answer}</span>
                        </p>
                        {prob?.problem.answerText && (
                          <p className="text-xs text-muted-foreground">
                            정답:{" "}
                            <span className="text-green-400">
                              {prob.problem.answerText}
                            </span>
                          </p>
                        )}
                      </div>
                      {ans.isCorrect != null && (
                        <span
                          className={`text-xs font-medium ${
                            ans.isCorrect ? "text-green-400" : "text-red-400"
                          }`}
                        >
                          {ans.isCorrect ? "정답" : "오답"}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

          {/* For text_task / photo submissions */}
          {submission.photos && submission.photos.length > 0 && (
            <div className="space-y-3">
              <h4 className="text-sm font-medium text-muted-foreground">
                제출 사진
              </h4>
              <div className="grid grid-cols-2 gap-2">
                {submission.photos.map((photo) => (
                  <div key={photo.id} className="space-y-1">
                    <img
                      src={photo.url}
                      alt="제출물"
                      className="rounded-lg border border-border object-cover"
                      loading="lazy"
                    />
                    {photo.aiFeedback && (
                      <p className="text-xs text-muted-foreground">
                        AI: {photo.aiFeedback}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Grading inputs */}
          {submission.status !== "pending" && (
            <div className="space-y-3 rounded-lg border border-border p-3">
              <h4 className="text-sm font-medium">채점</h4>
              <div className="grid grid-cols-[100px_1fr] gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">점수</Label>
                  <Input
                    type="number"
                    min={0}
                    max={submission.maxScore}
                    value={score}
                    onChange={(e) => setScore(e.target.value)}
                    className="h-9"
                  />
                  <p className="text-[10px] text-muted-foreground">
                    / {submission.maxScore}점
                  </p>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">피드백</Label>
                  <Textarea
                    value={feedback}
                    onChange={(e) => setFeedback(e.target.value)}
                    placeholder="학생에게 전달할 피드백..."
                    rows={2}
                    className="resize-none"
                  />
                </div>
              </div>
              <Button
                size="sm"
                onClick={handleGrade}
                disabled={!score || gradeMutation.isPending}
              >
                {gradeMutation.isPending ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Check className="mr-1.5 h-3.5 w-3.5" />
                )}
                {submission.status === "graded" ? "채점 수정" : "채점 완료"}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// --- Score Distribution ---

function ScoreDistribution({
  submissions,
  maxScore,
}: {
  submissions: Submission[];
  maxScore: number;
}) {
  const graded = submissions.filter(
    (s) => s.status === "graded" && s.score != null
  );
  if (graded.length === 0) return null;

  // Create 5 buckets
  const bucketSize = maxScore / 5;
  const buckets = [0, 0, 0, 0, 0];
  for (const s of graded) {
    const idx = Math.min(4, Math.floor((s.score! / maxScore) * 5));
    buckets[idx]++;
  }
  const maxBucket = Math.max(...buckets, 1);
  const avg =
    graded.reduce((sum, s) => sum + (s.score ?? 0), 0) / graded.length;

  const bucketLabels = Array.from({ length: 5 }, (_, i) => {
    const low = Math.round(i * bucketSize);
    const high = Math.round((i + 1) * bucketSize);
    return `${low}-${high}`;
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">점수 분포</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-end gap-1 h-20">
          {buckets.map((count, i) => (
            <div key={i} className="flex flex-1 flex-col items-center gap-1">
              <div
                className="w-full rounded-t bg-brand-beige/80 transition-all"
                style={{
                  height: `${(count / maxBucket) * 100}%`,
                  minHeight: count > 0 ? "4px" : "0",
                }}
              />
              <span className="text-[9px] text-muted-foreground">
                {bucketLabels[i]}
              </span>
            </div>
          ))}
        </div>
        <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
          <span>채점: {graded.length}명</span>
          <span className="font-medium text-brand-beige">
            평균 {Math.round(avg)}점
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

// --- Main Page ---

export default function AssignmentDetailPage() {
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const assignmentId = params.id as string;
  const [addProblemOpen, setAddProblemOpen] = useState(false);

  const assignmentQuery = useQuery({
    queryKey: ["assignment", assignmentId],
    queryFn: () => api.get<Assignment>(`/assignments/${assignmentId}`),
  });

  const submissionsQuery = useQuery({
    queryKey: ["submissions", assignmentId],
    queryFn: () =>
      api.get<Submission[] | PaginatedResponse<Submission>>(
        `/submissions?assignmentId=${assignmentId}`
      ),
    enabled: !!assignmentId,
  });

  const returnAllMutation = useMutation({
    mutationFn: () =>
      api.post(`/assignments/${assignmentId}/return-all`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["submissions", assignmentId] });
    },
  });

  const assignment = assignmentQuery.data;
  const submissions: Submission[] = submissionsQuery.data
    ? Array.isArray(submissionsQuery.data)
      ? submissionsQuery.data
      : submissionsQuery.data.data
    : [];

  const problems = assignment?.problems ?? [];
  const existingProblemIds = new Set(problems.map((p) => p.problem.id));
  const gradedCount = submissions.filter((s) => s.status === "graded").length;
  const submittedCount = submissions.filter(
    (s) => s.status !== "pending"
  ).length;

  // Loading
  if (assignmentQuery.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-48 rounded-lg" />
        <Skeleton className="h-24 rounded-xl" />
        <Skeleton className="h-[400px] rounded-xl" />
      </div>
    );
  }

  // Error
  if (assignmentQuery.isError || !assignment) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" size="sm" onClick={() => router.back()}>
          <ArrowLeft className="mr-1 h-4 w-4" />
          돌아가기
        </Button>
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <AlertCircle className="h-12 w-12 text-destructive" />
            <p className="mt-4 text-lg font-medium">
              과제를 불러오지 못했습니다
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const typeLabel = TYPE_LABELS[assignment.type] ?? assignment.type;
  const statusInfo = STATUS_LABELS[assignment.status] ?? {
    label: assignment.status,
    className: "bg-muted text-muted-foreground",
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push("/assignments")}
        >
          <ArrowLeft className="mr-1 h-4 w-4" />
          과제 목록
        </Button>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight">
                {assignment.title}
              </h1>
              <span
                className={`rounded-full border px-2.5 py-1 text-xs font-medium ${statusInfo.className}`}
              >
                {statusInfo.label}
              </span>
            </div>
            {assignment.description && (
              <p className="mt-1 text-sm text-muted-foreground">
                {assignment.description}
              </p>
            )}
          </div>
        </div>

        {/* Meta row */}
        <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
          {assignment.class && (
            <span className="flex items-center gap-1">
              <Users className="h-3.5 w-3.5" />
              {assignment.class.title}
            </span>
          )}
          <Badge variant="outline">{typeLabel}</Badge>
          {assignment.dueAt && (
            <span className="flex items-center gap-1">
              <Calendar className="h-3.5 w-3.5" />
              {formatDate(assignment.dueAt)}
            </span>
          )}
          <span>배점: {assignment.maxScore}점</span>
          <span>
            제출: {submittedCount}명 · 채점: {gradedCount}명
          </span>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue={assignment.type === "problem_set" ? "problems" : "submissions"}>
        <TabsList>
          {assignment.type === "problem_set" && (
            <TabsTrigger value="problems">
              문제 ({problems.length})
            </TabsTrigger>
          )}
          <TabsTrigger value="submissions">
            제출/채점 ({submissions.length})
          </TabsTrigger>
        </TabsList>

        {/* Problems Tab */}
        {assignment.type === "problem_set" && (
          <TabsContent value="problems" className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                {problems.length}개의 문제가 포함되어 있습니다.
              </p>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setAddProblemOpen(true)}
              >
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                문제 추가
              </Button>
            </div>

            {problems.length === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-16">
                  <Inbox className="h-12 w-12 text-muted-foreground" />
                  <p className="mt-4 text-sm text-muted-foreground">
                    아직 문제가 없습니다. 문제를 추가해주세요.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {problems
                  .sort((a, b) => a.order - b.order)
                  .map((ap, idx) => (
                    <Card key={ap.id}>
                      <CardContent className="p-4">
                        <div className="flex items-start gap-3">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-dark text-sm font-bold text-brand-beige">
                            {idx + 1}
                          </span>
                          <div className="min-w-0 flex-1">
                            <LatexRenderer
                              content={
                                ap.problem.stemLatex ||
                                ap.problem.stemText ||
                                ""
                              }
                              className="text-sm leading-relaxed"
                            />
                            {/* Choices */}
                            {ap.problem.choices &&
                              ap.problem.choices.length > 0 && (
                                <div className="mt-3 space-y-1.5 border-t border-border pt-3">
                                  {ap.problem.choices.map((choice, ci) => (
                                    <div
                                      key={ci}
                                      className="flex items-start gap-2 text-sm"
                                    >
                                      <span className="shrink-0 text-brand-beige">
                                        {choice.label ||
                                          CIRCLE_NUMBERS[ci] ||
                                          `(${ci + 1})`}
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
                                  ))}
                                </div>
                              )}
                            {/* Answer */}
                            {ap.problem.answerText && (
                              <div className="mt-2 text-xs text-muted-foreground">
                                정답:{" "}
                                <span className="font-medium text-green-400">
                                  {ap.problem.answerText}
                                </span>
                              </div>
                            )}
                          </div>
                          {ap.problem.difficulty != null && (
                            <Badge variant="outline" className="shrink-0 text-xs">
                              난이도 {ap.problem.difficulty}
                            </Badge>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
              </div>
            )}

            <AddProblemModal
              open={addProblemOpen}
              onOpenChange={setAddProblemOpen}
              assignmentId={assignmentId}
              existingProblemIds={existingProblemIds}
            />
          </TabsContent>
        )}

        {/* Submissions Tab */}
        <TabsContent value="submissions" className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              {submittedCount}명 제출 · {gradedCount}명 채점 완료
            </p>
            {gradedCount > 0 && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => returnAllMutation.mutate()}
                disabled={returnAllMutation.isPending}
              >
                {returnAllMutation.isPending ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Send className="mr-1.5 h-3.5 w-3.5" />
                )}
                전체 반환
              </Button>
            )}
          </div>

          {/* Score distribution */}
          <ScoreDistribution
            submissions={submissions}
            maxScore={assignment.maxScore}
          />

          {/* Loading */}
          {submissionsQuery.isLoading && (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-16 rounded-lg" />
              ))}
            </div>
          )}

          {/* Submission list */}
          {!submissionsQuery.isLoading && submissions.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-16">
                <Inbox className="h-12 w-12 text-muted-foreground" />
                <p className="mt-4 text-sm text-muted-foreground">
                  아직 제출물이 없습니다.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {submissions.map((sub) => (
                <GradingRow
                  key={sub.id}
                  submission={sub}
                  assignmentType={assignment.type}
                  problems={problems}
                />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
