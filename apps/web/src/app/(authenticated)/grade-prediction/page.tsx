"use client";

import { useState } from "react";
import {
  AlertCircle,
  Award,
  BarChart3,
  Pencil,
  Save,
  TrendingUp,
  X,
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import { isTeacherPortalRole, useAuth } from "@/lib/auth";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GradeCutoff {
  id: string;
  examYear: number;
  examMonth: number;
  subject: string;
  grade: number;
  minScore: number;
  maxScore: number;
  percentile: number | null;
}

interface SubjectPrediction {
  subject: string;
  predictedScore: number;
  predictedGrade: number;
  percentile: number | null;
  confidence: number;
  totalAnswered: number;
  totalCorrect: number;
}

interface PredictionResponse {
  studentId: string;
  predictions: SubjectPrediction[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GRADE_COLORS: Record<number, string> = {
  1: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  2: "bg-green-500/20 text-green-400 border-green-500/30",
  3: "bg-lime-500/20 text-lime-400 border-lime-500/30",
  4: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  5: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  6: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  7: "bg-red-500/20 text-red-400 border-red-500/30",
  8: "bg-red-700/20 text-red-500 border-red-700/30",
  9: "bg-red-900/20 text-red-600 border-red-900/30",
};

const GRADE_LABELS: Record<number, string> = {
  1: "1등급",
  2: "2등급",
  3: "3등급",
  4: "4등급",
  5: "5등급",
  6: "6등급",
  7: "7등급",
  8: "8등급",
  9: "9등급",
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-brand-charcoal">
        <div
          className="h-full rounded-full bg-blue-500 transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs text-muted-foreground">{pct}%</span>
    </div>
  );
}

function PredictionCard({ prediction }: { prediction: SubjectPrediction }) {
  const gradeColor = GRADE_COLORS[prediction.predictedGrade] ?? GRADE_COLORS[9];
  const accuracy =
    prediction.totalAnswered > 0
      ? Math.round((prediction.totalCorrect / prediction.totalAnswered) * 100)
      : 0;

  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <h3 className="text-sm font-medium text-muted-foreground">
              {prediction.subject}
            </h3>
            <div className="flex items-center gap-3">
              <span className="text-3xl font-bold tracking-tight">
                {prediction.predictedScore}
              </span>
              <span className="text-sm text-muted-foreground">/ 100</span>
            </div>
          </div>
          <div
            className={`flex h-14 w-14 items-center justify-center rounded-xl border ${gradeColor}`}
          >
            <span className="text-lg font-bold">
              {GRADE_LABELS[prediction.predictedGrade]}
            </span>
          </div>
        </div>

        <div className="mt-4 space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">정답률</span>
            <span className="font-medium">{accuracy}%</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">풀이 문제 수</span>
            <span className="font-medium">
              {prediction.totalCorrect}/{prediction.totalAnswered}
            </span>
          </div>
          {prediction.percentile != null && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">백분위</span>
              <span className="font-medium">상위 {100 - prediction.percentile}%</span>
            </div>
          )}
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">신뢰도</span>
            <ConfidenceBar value={prediction.confidence} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Cutoff Table (admin editable)
// ---------------------------------------------------------------------------

interface EditRow {
  grade: number;
  minScore: string;
  maxScore: string;
  percentile: string;
}

function CutoffTable({
  cutoffs,
  isAdmin,
}: {
  cutoffs: GradeCutoff[];
  isAdmin: boolean;
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [editRows, setEditRows] = useState<EditRow[]>([]);

  const mutation = useMutation({
    mutationFn: (payload: { cutoffs: Partial<GradeCutoff>[] }) =>
      api.post("/grade-prediction/cutoffs", payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["grade-cutoffs"] });
      setEditing(false);
    },
  });

  // Group by year/month/subject
  const grouped = cutoffs.reduce<
    Record<string, GradeCutoff[]>
  >((acc, c) => {
    const key = `${c.examYear}-${c.examMonth}-${c.subject}`;
    if (!acc[key]) acc[key] = [];
    acc[key].push(c);
    return acc;
  }, {});

  function startEdit(rows: GradeCutoff[]) {
    setEditRows(
      rows
        .sort((a, b) => a.grade - b.grade)
        .map((r) => ({
          grade: r.grade,
          minScore: String(r.minScore),
          maxScore: String(r.maxScore),
          percentile: r.percentile != null ? String(r.percentile) : "",
        })),
    );
    setEditing(true);
  }

  function saveEdit(examYear: number, examMonth: number, subject: string) {
    const payload = editRows.map((r) => ({
      examYear,
      examMonth,
      subject,
      grade: r.grade,
      minScore: parseInt(r.minScore, 10),
      maxScore: parseInt(r.maxScore, 10),
      percentile: r.percentile ? parseFloat(r.percentile) : undefined,
    }));
    mutation.mutate({ cutoffs: payload });
  }

  function updateEditRow(index: number, field: keyof EditRow, value: string) {
    setEditRows((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  }

  return (
    <div className="space-y-4">
      {Object.entries(grouped).map(([key, rows]) => {
        const first = rows[0];
        const sorted = rows.sort((a, b) => a.grade - b.grade);
        const isCurrentlyEditing = editing;

        return (
          <Card key={key}>
            <CardContent className="p-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold">
                  {first.examYear}년 {first.examMonth}월 {first.subject}
                </h3>
                {isAdmin && !isCurrentlyEditing && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => startEdit(sorted)}
                  >
                    <Pencil className="mr-1 h-3 w-3" />
                    수정
                  </Button>
                )}
                {isAdmin && isCurrentlyEditing && (
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setEditing(false)}
                    >
                      <X className="mr-1 h-3 w-3" />
                      취소
                    </Button>
                    <Button
                      size="sm"
                      onClick={() =>
                        saveEdit(first.examYear, first.examMonth, first.subject)
                      }
                      disabled={mutation.isPending}
                    >
                      <Save className="mr-1 h-3 w-3" />
                      저장
                    </Button>
                  </div>
                )}
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-brand-charcoal text-left text-xs text-muted-foreground">
                      <th className="pb-2 pr-4">등급</th>
                      <th className="pb-2 pr-4">최저 점수</th>
                      <th className="pb-2 pr-4">최고 점수</th>
                      <th className="pb-2">백분위</th>
                    </tr>
                  </thead>
                  <tbody>
                    {isCurrentlyEditing
                      ? editRows.map((row, i) => (
                          <tr
                            key={row.grade}
                            className="border-b border-brand-charcoal/50"
                          >
                            <td className="py-2 pr-4">
                              <Badge
                                className={
                                  GRADE_COLORS[row.grade] ?? ""
                                }
                              >
                                {row.grade}등급
                              </Badge>
                            </td>
                            <td className="py-2 pr-4">
                              <Input
                                type="number"
                                value={row.minScore}
                                onChange={(e) =>
                                  updateEditRow(i, "minScore", e.target.value)
                                }
                                className="h-7 w-20"
                              />
                            </td>
                            <td className="py-2 pr-4">
                              <Input
                                type="number"
                                value={row.maxScore}
                                onChange={(e) =>
                                  updateEditRow(i, "maxScore", e.target.value)
                                }
                                className="h-7 w-20"
                              />
                            </td>
                            <td className="py-2">
                              <Input
                                type="number"
                                value={row.percentile}
                                onChange={(e) =>
                                  updateEditRow(i, "percentile", e.target.value)
                                }
                                className="h-7 w-20"
                                placeholder="-"
                              />
                            </td>
                          </tr>
                        ))
                      : sorted.map((row) => (
                          <tr
                            key={row.grade}
                            className="border-b border-brand-charcoal/50"
                          >
                            <td className="py-2 pr-4">
                              <Badge
                                className={
                                  GRADE_COLORS[row.grade] ?? ""
                                }
                              >
                                {row.grade}등급
                              </Badge>
                            </td>
                            <td className="py-2 pr-4 font-medium">
                              {row.minScore}
                            </td>
                            <td className="py-2 pr-4 font-medium">
                              {row.maxScore}
                            </td>
                            <td className="py-2 text-muted-foreground">
                              {row.percentile != null
                                ? `${row.percentile}%`
                                : "-"}
                            </td>
                          </tr>
                        ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function GradePredictionPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const isTeacher = isTeacherPortalRole(user?.role ?? "student");

  const {
    data: cutoffs,
    isLoading: cutoffsLoading,
    isError: cutoffsError,
  } = useQuery({
    queryKey: ["grade-cutoffs"],
    queryFn: () => api.get<GradeCutoff[]>("/grade-prediction/cutoffs"),
  });

  const {
    data: predictions,
    isLoading: predictionsLoading,
    isError: predictionsError,
  } = useQuery({
    queryKey: ["grade-predictions-me"],
    queryFn: () => api.get<PredictionResponse>("/grade-prediction/me"),
    enabled: !isTeacher,
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">등급 예측</h1>
        <p className="text-muted-foreground">
          {isTeacher
            ? "등급 컷 관리 및 학생 등급 예측 현황을 확인합니다."
            : "나의 학습 데이터 기반 등급 예측 결과를 확인합니다."}
        </p>
      </div>

      {/* Student: Prediction Cards */}
      {!isTeacher && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Award className="h-5 w-5 text-muted-foreground" />
            <h2 className="text-lg font-semibold">나의 예측 등급</h2>
          </div>

          {predictionsLoading && (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-48 rounded-xl" />
              ))}
            </div>
          )}

          {predictionsError && (
            <Card>
              <CardContent className="flex items-center gap-3 py-8">
                <AlertCircle className="h-5 w-5 text-destructive" />
                <span className="text-sm text-muted-foreground">
                  예측 데이터를 불러오지 못했습니다.
                </span>
              </CardContent>
            </Card>
          )}

          {!predictionsLoading &&
            !predictionsError &&
            predictions?.predictions &&
            predictions.predictions.length > 0 && (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {predictions.predictions.map((p) => (
                  <PredictionCard key={p.subject} prediction={p} />
                ))}
              </div>
            )}

          {!predictionsLoading &&
            !predictionsError &&
            predictions?.predictions?.length === 0 && (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-16">
                  <TrendingUp className="h-12 w-12 text-muted-foreground" />
                  <p className="mt-4 text-lg font-medium">
                    예측 데이터가 부족합니다
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    문제를 더 풀면 정확한 등급 예측이 가능합니다.
                  </p>
                </CardContent>
              </Card>
            )}
        </section>
      )}

      {/* Cutoff Table */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-lg font-semibold">등급 컷 테이블</h2>
        </div>

        {cutoffsLoading && (
          <div className="space-y-3">
            {Array.from({ length: 2 }).map((_, i) => (
              <Skeleton key={i} className="h-64 rounded-xl" />
            ))}
          </div>
        )}

        {cutoffsError && (
          <Card>
            <CardContent className="flex items-center gap-3 py-8">
              <AlertCircle className="h-5 w-5 text-destructive" />
              <span className="text-sm text-muted-foreground">
                등급 컷 데이터를 불러오지 못했습니다.
              </span>
            </CardContent>
          </Card>
        )}

        {!cutoffsLoading && !cutoffsError && cutoffs && (
          <CutoffTable cutoffs={cutoffs} isAdmin={isAdmin} />
        )}
      </section>
    </div>
  );
}
