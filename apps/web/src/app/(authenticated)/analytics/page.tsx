"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import {
  Activity,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Loader2,
} from "lucide-react";

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
  };
}

interface FileItem {
  id: string;
  filename: string;
  createdAt: string;
  ocrJobId: string | null;
  ocrStatus: "pending" | "processing" | "completed" | "failed" | null;
  problemCount: number;
  documentType: string;
  bookTitle: string | null;
}

const statusMap = {
  completed: { label: "완료", color: "text-green-400" },
  processing: { label: "처리중", color: "text-yellow-400" },
  pending: { label: "대기", color: "text-muted-foreground" },
  failed: { label: "실패", color: "text-red-400" },
};

export default function AnalyticsPage() {
  const statsQuery = useQuery({
    queryKey: ["problems", "stats"],
    queryFn: () => api.get<StatsResponse>("/problems/stats"),
  });

  const filesQuery = useQuery({
    queryKey: ["files"],
    queryFn: () => api.get<FileItem[]>("/files"),
  });

  const files = filesQuery.data ?? [];
  const stats = statsQuery.data;

  const cards = [
    {
      title: "총 OCR 작업",
      value: stats?.ocr.totalJobs ?? null,
      unit: "건",
      icon: Activity,
      description: "누적 OCR job 수",
    },
    {
      title: "성공률",
      value:
        stats?.ocr.successRate != null
          ? `${Math.round(stats.ocr.successRate * 100)}`
          : null,
      unit: "%",
      icon: CheckCircle2,
      description: `${stats?.ocr.completedJobs ?? 0}건 완료`,
    },
    {
      title: "실패 작업",
      value: stats?.ocr.failedJobs ?? null,
      unit: "건",
      icon: AlertTriangle,
      description: "재처리 확인 필요",
    },
    {
      title: "검수 대기",
      value: stats?.problems.pendingReview ?? null,
      unit: "문제",
      icon: Clock,
      description: "승인 전 문제 수",
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">OCR 현황</h1>
        <p className="text-muted-foreground">
          현재 저장된 OCR 작업과 검수 상태를 표시합니다.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {cards.map((stat) => (
          <Card key={stat.title}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {stat.title}
              </CardTitle>
              <stat.icon className="h-4 w-4 text-brand-beige" />
            </CardHeader>
            <CardContent>
              {statsQuery.isLoading ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="text-sm">불러오는 중</span>
                </div>
              ) : (
                <>
                  <div className="text-2xl font-bold">
                    {stat.value ?? "—"}
                    <span className="ml-1 text-sm font-normal text-muted-foreground">
                      {stat.unit}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {stat.description}
                  </p>
                </>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">최근 업로드</CardTitle>
          <Badge variant="outline" className="font-mono text-xs">
            <Activity className="mr-1 h-3 w-3" />
            실제 데이터
          </Badge>
        </CardHeader>
        <CardContent>
          {filesQuery.isLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">파일 목록을 불러오는 중</span>
            </div>
          ) : files.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              표시할 OCR 업로드가 없습니다.
            </p>
          ) : (
            <div className="space-y-2">
              {files.slice(0, 8).map((job) => (
              <div
                key={job.id}
                className="flex items-center justify-between rounded-lg border border-border p-3"
              >
                <div className="flex items-center gap-3">
                  <span className="font-mono text-xs text-muted-foreground">
                    {job.ocrJobId ?? job.id}
                  </span>
                  <div>
                    <p className="text-sm font-medium">
                      {job.bookTitle ?? job.filename}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {job.documentType}
                      {job.problemCount > 0 ? ` / ${job.problemCount}문제` : ""}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground">
                    {new Date(job.createdAt).toLocaleString("ko-KR")}
                  </span>
                  <span
                    className={`text-xs font-medium ${statusMap[job.ocrStatus ?? "pending"].color}`}
                  >
                    {job.ocrStatus === "failed" && (
                      <AlertTriangle className="mr-1 inline h-3 w-3" />
                    )}
                    {statusMap[job.ocrStatus ?? "pending"].label}
                  </span>
                </div>
              </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
