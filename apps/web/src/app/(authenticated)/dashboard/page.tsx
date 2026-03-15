"use client";

import { useState } from "react";
import {
  BookOpen,
  FileText,
  Upload,
  ClipboardCheck,
  TrendingUp,
  Clock,
  AlertCircle,
  Eye,
  CalendarDays,
  GraduationCap,
  Monitor,
  Hammer,
  Settings,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import Link from "next/link";
import { LatexRenderer } from "@/components/math/latex-renderer";

interface ClassItem {
  id: string;
  title: string;
}

interface ProblemChoice {
  label?: string;
  contentText?: string;
  contentLatex?: string;
}

interface Problem {
  id: string;
  stemText?: string;
  stemLatex?: string;
  displayNumber?: string;
  problemNumber?: string;
  problemType: string;
  createdAt: string;
  reviewStatus: string;
  sourceFile?: string;
  choices?: ProblemChoice[];
  bookSource?: {
    title?: string;
    chapter?: string;
    section?: string;
    problemLabel?: string;
  };
}

interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

interface StatsResponse {
  ocr: {
    totalJobs: number;
    completedJobs: number;
    failedJobs: number;
    successRate: number | null;
  };
  problems: {
    total: number;
    pendingReview: number;
    approved: number;
    rejected: number;
  };
}

interface PendingAssignment {
  id: string;
  title: string;
  className: string | null;
  pendingCount: number;
}

interface Lesson {
  id: string;
  title: string;
  startTime: string;
  status: string;
}

function todayRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

export default function DashboardPage() {
  const { user } = useAuth();
  const [previewProblem, setPreviewProblem] = useState<Problem | null>(null);

  const classesQuery = useQuery({
    queryKey: ["classes"],
    queryFn: () => api.get<ClassItem[] | PaginatedResponse<ClassItem>>("/classes"),
  });

  const statsQuery = useQuery({
    queryKey: ["problems", "stats"],
    queryFn: () => api.get<StatsResponse>("/problems/stats"),
  });

  const recentProblemsQuery = useQuery({
    queryKey: ["problems", "recent"],
    queryFn: () => api.get<PaginatedResponse<Problem>>("/problems?limit=5"),
  });

  const pendingAssignmentsQuery = useQuery({
    queryKey: ["assignments", "pending"],
    queryFn: () =>
      api.get<PendingAssignment[]>("/classes/assignments?hasPending=true"),
  });

  const { start, end } = todayRange();
  const todayLessonsQuery = useQuery({
    queryKey: ["lessons", "today"],
    queryFn: () =>
      api.get<Lesson[]>(`/lessons/calendar?start=${start}&end=${end}`),
  });

  // Derive stat values
  const classCount = classesQuery.data
    ? Array.isArray(classesQuery.data)
      ? classesQuery.data.length
      : classesQuery.data.total
    : null;

  const problemCount = statsQuery.data?.problems.total ?? null;

  const pendingAssignments = pendingAssignmentsQuery.data ?? [];
  const totalPendingSubmissions = pendingAssignments.reduce(
    (sum, a) => sum + a.pendingCount,
    0,
  );

  const todayLessonCount = todayLessonsQuery.data?.length ?? null;

  const ocrStats = statsQuery.data?.ocr;
  const ocrSuccessRate = ocrStats?.successRate;
  const ocrSuccessDisplay =
    ocrSuccessRate != null ? `${Math.round(ocrSuccessRate * 100)}%` : "—";

  const stats = [
    {
      title: "총 반 수",
      value: classCount,
      description: "활성 반 수",
      icon: BookOpen,
      isLoading: classesQuery.isLoading,
      isError: classesQuery.isError,
    },
    {
      title: "채점 대기",
      value: totalPendingSubmissions,
      description: "미채점 제출물",
      icon: ClipboardCheck,
      isLoading: pendingAssignmentsQuery.isLoading,
      isError: pendingAssignmentsQuery.isError,
    },
    {
      title: "오늘 수업",
      value: todayLessonCount,
      description: "오늘 예정된 수업",
      icon: CalendarDays,
      isLoading: todayLessonsQuery.isLoading,
      isError: todayLessonsQuery.isError,
    },
    {
      title: "문제은행",
      value: problemCount,
      description: "등록된 문제 수",
      icon: FileText,
      isLoading: statsQuery.isLoading,
      isError: statsQuery.isError,
    },
  ];

  const recentProblems = recentProblemsQuery.data?.data ?? [];

  const getProblemSource = (problem: Problem) => {
    const title = problem.bookSource?.title || problem.sourceFile || "출처 미상";
    const detail = [problem.bookSource?.chapter, problem.bookSource?.section]
      .filter(Boolean)
      .join(" · ");

    return {
      title,
      detail: detail || "단원 정보 없음",
      label: problem.displayNumber || problem.problemNumber || null,
    };
  };

  const formatNumber = (n: number): string => {
    return n.toLocaleString("ko-KR");
  };

  const statusMap: Record<string, { label: string; variant: "default" | "secondary" | "outline" }> = {
    approved: { label: "완료", variant: "default" },
    pending_review: { label: "검수필요", variant: "outline" },
    draft: { label: "처리중", variant: "secondary" },
  };

  const formatDate = (dateStr: string): string => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMin = Math.floor(diffMs / 60_000);
    const diffHour = Math.floor(diffMs / 3_600_000);
    const diffDay = Math.floor(diffMs / 86_400_000);

    if (diffMin < 1) return "방금 전";
    if (diffMin < 60) return `${diffMin}분 전`;
    if (diffHour < 24) return `${diffHour}시간 전`;
    if (diffDay < 7) return `${diffDay}일 전`;
    return date.toLocaleDateString("ko-KR");
  };

  const quickActions = [
    { label: "PDF 업로드", href: "/upload", icon: Upload },
    { label: "검수 대기 확인", href: "/review", icon: ClipboardCheck },
    { label: "과제 만들기", href: "/assignments", icon: GraduationCap },
    { label: "실시간 모니터", href: "/class-monitor", icon: Monitor },
    { label: "시험지 제작", href: "/exam-builder", icon: Hammer },
    { label: "학원 운영", href: "/operations", icon: Settings },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">대시보드</h1>
        <p className="text-muted-foreground">
          안녕하세요, {user?.name ?? "선생"}님. 오늘의 현황입니다.
        </p>
      </div>

      {/* Top stats row */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.title}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {stat.title}
              </CardTitle>
              <stat.icon className="h-4 w-4 text-brand-beige" />
            </CardHeader>
            <CardContent>
              {stat.isLoading ? (
                <Skeleton className="h-8 w-20" />
              ) : stat.isError ? (
                <div className="flex items-center gap-1 text-destructive">
                  <AlertCircle className="h-4 w-4" />
                  <span className="text-sm">오류</span>
                </div>
              ) : (
                <div className="text-2xl font-bold">
                  {stat.value !== null ? formatNumber(stat.value) : "—"}
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                {stat.description}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Second row: pending assignments + recent activity */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Pending assignments */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">채점 대기 과제</CardTitle>
            <Button variant="ghost" size="sm" className="text-brand-beige" asChild>
              <Link href="/assignments">
                <GraduationCap className="mr-1 h-4 w-4" />
                전체 보기
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            {pendingAssignmentsQuery.isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between rounded-lg border border-border p-3"
                  >
                    <div className="space-y-2 flex-1">
                      <Skeleton className="h-4 w-3/4" />
                      <Skeleton className="h-3 w-1/2" />
                    </div>
                    <Skeleton className="h-5 w-10" />
                  </div>
                ))}
              </div>
            ) : pendingAssignmentsQuery.isError ? (
              <div className="flex flex-col items-center gap-2 py-6 text-muted-foreground">
                <AlertCircle className="h-8 w-8" />
                <p className="text-sm">데이터를 불러올 수 없습니다.</p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => pendingAssignmentsQuery.refetch()}
                >
                  다시 시도
                </Button>
              </div>
            ) : pendingAssignments.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-6 text-muted-foreground">
                <ClipboardCheck className="h-8 w-8" />
                <p className="text-sm">채점 대기 중인 과제가 없습니다.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {pendingAssignments.slice(0, 5).map((assignment) => (
                  <Link
                    key={assignment.id}
                    href={`/assignments/${assignment.id}`}
                    className="flex items-center justify-between rounded-lg border border-border p-3 transition-colors hover:bg-muted/50"
                  >
                    <div className="min-w-0 space-y-0.5">
                      <p className="truncate text-sm font-medium">
                        {assignment.title}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {assignment.className ?? "반 미지정"}
                      </p>
                    </div>
                    <Badge variant="outline" className="shrink-0 ml-2">
                      {assignment.pendingCount}건
                    </Badge>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent activity (problems) */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">최근 활동</CardTitle>
            <Button variant="ghost" size="sm" className="text-brand-beige" asChild>
              <Link href="/upload">
                <Upload className="mr-1 h-4 w-4" />
                새 업로드
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            {recentProblemsQuery.isLoading ? (
              <div className="space-y-4">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between rounded-lg border border-border p-3"
                  >
                    <div className="space-y-2 flex-1">
                      <Skeleton className="h-4 w-3/4" />
                      <Skeleton className="h-3 w-1/2" />
                    </div>
                    <Skeleton className="h-5 w-16" />
                  </div>
                ))}
              </div>
            ) : recentProblemsQuery.isError ? (
              <div className="flex flex-col items-center gap-2 py-6 text-muted-foreground">
                <AlertCircle className="h-8 w-8" />
                <p className="text-sm">데이터를 불러올 수 없습니다.</p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => recentProblemsQuery.refetch()}
                >
                  다시 시도
                </Button>
              </div>
            ) : recentProblems.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-6 text-muted-foreground">
                <FileText className="h-8 w-8" />
                <p className="text-sm">아직 등록된 문제가 없습니다.</p>
                <Button variant="ghost" size="sm" asChild>
                  <Link href="/upload">PDF 업로드하기</Link>
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                {recentProblems.map((problem) => {
                  const status = statusMap[problem.reviewStatus] ?? {
                    label: problem.reviewStatus,
                    variant: "secondary" as const,
                  };
                  const source = getProblemSource(problem);
                  return (
                    <div
                      key={problem.id}
                      className="flex items-start justify-between gap-3 rounded-lg border border-border p-3"
                    >
                      <div className="min-w-0 space-y-1">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-sm font-medium">{source.title}</p>
                          {source.label && (
                            <Badge variant="outline" className="shrink-0 text-[10px]">
                              {source.label}
                            </Badge>
                          )}
                        </div>
                        <p className="truncate text-xs text-muted-foreground">
                          {source.detail}
                        </p>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {formatDate(problem.createdAt)}
                          </span>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setPreviewProblem(problem)}
                        >
                          <Eye className="mr-1 h-4 w-4" />
                          미리보기
                        </Button>
                        <Badge variant={status.variant}>{status.label}</Badge>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Third row: quick actions + OCR status */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">빠른 작업</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            {quickActions.map((action) => (
              <Button
                key={action.href}
                className="justify-start"
                variant="secondary"
                asChild
              >
                <Link href={action.href}>
                  <action.icon className="mr-2 h-4 w-4" />
                  {action.label}
                </Link>
              </Button>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">OCR 현황</CardTitle>
          </CardHeader>
          <CardContent>
            {statsQuery.isLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-4 w-2/3" />
              </div>
            ) : statsQuery.isError ? (
              <div className="flex items-center gap-2 text-muted-foreground">
                <AlertCircle className="h-4 w-4" />
                <span className="text-sm">OCR 통계를 불러올 수 없습니다.</span>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-baseline gap-3">
                  <span className="text-3xl font-bold">{ocrSuccessDisplay}</span>
                  <span className="text-sm text-muted-foreground">성공률</span>
                </div>
                <div className="flex items-center gap-4 text-sm text-muted-foreground">
                  <div className="flex items-center gap-1.5">
                    <TrendingUp className="h-3.5 w-3.5 text-green-500" />
                    <span>완료 {ocrStats?.completedJobs ?? 0}</span>
                  </div>
                  <span className="text-border">/</span>
                  <span>전체 {ocrStats?.totalJobs ?? 0}</span>
                  {(ocrStats?.failedJobs ?? 0) > 0 && (
                    <>
                      <span className="text-border">/</span>
                      <span className="text-destructive">
                        실패 {ocrStats?.failedJobs}
                      </span>
                    </>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Problem preview dialog */}
      <Dialog open={previewProblem !== null} onOpenChange={(open) => !open && setPreviewProblem(null)}>
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-hidden p-0">
          {previewProblem && (
            <>
              <DialogHeader className="border-b border-border px-6 py-5">
                <DialogTitle className="flex items-center gap-2">
                  <span>{previewProblem.displayNumber || previewProblem.problemNumber || "문제 미리보기"}</span>
                  <Badge variant="outline">{getProblemSource(previewProblem).title}</Badge>
                </DialogTitle>
                <DialogDescription>
                  {getProblemSource(previewProblem).detail}
                </DialogDescription>
              </DialogHeader>
              <div className="overflow-y-auto px-6 py-5">
                <div className="rounded-xl border border-border bg-brand-dark p-5">
                  <LatexRenderer
                    content={previewProblem.stemLatex || previewProblem.stemText || ""}
                    className="text-sm leading-relaxed text-foreground"
                  />

                  {previewProblem.choices && previewProblem.choices.length > 0 && (
                    <div className="mt-5 space-y-2.5 border-t border-border pt-4">
                      {previewProblem.choices.map((choice, index) => (
                        <div key={`${previewProblem.id}-choice-${index}`} className="flex items-start gap-2 text-sm">
                          <span className="shrink-0 font-medium text-brand-beige">
                            {choice.label || `${index + 1}.`}
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
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
