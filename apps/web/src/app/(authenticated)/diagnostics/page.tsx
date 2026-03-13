"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  BrainCircuit,
  Clock,
  FileText,
  Inbox,
  AlertCircle,
  LoaderCircle,
  ChevronRight,
} from "lucide-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { toast } from "sonner";

interface DiagnosticSession {
  id: string;
  status: "in_progress" | "completed" | "abandoned";
  startedAt: string;
  completedAt: string | null;
  result: Array<{
    subject: string;
    unitMajor: string;
    score: number;
    level: string;
  }> | null;
  responseCount: number;
}

interface StartResponse {
  session: { id: string; status: string; startedAt: string };
  problem: unknown;
  progress: { current: number; total: number };
}

const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  completed: {
    label: "완료",
    className: "bg-green-900/30 text-green-400 border-green-400/30",
  },
  in_progress: {
    label: "진행 중",
    className: "bg-yellow-900/30 text-yellow-400 border-yellow-400/30",
  },
  abandoned: {
    label: "중단",
    className: "bg-red-900/30 text-red-400 border-red-400/30",
  },
};

function averageScore(
  result: Array<{ score: number }> | null,
): number | null {
  if (!result || result.length === 0) return null;
  return Math.round(
    result.reduce((sum, r) => sum + r.score, 0) / result.length,
  );
}

export default function DiagnosticsPage() {
  const router = useRouter();

  const {
    data: sessions,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ["diagnostic-history"],
    queryFn: () => api.get<DiagnosticSession[]>("/diagnostics/history"),
  });

  const startMutation = useMutation({
    mutationFn: () => api.post<StartResponse>("/diagnostics/start"),
    onSuccess: (data) => {
      // Store the first problem so the session page can use it immediately
      sessionStorage.setItem(
        `diagnostic-${data.session.id}`,
        JSON.stringify(data),
      );
      router.push(`/diagnostics/${data.session.id}`);
    },
    onError: (err) => {
      toast.error(
        err instanceof Error ? err.message : "진단 평가를 시작할 수 없습니다.",
      );
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">AI 진단 평가</h1>
        <p className="text-muted-foreground">
          IRT 기반 적응형 진단으로 학습 수준을 정밀하게 파악합니다.
        </p>
      </div>

      {/* Start card */}
      <Card className="border-brand-beige/20">
        <CardContent className="flex items-start gap-6 p-6">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-brand-beige/10">
            <BrainCircuit className="h-7 w-7 text-brand-beige" />
          </div>
          <div className="flex-1 space-y-2">
            <h2 className="text-lg font-semibold">적응형 진단 시작</h2>
            <p className="text-sm text-muted-foreground">
              AI가 답변 결과에 따라 난이도를 실시간으로 조절합니다. 약 25문제,
              10분 내외가 소요되며, 완료 후 단원별 능력 프로필을 확인할 수 있습니다.
            </p>
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <FileText className="h-3.5 w-3.5" />
                25~30문제
              </span>
              <span className="flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" />
                약 10분
              </span>
            </div>
          </div>
          <Button
            onClick={() => startMutation.mutate()}
            disabled={startMutation.isPending}
            className="shrink-0"
          >
            {startMutation.isPending && (
              <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
            )}
            진단 시작
          </Button>
        </CardContent>
      </Card>

      {/* History */}
      <div>
        <h2 className="mb-3 text-lg font-semibold">진단 이력</h2>

        {isLoading && (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-[72px] rounded-xl" />
            ))}
          </div>
        )}

        {isError && (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <AlertCircle className="h-10 w-10 text-destructive" />
              <p className="mt-3 text-sm font-medium">
                진단 이력을 불러오지 못했습니다
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {error instanceof Error ? error.message : "Unknown error"}
              </p>
            </CardContent>
          </Card>
        )}

        {!isLoading && !isError && sessions?.length === 0 && (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16">
              <Inbox className="h-12 w-12 text-muted-foreground" />
              <p className="mt-4 text-sm font-medium text-foreground">
                아직 진단 기록이 없습니다
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                위 버튼을 눌러 첫 진단 평가를 시작하세요.
              </p>
            </CardContent>
          </Card>
        )}

        {!isLoading && !isError && sessions && sessions.length > 0 && (
          <div className="space-y-2">
            {sessions.map((session) => {
              const status = STATUS_LABELS[session.status] ?? {
                label: session.status,
                className: "bg-muted text-muted-foreground",
              };
              const avg = averageScore(session.result);

              return (
                <Card
                  key={session.id}
                  className="cursor-pointer transition-colors hover:border-brand-beige/40"
                  onClick={() => {
                    if (session.status === "in_progress") {
                      router.push(`/diagnostics/${session.id}`);
                    } else {
                      router.push(`/diagnostics/${session.id}/result`);
                    }
                  }}
                >
                  <CardContent className="flex items-center gap-4 p-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium">
                          {new Date(session.startedAt).toLocaleDateString(
                            "ko-KR",
                            {
                              year: "numeric",
                              month: "long",
                              day: "numeric",
                            },
                          )}
                        </p>
                        <Badge
                          variant="outline"
                          className={status.className}
                        >
                          {status.label}
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {session.responseCount}문제 응답
                        {avg !== null && ` \u00B7 평균 ${avg}점`}
                      </p>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
