"use client";

import { useState } from "react";
import { AlertCircle, GitBranch, Lightbulb } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  KnowledgeGraphViz,
  type KnowledgeGraphData,
} from "@/components/analytics/knowledge-graph-viz";
import { api } from "@/lib/api";
import { isTeacherPortalRole, useAuth } from "@/lib/auth";

// --- Types ---

interface StudentOption {
  id: string;
  name: string;
}

// --- Page ---

export default function KnowledgeGraphPage() {
  const { user } = useAuth();
  const isTeacher = isTeacherPortalRole(user?.role ?? "student");
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(
    null,
  );

  // For teachers: fetch student list from enrollments
  const { data: students } = useQuery({
    queryKey: ["teacher-students"],
    queryFn: async () => {
      // Fetch all classes, then collect unique students
      const classes = await api.get<
        { id: string; enrollments: { userId: string; user: { id: string; name: string }; role: string }[] }[]
      >("/classes?includeEnrollments=true");

      const studentMap = new Map<string, string>();
      for (const cls of classes) {
        for (const enrollment of cls.enrollments ?? []) {
          if (enrollment.role === "student") {
            studentMap.set(enrollment.user.id, enrollment.user.name);
          }
        }
      }

      return [...studentMap.entries()].map(([id, name]) => ({ id, name }));
    },
    enabled: isTeacher,
  });

  const targetStudentId = isTeacher
    ? selectedStudentId
    : user?.id ?? null;

  const {
    data: graphData,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ["knowledge-graph", targetStudentId],
    queryFn: () =>
      api.get<KnowledgeGraphData>(
        `/analytics/student/${targetStudentId}/knowledge-graph`,
      ),
    enabled: !!targetStudentId,
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">지식 그래프</h1>
        <p className="text-muted-foreground">
          교육과정 선수 관계와 약점 원인을 시각적으로 분석합니다.
        </p>
      </div>

      {/* Student selector for teachers */}
      {isTeacher && (
        <Card>
          <CardContent className="p-4">
            <label className="mb-2 block text-sm font-medium">
              학생 선택
            </label>
            <select
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              value={selectedStudentId ?? ""}
              onChange={(e) =>
                setSelectedStudentId(e.target.value || null)
              }
            >
              <option value="">학생을 선택하세요</option>
              {students?.map((s: StudentOption) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </CardContent>
        </Card>
      )}

      {/* No student selected state */}
      {!targetStudentId && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-20">
            <GitBranch className="h-16 w-16 text-muted-foreground" />
            <p className="mt-4 text-lg font-medium">
              {isTeacher
                ? "학생을 선택하면 지식 그래프가 표시됩니다"
                : "로딩 중..."}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Loading */}
      {targetStudentId && isLoading && (
        <div className="space-y-4">
          <Skeleton className="h-[400px] rounded-xl" />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Skeleton className="h-32 rounded-xl" />
            <Skeleton className="h-32 rounded-xl" />
          </div>
        </div>
      )}

      {/* Error */}
      {isError && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <AlertCircle className="h-12 w-12 text-destructive" />
            <p className="mt-4 text-lg font-medium">
              지식 그래프를 불러오지 못했습니다
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {error instanceof Error ? error.message : "Unknown error"}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Graph + Recommendations */}
      {graphData && !isLoading && !isError && (
        <>
          <KnowledgeGraphViz data={graphData} />

          {/* Weakness summary panel */}
          {graphData.recommendations.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Lightbulb className="h-4 w-4 text-yellow-500" />
                  약점 분석 및 추천
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {graphData.recommendations.map((rec) => (
                  <div
                    key={rec.nodeId}
                    className="flex items-start gap-3 rounded-lg border border-border p-3"
                  >
                    <span className="mt-0.5 inline-block h-2.5 w-2.5 shrink-0 rounded-full bg-red-500" />
                    <div>
                      <div className="text-sm font-medium">
                        {rec.subject} &gt; {rec.unit}
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {rec.reason}
                      </div>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {graphData.recommendations.length === 0 &&
            graphData.nodes.length > 0 && (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <p className="text-sm text-muted-foreground">
                    현재 뚜렷한 약점이 발견되지 않았습니다. 학습을 계속
                    진행하세요.
                  </p>
                </CardContent>
              </Card>
            )}
        </>
      )}
    </div>
  );
}
