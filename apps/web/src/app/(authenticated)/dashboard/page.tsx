"use client";

import {
  BookOpen,
  FileText,
  Upload,
  ClipboardCheck,
  TrendingUp,
  Clock,
  AlertCircle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import Link from "next/link";

function stripLatex(text: string): string {
  return text
    .replace(/\$\$[\s\S]*?\$\$/g, "[수식]")
    .replace(/\$[^$]+?\$/g, "[수식]")
    .replace(/\\left[\\{(|]/g, "")
    .replace(/\\right[\\})|]/g, "")
    .replace(/\\[a-zA-Z]+\{[^}]*\}/g, "")
    .replace(/\\[a-zA-Z]+/g, "")
    .replace(/[{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

interface ClassItem {
  id: string;
  title: string;
}

interface Problem {
  id: string;
  stemText?: string;
  stemLatex?: string;
  displayNumber?: string;
  problemNumber?: string;
  createdAt: string;
  reviewStatus: string;
  sourceFile?: string;
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

export default function DashboardPage() {
  const { user } = useAuth();

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

  // Derive stat values from query results
  const classCount = classesQuery.data
    ? Array.isArray(classesQuery.data)
      ? classesQuery.data.length
      : classesQuery.data.total
    : null;

  const problemCount = statsQuery.data?.problems.total ?? null;
  const pendingCount = statsQuery.data?.problems.pendingReview ?? null;
  const ocrSuccessRate = statsQuery.data?.ocr.successRate;
  const ocrSuccessDisplay =
    ocrSuccessRate != null ? `${Math.round(ocrSuccessRate * 100)}%` : null;

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
      title: "문제은행",
      value: problemCount,
      description: "등록된 문제 수",
      icon: FileText,
      isLoading: statsQuery.isLoading,
      isError: statsQuery.isError,
    },
    {
      title: "OCR 처리",
      value: null,
      description: `완료 ${statsQuery.data?.ocr.completedJobs ?? 0} / 전체 ${statsQuery.data?.ocr.totalJobs ?? 0}`,
      icon: TrendingUp,
      isLoading: statsQuery.isLoading,
      isError: statsQuery.isError,
      displayOverride: ocrSuccessDisplay,
    },
    {
      title: "검수 대기",
      value: pendingCount,
      description: "승인 필요한 문제",
      icon: ClipboardCheck,
      isLoading: statsQuery.isLoading,
      isError: statsQuery.isError,
    },
  ];

  const recentProblems = recentProblemsQuery.data?.data ?? [];

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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">대시보드</h1>
        <p className="text-muted-foreground">
          안녕하세요, {user?.name ?? "선생"}님. 오늘의 현황입니다.
        </p>
      </div>

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
                  {"displayOverride" in stat && stat.displayOverride
                    ? stat.displayOverride
                    : stat.value !== null
                      ? formatNumber(stat.value)
                      : "—"}
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                {stat.description}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">최근 문제</CardTitle>
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
                  return (
                    <div
                      key={problem.id}
                      className="flex items-center justify-between rounded-lg border border-border p-3"
                    >
                      <div className="space-y-1">
                        <p className="text-sm font-medium truncate">
                          {problem.displayNumber || problem.problemNumber
                            ? `${problem.displayNumber || problem.problemNumber}번 `
                            : ""}
                          {stripLatex(
                            (problem.stemText || problem.stemLatex || "")
                              .split("\n")[0]
                              .slice(0, 80)
                          ) || `문제 #${problem.id.slice(0, 8)}`}
                        </p>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {formatDate(problem.createdAt)}
                          </span>
                        </div>
                      </div>
                      <Badge variant={status.variant}>{status.label}</Badge>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">빠른 작업</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            <Button className="justify-start" variant="secondary" asChild>
              <Link href="/upload">
                <Upload className="mr-2 h-4 w-4" />
                PDF 업로드
              </Link>
            </Button>
            <Button className="justify-start" variant="secondary" asChild>
              <Link href="/review">
                <ClipboardCheck className="mr-2 h-4 w-4" />
                검수 대기 문제 확인
                {pendingCount !== null && pendingCount > 0 && (
                  <span className="ml-1">({formatNumber(pendingCount)})</span>
                )}
              </Link>
            </Button>
            <Button className="justify-start" variant="secondary" asChild>
              <Link href="/classes">
                <BookOpen className="mr-2 h-4 w-4" />
                반 만들기
              </Link>
            </Button>
            <Button className="justify-start" variant="secondary" asChild>
              <Link href="/problems">
                <FileText className="mr-2 h-4 w-4" />
                문제은행 검색
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
