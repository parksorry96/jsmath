"use client";

import { useState } from "react";
import {
  ChevronRight,
  ChevronDown,
  AlertCircle,
  TrendingUp,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { api } from "@/lib/api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type MasteryState = "not_started" | "learning" | "practicing" | "mastered";

interface MasteryInfo {
  state: MasteryState;
  consecutiveCorrect: number;
  totalAttempts: number;
  totalCorrect: number;
}

interface CurriculumTreeNode {
  id: string;
  label: string;
  code: string;
  type: "subject" | "unit_major" | "unit_minor" | "topic";
  children: CurriculumTreeNode[];
  mastery: MasteryInfo | null;
}

interface DashboardSummary {
  totalNodes: number;
  masteredCount: number;
  learningCount: number;
  practicingCount: number;
  notStartedCount: number;
  progressPct: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATE_LABELS: Record<MasteryState, string> = {
  mastered: "마스터",
  practicing: "연습중",
  learning: "학습중",
  not_started: "미시작",
};

const STATE_COLORS: Record<MasteryState, { dot: string; bg: string; text: string }> = {
  mastered: {
    dot: "text-green-400",
    bg: "bg-green-900/30",
    text: "text-green-400",
  },
  practicing: {
    dot: "text-blue-400",
    bg: "bg-blue-900/30",
    text: "text-blue-400",
  },
  learning: {
    dot: "text-yellow-400",
    bg: "bg-yellow-900/30",
    text: "text-yellow-400",
  },
  not_started: {
    dot: "text-muted-foreground",
    bg: "bg-muted",
    text: "text-muted-foreground",
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function countMastered(node: CurriculumTreeNode): { mastered: number; total: number } {
  if (node.children.length === 0) {
    return {
      mastered: node.mastery?.state === "mastered" ? 1 : 0,
      total: 1,
    };
  }
  let mastered = 0;
  let total = 0;
  for (const child of node.children) {
    const c = countMastered(child);
    mastered += c.mastered;
    total += c.total;
  }
  return { mastered, total };
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ProgressBar({ value, className }: { value: number; className?: string }) {
  return (
    <div className={`h-2 w-full overflow-hidden rounded-full bg-brand-charcoal ${className ?? ""}`}>
      <div
        className="h-full rounded-full bg-green-500 transition-all duration-300"
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  );
}

function MasteryDot({ state }: { state: MasteryState }) {
  const colors = STATE_COLORS[state];
  if (state === "not_started") {
    return <span className={`text-sm ${colors.dot}`}>&#9675;</span>;
  }
  return <span className={`text-sm ${colors.dot}`}>&#9679;</span>;
}

function MasteryBadge({ state }: { state: MasteryState }) {
  const colors = STATE_COLORS[state];
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${colors.bg} ${colors.text}`}>
      {STATE_LABELS[state]}
    </span>
  );
}

function TreeNode({ node, depth = 0 }: { node: CurriculumTreeNode; depth?: number }) {
  const [expanded, setExpanded] = useState(depth < 1);
  const hasChildren = node.children.length > 0;
  const state: MasteryState = node.mastery?.state ?? "not_started";
  const stats = hasChildren ? countMastered(node) : null;
  const pct = stats && stats.total > 0 ? Math.round((stats.mastered / stats.total) * 100) : 0;

  return (
    <div>
      <button
        type="button"
        onClick={() => hasChildren && setExpanded(!expanded)}
        className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-brand-charcoal ${
          hasChildren ? "cursor-pointer" : "cursor-default"
        }`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        {/* Expand icon */}
        <span className="flex h-4 w-4 shrink-0 items-center justify-center">
          {hasChildren ? (
            expanded ? (
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            )
          ) : (
            <MasteryDot state={state} />
          )}
        </span>

        {/* Label */}
        <span className="flex-1 truncate font-medium">
          {node.label}
        </span>

        {/* Stats / mastery info */}
        <span className="flex shrink-0 items-center gap-2">
          {node.mastery && (
            <span className="text-xs text-muted-foreground">
              {node.mastery.consecutiveCorrect}연속 / {node.mastery.totalAttempts}회
            </span>
          )}

          {hasChildren && stats ? (
            <>
              <span className="text-xs text-muted-foreground">
                {stats.mastered}/{stats.total}
              </span>
              <div className="hidden w-16 sm:block">
                <ProgressBar value={pct} />
              </div>
            </>
          ) : (
            <MasteryBadge state={state} />
          )}
        </span>
      </button>

      {/* Children */}
      {hasChildren && expanded && (
        <div>
          {node.children.map((child) => (
            <TreeNode key={child.id} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Summary Cards
// ---------------------------------------------------------------------------

function SummaryCards({ data }: { data: DashboardSummary }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {/* Overall progress */}
      <Card className="col-span-2 sm:col-span-3 lg:col-span-1">
        <CardContent className="flex flex-col gap-2 p-4">
          <span className="text-xs font-medium text-muted-foreground">
            전체 진도율
          </span>
          <span className="text-2xl font-bold tracking-tight">
            {data.progressPct}%
          </span>
          <ProgressBar value={data.progressPct} />
        </CardContent>
      </Card>

      {/* Mastered */}
      <Card>
        <CardContent className="flex flex-col gap-1 p-4">
          <span className="text-xs font-medium text-muted-foreground">
            마스터 완료
          </span>
          <span className="text-2xl font-bold tracking-tight text-green-400">
            {data.masteredCount}
          </span>
        </CardContent>
      </Card>

      {/* Practicing */}
      <Card>
        <CardContent className="flex flex-col gap-1 p-4">
          <span className="text-xs font-medium text-muted-foreground">
            연습 중
          </span>
          <span className="text-2xl font-bold tracking-tight text-blue-400">
            {data.practicingCount}
          </span>
        </CardContent>
      </Card>

      {/* Learning */}
      <Card>
        <CardContent className="flex flex-col gap-1 p-4">
          <span className="text-xs font-medium text-muted-foreground">
            학습 중
          </span>
          <span className="text-2xl font-bold tracking-tight text-yellow-400">
            {data.learningCount}
          </span>
        </CardContent>
      </Card>

      {/* Not started */}
      <Card>
        <CardContent className="flex flex-col gap-1 p-4">
          <span className="text-xs font-medium text-muted-foreground">
            미시작
          </span>
          <span className="text-2xl font-bold tracking-tight text-muted-foreground">
            {data.notStartedCount}
          </span>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function MasteryPage() {
  const [curriculumYear, setCurriculumYear] = useState<string>("2015");

  const {
    data: dashboard,
    isLoading: dashLoading,
    isError: dashError,
  } = useQuery({
    queryKey: ["mastery-dashboard"],
    queryFn: () => api.get<DashboardSummary>("/mastery/dashboard"),
  });

  const {
    data: tree,
    isLoading: treeLoading,
    isError: treeError,
    error: treeErrorObj,
  } = useQuery({
    queryKey: ["mastery-tree", curriculumYear],
    queryFn: () =>
      api.get<CurriculumTreeNode[]>(`/mastery/tree?year=${curriculumYear}`),
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">학습 현황</h1>
        <p className="text-muted-foreground">
          교육과정 단원별 마스터 진행 상황을 확인합니다.
        </p>
      </div>

      {/* Dashboard summary */}
      {dashLoading && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
      )}
      {!dashLoading && !dashError && dashboard && (
        <SummaryCards data={dashboard} />
      )}

      {/* Year toggle */}
      <Tabs value={curriculumYear} onValueChange={setCurriculumYear}>
        <TabsList>
          <TabsTrigger value="2015">2015 교육과정</TabsTrigger>
          <TabsTrigger value="2022">2022 교육과정</TabsTrigger>
        </TabsList>

        <TabsContent value={curriculumYear}>
          {/* Loading */}
          {treeLoading && (
            <div className="space-y-2 pt-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-10 rounded-lg" />
              ))}
            </div>
          )}

          {/* Error */}
          {treeError && (
            <Card className="mt-2">
              <CardContent className="flex flex-col items-center justify-center py-16">
                <AlertCircle className="h-12 w-12 text-destructive" />
                <p className="mt-4 text-lg font-medium">
                  커리큘럼 트리를 불러오지 못했습니다
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {treeErrorObj instanceof Error
                    ? treeErrorObj.message
                    : "Unknown error"}
                </p>
              </CardContent>
            </Card>
          )}

          {/* Empty */}
          {!treeLoading && !treeError && tree && tree.length === 0 && (
            <Card className="mt-2">
              <CardContent className="flex flex-col items-center justify-center py-20">
                <TrendingUp className="h-16 w-16 text-muted-foreground" />
                <p className="mt-4 text-lg font-medium text-foreground">
                  학습 데이터가 없습니다
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  문제를 풀기 시작하면 마스터 현황이 표시됩니다.
                </p>
              </CardContent>
            </Card>
          )}

          {/* Tree */}
          {!treeLoading && !treeError && tree && tree.length > 0 && (
            <div className="space-y-2 pt-2">
              {tree.map((subject) => {
                const stats = countMastered(subject);
                const pct =
                  stats.total > 0
                    ? Math.round((stats.mastered / stats.total) * 100)
                    : 0;

                return (
                  <Card key={subject.id}>
                    <CardContent className="p-3">
                      {/* Subject header row */}
                      <div className="mb-2 flex items-center gap-3 px-2">
                        <span className="text-sm font-semibold">
                          {subject.label}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {stats.mastered}/{stats.total} 마스터
                        </span>
                        <div className="ml-auto w-24">
                          <ProgressBar value={pct} />
                        </div>
                        <span className="text-xs font-medium text-muted-foreground">
                          {pct}%
                        </span>
                      </div>

                      {/* Children */}
                      {subject.children.map((child) => (
                        <TreeNode key={child.id} node={child} depth={0} />
                      ))}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
