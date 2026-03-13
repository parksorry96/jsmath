"use client";

import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  AlertCircle,
  LoaderCircle,
  BarChart3,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";

interface TopicProfile {
  subject: string;
  unitMajor: string;
  score: number;
  level: string;
  theta: number;
  se: number;
  responses: number;
}

interface DiagnosticResult {
  id: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  result: TopicProfile[] | null;
  totalResponses: number;
}

function scoreColor(score: number): string {
  if (score >= 80) return "text-green-400";
  if (score >= 60) return "text-blue-400";
  if (score >= 40) return "text-yellow-400";
  return "text-red-400";
}

function scoreBgColor(score: number): string {
  if (score >= 80) return "bg-green-400";
  if (score >= 60) return "bg-blue-400";
  if (score >= 40) return "bg-yellow-400";
  return "bg-red-400";
}

function levelBadgeClass(level: string): string {
  switch (level) {
    case "우수":
      return "bg-green-900/30 text-green-400 border-green-400/30";
    case "양호":
      return "bg-blue-900/30 text-blue-400 border-blue-400/30";
    case "보통":
      return "bg-yellow-900/30 text-yellow-400 border-yellow-400/30";
    case "부족":
      return "bg-orange-900/30 text-orange-400 border-orange-400/30";
    case "매우 부족":
      return "bg-red-900/30 text-red-400 border-red-400/30";
    default:
      return "bg-muted text-muted-foreground";
  }
}

export default function DiagnosticResultPage() {
  const { id: sessionId } = useParams<{ id: string }>();
  const router = useRouter();

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["diagnostic-result", sessionId],
    queryFn: () => api.get<DiagnosticResult>(`/diagnostics/${sessionId}/result`),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <LoaderCircle className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="mx-auto max-w-2xl py-8">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <AlertCircle className="h-10 w-10 text-destructive" />
            <p className="mt-3 text-sm font-medium">
              결과를 불러오지 못했습니다
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {error instanceof Error ? error.message : "Unknown error"}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!data) return null;

  const profiles = data.result ?? [];
  const averageScore =
    profiles.length > 0
      ? Math.round(
          profiles.reduce((sum, p) => sum + p.score, 0) / profiles.length,
        )
      : 0;
  const maxBarScore = Math.max(...profiles.map((p) => p.score), 1);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push("/diagnostics")}
        >
          <ArrowLeft className="mr-1 h-4 w-4" />
          목록
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">진단 결과</h1>
          <p className="text-sm text-muted-foreground">
            {data.startedAt &&
              new Date(data.startedAt).toLocaleDateString("ko-KR", {
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            {" \u00B7 "}
            {data.totalResponses}문제 응답
          </p>
        </div>
      </div>

      {/* Summary card */}
      <Card className="border-brand-beige/20">
        <CardContent className="flex items-center gap-6 p-6">
          <div className="flex h-20 w-20 shrink-0 flex-col items-center justify-center rounded-2xl bg-brand-dark">
            <span className={`text-3xl font-bold ${scoreColor(averageScore)}`}>
              {averageScore}
            </span>
            <span className="text-xs text-muted-foreground">평균 점수</span>
          </div>
          <div className="flex-1 space-y-2">
            <p className="text-sm font-medium">
              총 {profiles.length}개 단원 진단 완료
            </p>
            <div className="flex flex-wrap gap-2">
              {["우수", "양호", "보통", "부족", "매우 부족"].map((level) => {
                const count = profiles.filter((p) => p.level === level).length;
                if (count === 0) return null;
                return (
                  <Badge
                    key={level}
                    variant="outline"
                    className={levelBadgeClass(level)}
                  >
                    {level} {count}개
                  </Badge>
                );
              })}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Bar chart */}
      {profiles.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <BarChart3 className="h-4 w-4" />
              단원별 능력 점수
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {profiles.map((profile) => (
              <div key={`${profile.subject}-${profile.unitMajor}`}>
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    {profile.subject} &gt; {profile.unitMajor}
                  </span>
                  <span className={`text-xs font-medium ${scoreColor(profile.score)}`}>
                    {profile.score}점
                  </span>
                </div>
                <div className="h-2.5 w-full overflow-hidden rounded-full bg-brand-charcoal">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${scoreBgColor(profile.score)}`}
                    style={{
                      width: `${(profile.score / 100) * 100}%`,
                    }}
                  />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Detail table */}
      {profiles.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">상세 결과</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th className="pb-2 pr-4 font-medium">과목</th>
                    <th className="pb-2 pr-4 font-medium">단원</th>
                    <th className="pb-2 pr-4 font-medium text-right">점수</th>
                    <th className="pb-2 pr-4 font-medium text-right">
                      신뢰도 (SE)
                    </th>
                    <th className="pb-2 pr-4 font-medium">수준</th>
                    <th className="pb-2 font-medium text-right">응답 수</th>
                  </tr>
                </thead>
                <tbody>
                  {profiles.map((profile) => (
                    <tr
                      key={`${profile.subject}-${profile.unitMajor}`}
                      className="border-b border-border/50"
                    >
                      <td className="py-2.5 pr-4">{profile.subject}</td>
                      <td className="py-2.5 pr-4">{profile.unitMajor}</td>
                      <td
                        className={`py-2.5 pr-4 text-right font-medium ${scoreColor(profile.score)}`}
                      >
                        {profile.score}
                      </td>
                      <td className="py-2.5 pr-4 text-right text-muted-foreground">
                        {profile.se.toFixed(2)}
                      </td>
                      <td className="py-2.5 pr-4">
                        <Badge
                          variant="outline"
                          className={levelBadgeClass(profile.level)}
                        >
                          {profile.level}
                        </Badge>
                      </td>
                      <td className="py-2.5 text-right text-muted-foreground">
                        {profile.responses}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Actions */}
      <div className="flex items-center gap-3">
        <Button
          variant="secondary"
          onClick={() => router.push("/diagnostics")}
        >
          진단 목록
        </Button>
      </div>
    </div>
  );
}
