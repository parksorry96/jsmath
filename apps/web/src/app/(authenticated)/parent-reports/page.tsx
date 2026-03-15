"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, AlertCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/api";

interface ParentLink {
  id: string;
  student: { id: string; name: string };
}

interface WeaknessEntry {
  unit: string;
  accuracy: number;
  correct: number;
  total: number;
  level: "red" | "yellow" | "green";
}

interface ScoreTrendEntry {
  date: string;
  score: number | null;
  maxScore: number;
  label: string;
}

interface WeeklyReport {
  id: string;
  weekStart: string;
  weekEnd: string;
  assignmentCompletionRate: number;
  avgScore: number | null;
  problemsSolved: number;
  correctRate: number | null;
  lessonsAttended: number;
  lessonsTotal: number;
  weaknessHeatmap: WeaknessEntry[];
  scoreTrend: ScoreTrendEntry[];
}

function getMonday(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? 6 : day - 1;
  d.setDate(d.getDate() - diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatWeekRange(start: string, end: string): string {
  const s = new Date(start);
  const e = new Date(end);
  const fmt = (d: Date) =>
    `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`;
  return `${fmt(s)} - ${fmt(e)}`;
}

function formatShortDate(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

const LEVEL_STYLES = {
  red: "bg-red-950 text-red-300 border-red-900",
  yellow: "bg-yellow-950 text-yellow-300 border-yellow-900",
  green: "bg-green-950 text-green-300 border-green-900",
} as const;

export default function ParentReportsPage() {
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedStudentId, setSelectedStudentId] = useState<string>("");

  const weekStart = getMonday(new Date());
  weekStart.setDate(weekStart.getDate() + weekOffset * 7);
  const weekStartStr = formatDateKey(weekStart);

  const childrenQuery = useQuery<ParentLink[]>({
    queryKey: ["parent-children-links"],
    queryFn: () => api.get("/parent-links/children"),
  });

  const children = childrenQuery.data ?? [];

  // Auto-select first child
  const studentId = selectedStudentId || children[0]?.student.id || "";

  const reportQuery = useQuery<WeeklyReport>({
    queryKey: ["parent-weekly-report", studentId, weekStartStr],
    queryFn: () =>
      api.get(
        `/analytics/parent/weekly-report/${studentId}?weekStart=${weekStartStr}`,
      ),
    enabled: !!studentId,
  });

  const report = reportQuery.data;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">학부모 리포트</h1>
        <p className="text-muted-foreground">
          자녀의 주간 학습 현황을 확인하세요.
        </p>
      </div>

      {/* Controls row */}
      <div className="flex flex-wrap items-center gap-4">
        {children.length > 1 && (
          <Select
            value={studentId}
            onValueChange={setSelectedStudentId}
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="학생 선택" />
            </SelectTrigger>
            <SelectContent>
              {children.map((c) => (
                <SelectItem key={c.student.id} value={c.student.id}>
                  {c.student.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setWeekOffset((o) => o - 1)}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-medium min-w-[180px] text-center">
            {report
              ? formatWeekRange(report.weekStart, report.weekEnd)
              : weekStartStr}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setWeekOffset((o) => Math.min(o + 1, 0))}
            disabled={weekOffset >= 0}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {childrenQuery.isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="pt-6">
                <Skeleton className="h-4 w-20 mb-2" />
                <Skeleton className="h-8 w-16" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : !studentId ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
            <AlertCircle className="h-8 w-8" />
            <p className="text-sm">연결된 학생이 없습니다.</p>
          </CardContent>
        </Card>
      ) : reportQuery.isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="pt-6">
                <Skeleton className="h-4 w-20 mb-2" />
                <Skeleton className="h-8 w-16" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : reportQuery.isError ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
            <AlertCircle className="h-8 w-8" />
            <p className="text-sm">리포트를 불러올 수 없습니다.</p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => reportQuery.refetch()}
            >
              다시 시도
            </Button>
          </CardContent>
        </Card>
      ) : report ? (
        <>
          {/* Summary cards */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <SummaryCard
              title="과제 완료율"
              value={`${report.assignmentCompletionRate}%`}
              description="이번 주 과제"
            />
            <SummaryCard
              title="평균 점수"
              value={report.avgScore !== null ? `${report.avgScore}점` : "-"}
              description="채점 완료 기준"
            />
            <SummaryCard
              title="풀이 문제 수"
              value={`${report.problemsSolved}개`}
              description="이번 주 제출"
            />
            <SummaryCard
              title="수업 출석"
              value={`${report.lessonsAttended} / ${report.lessonsTotal}`}
              description="이번 주 수업"
            />
          </div>

          {/* Correct rate bar */}
          {report.correctRate !== null && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">정답률</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-end gap-3 mb-3">
                  <span className="text-3xl font-bold">
                    {report.correctRate}%
                  </span>
                </div>
                <div className="h-3 w-full rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-brand-accent transition-all"
                    style={{ width: `${report.correctRate}%` }}
                  />
                </div>
              </CardContent>
            </Card>
          )}

          <div className="grid gap-6 lg:grid-cols-2">
            {/* Weakness heatmap */}
            {report.weaknessHeatmap.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    단원별 정답률 히트맵
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {report.weaknessHeatmap.map((entry) => (
                      <div
                        key={entry.unit}
                        className={`rounded-xl border p-3 ${LEVEL_STYLES[entry.level]}`}
                      >
                        <p className="text-xs font-medium truncate">
                          {entry.unit}
                        </p>
                        <p className="text-2xl font-bold mt-1">
                          {entry.accuracy}%
                        </p>
                        <p className="text-xs opacity-70">
                          {entry.correct}/{entry.total}문제
                        </p>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center gap-4 mt-4 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      <span className="inline-block h-3 w-3 rounded bg-red-950 border border-red-900" />
                      50% 미만
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="inline-block h-3 w-3 rounded bg-yellow-950 border border-yellow-900" />
                      50-75%
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="inline-block h-3 w-3 rounded bg-green-950 border border-green-900" />
                      75% 이상
                    </span>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Score trend */}
            {report.scoreTrend.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">점수 추이</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-end gap-2" style={{ height: 160 }}>
                    {report.scoreTrend.map((entry, idx) => {
                      const pct =
                        entry.score !== null
                          ? (entry.score / entry.maxScore) * 100
                          : 0;
                      return (
                        <div
                          key={`trend-${idx}`}
                          className="flex-1 flex flex-col items-center"
                        >
                          <span className="text-[10px] text-muted-foreground mb-1">
                            {entry.score !== null
                              ? Math.round(entry.score)
                              : "-"}
                          </span>
                          <div
                            className="w-full max-w-[32px] rounded-t-md bg-brand-accent transition-all"
                            style={{
                              height: `${Math.max(pct, 3)}%`,
                              minHeight: 4,
                            }}
                          />
                          <span className="text-[9px] text-muted-foreground mt-1 truncate w-full text-center">
                            {formatShortDate(entry.date)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}

function SummaryCard({
  title,
  value,
  description,
}: {
  title: string;
  value: string;
  description: string;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        <p className="text-xs text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}
