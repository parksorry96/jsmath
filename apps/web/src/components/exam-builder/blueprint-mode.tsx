"use client";

import { useState, useCallback } from "react";
import {
  Loader2,
  Plus,
  X,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  Save,
  FolderOpen,
  Sparkles,
  Eye,
  ArrowRight,
} from "lucide-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import { buildProblemPreview } from "@/lib/problem-preview";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UnitRow {
  subject?: string;
  unitMajor?: string;
  label: string;
  percentage: number;
}

interface DifficultyRow {
  min: number;
  max: number;
  label: string;
  percentage: number;
}

interface TypeRow {
  problemType: string;
  count: number;
}

interface BlueprintConfig {
  title: string;
  description: string;
  gradeLevel: string;
  totalQuestions: number;
  unitDistribution: UnitRow[];
  difficultyDistribution: DifficultyRow[];
  typeDistribution: TypeRow[];
  excludeRecentDays: number;
  excludeRecent: boolean;
}

interface BlueprintListItem {
  id: string;
  title: string;
  description: string | null;
  gradeLevel: string | null;
  totalQuestions: number;
  createdAt: string;
}

interface PreviewResult {
  feasibility: "full" | "partial" | "insufficient";
  totalRequired: number;
  totalAvailable: number;
  slotDetails: Array<{ slot: number; required: number; available: number }>;
}

interface Relaxation {
  slot: number;
  type: string;
  from: string;
  to: string;
}

interface CompositionResult {
  generationId: string;
  problemIds: string[];
  matchScore: number;
  relaxations: Relaxation[];
}

interface SelectedProblem {
  id: string;
  displayNumber: string | null;
  problemNumber: string | null;
  stemText: string;
  stemLatex: string;
  problemType: string;
  difficulty: number | null;
  subject: string | null;
  unitMajor: string | null;
}

interface FilterOptions {
  subjects: string[];
  gradeLevels: string[];
  problemTypes: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROBLEM_TYPE_LABELS: Record<string, string> = {
  multiple_choice: "객관식",
  short_answer: "주관식",
  essay: "서술형",
  true_false: "O/X",
};

const DEFAULT_DIFFICULTY_ROWS: DifficultyRow[] = [
  { min: 1, max: 2, label: "하", percentage: 30 },
  { min: 3, max: 4, label: "중", percentage: 50 },
  { min: 5, max: 5, label: "상", percentage: 20 },
];

const DEFAULT_TYPE_ROWS: TypeRow[] = [
  { problemType: "multiple_choice", count: 15 },
  { problemType: "short_answer", count: 5 },
];

function emptyConfig(): BlueprintConfig {
  return {
    title: "",
    description: "",
    gradeLevel: "",
    totalQuestions: 20,
    unitDistribution: [],
    difficultyDistribution: [...DEFAULT_DIFFICULTY_ROWS],
    typeDistribution: [...DEFAULT_TYPE_ROWS],
    excludeRecentDays: 30,
    excludeRecent: false,
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface BlueprintModeProps {
  filterOptions: FilterOptions | undefined;
  onAccept: (problems: SelectedProblem[]) => void;
}

export function BlueprintMode({ filterOptions, onAccept }: BlueprintModeProps) {
  const [config, setConfig] = useState<BlueprintConfig>(emptyConfig);
  const [savedBlueprintId, setSavedBlueprintId] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [composition, setComposition] = useState<CompositionResult | null>(
    null,
  );
  const [composedProblems, setComposedProblems] = useState<SelectedProblem[]>(
    [],
  );
  const [loadOpen, setLoadOpen] = useState(false);

  // ── Queries ─────────────────────────────────────────────────────────
  const { data: blueprintList } = useQuery({
    queryKey: ["exam-blueprints"],
    queryFn: () => api.get<BlueprintListItem[]>("/exam-blueprints"),
    enabled: loadOpen,
  });

  // ── Mutations ───────────────────────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        title: config.title,
        description: config.description || undefined,
        gradeLevel: config.gradeLevel || undefined,
        totalQuestions: config.totalQuestions,
        unitDistribution: config.unitDistribution,
        difficultyDistribution: config.difficultyDistribution,
        typeDistribution: config.typeDistribution,
        excludeRecentDays: config.excludeRecent
          ? config.excludeRecentDays
          : undefined,
      };
      if (savedBlueprintId) {
        await api.put(`/exam-blueprints/${savedBlueprintId}`, payload);
        return savedBlueprintId;
      }
      const result = await api.post<{ id: string }>(
        "/exam-blueprints",
        payload,
      );
      return result.id;
    },
    onSuccess: (id) => {
      setSavedBlueprintId(id);
    },
  });

  const previewMutation = useMutation({
    mutationFn: async () => {
      if (!savedBlueprintId) {
        const id = await saveMutation.mutateAsync();
        setSavedBlueprintId(id);
        return api.post<PreviewResult>(`/exam-blueprints/${id}/preview`, {});
      }
      return api.post<PreviewResult>(
        `/exam-blueprints/${savedBlueprintId}/preview`,
        {},
      );
    },
    onSuccess: (data) => {
      setPreview(data);
      setComposition(null);
      setComposedProblems([]);
    },
  });

  const composeMutation = useMutation({
    mutationFn: async () => {
      if (!savedBlueprintId) {
        const id = await saveMutation.mutateAsync();
        setSavedBlueprintId(id);
        return api.post<CompositionResult>(
          `/exam-blueprints/${id}/compose`,
          {},
        );
      }
      return api.post<CompositionResult>(
        `/exam-blueprints/${savedBlueprintId}/compose`,
        {},
      );
    },
    onSuccess: async (data) => {
      setComposition(data);
      // Fetch the actual problem objects for the selected IDs
      if (data.problemIds.length > 0) {
        const problems = await api.post<SelectedProblem[]>(
          "/problems/by-ids",
          { ids: data.problemIds },
        );
        setComposedProblems(problems);
      }
    },
  });

  // ── Load blueprint ──────────────────────────────────────────────────
  const handleLoad = useCallback(
    async (bp: BlueprintListItem) => {
      const full = await api.get<{
        id: string;
        title: string;
        description: string | null;
        gradeLevel: string | null;
        totalQuestions: number;
        unitDistribution: UnitRow[];
        difficultyDistribution: DifficultyRow[];
        typeDistribution: TypeRow[];
        excludeRecentDays: number | null;
      }>(`/exam-blueprints/${bp.id}`);

      setConfig({
        title: full.title,
        description: full.description ?? "",
        gradeLevel: full.gradeLevel ?? "",
        totalQuestions: full.totalQuestions,
        unitDistribution: full.unitDistribution ?? [],
        difficultyDistribution:
          full.difficultyDistribution?.length > 0
            ? full.difficultyDistribution
            : [...DEFAULT_DIFFICULTY_ROWS],
        typeDistribution:
          full.typeDistribution?.length > 0
            ? full.typeDistribution
            : [...DEFAULT_TYPE_ROWS],
        excludeRecentDays: full.excludeRecentDays ?? 30,
        excludeRecent: (full.excludeRecentDays ?? 0) > 0,
      });
      setSavedBlueprintId(bp.id);
      setPreview(null);
      setComposition(null);
      setComposedProblems([]);
      setLoadOpen(false);
    },
    [],
  );

  // ── Helpers ─────────────────────────────────────────────────────────
  const unitPercentSum = config.unitDistribution.reduce(
    (s, r) => s + r.percentage,
    0,
  );
  const diffPercentSum = config.difficultyDistribution.reduce(
    (s, r) => s + r.percentage,
    0,
  );
  const typeCountSum = config.typeDistribution.reduce(
    (s, r) => s + r.count,
    0,
  );
  const isConfigValid =
    config.title.trim().length > 0 && config.totalQuestions > 0;

  const isBusy =
    saveMutation.isPending ||
    previewMutation.isPending ||
    composeMutation.isPending;

  // ── Render ──────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Top bar: Save / Load */}
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-lg font-semibold">블루프린트 모드</h3>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setLoadOpen(!loadOpen)}
            >
              <FolderOpen className="mr-1 h-4 w-4" />
              불러오기
            </Button>
            {loadOpen && (
              <div className="absolute right-0 top-full z-20 mt-1 w-64 rounded-lg border border-border bg-brand-dark p-2 shadow-xl">
                {!blueprintList || blueprintList.length === 0 ? (
                  <p className="px-2 py-3 text-center text-xs text-muted-foreground">
                    저장된 블루프린트 없음
                  </p>
                ) : (
                  <div className="max-h-48 space-y-1 overflow-y-auto">
                    {blueprintList.map((bp) => (
                      <button
                        key={bp.id}
                        className="w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-brand-charcoal"
                        onClick={() => handleLoad(bp)}
                      >
                        <p className="font-medium truncate">{bp.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {bp.totalQuestions}문제 &middot;{" "}
                          {new Date(bp.createdAt).toLocaleDateString("ko-KR")}
                        </p>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => saveMutation.mutate()}
            disabled={!isConfigValid || isBusy}
          >
            {saveMutation.isPending ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-1 h-4 w-4" />
            )}
            {savedBlueprintId ? "업데이트" : "저장"}
          </Button>
        </div>
      </div>

      {/* ── Configuration Card ──────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>블루프린트 설정</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Basic info */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium">
                블루프린트 이름 <span className="text-red-400">*</span>
              </label>
              <Input
                placeholder="예: 중간고사 수학1 블루프린트"
                className="bg-brand-charcoal border-transparent"
                value={config.title}
                onChange={(e) =>
                  setConfig((c) => ({ ...c, title: e.target.value }))
                }
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">설명</label>
              <Input
                placeholder="선택 사항"
                className="bg-brand-charcoal border-transparent"
                value={config.description}
                onChange={(e) =>
                  setConfig((c) => ({ ...c, description: e.target.value }))
                }
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">학년</label>
              <select
                className="w-full rounded-md bg-brand-charcoal border border-transparent px-3 py-2 text-sm text-foreground"
                value={config.gradeLevel}
                onChange={(e) =>
                  setConfig((c) => ({ ...c, gradeLevel: e.target.value }))
                }
              >
                <option value="">선택 안함</option>
                {filterOptions?.gradeLevels?.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">
                총 문제 수 <span className="text-red-400">*</span>
              </label>
              <Input
                type="number"
                min={1}
                className="bg-brand-charcoal border-transparent"
                value={config.totalQuestions}
                onChange={(e) =>
                  setConfig((c) => ({
                    ...c,
                    totalQuestions: parseInt(e.target.value) || 0,
                  }))
                }
              />
            </div>
          </div>

          {/* ── Unit Distribution ──────────────────────────────────── */}
          <DistributionSection title="단원 배분">
            <p className="text-xs text-muted-foreground mb-2">
              비율 합계: {unitPercentSum}%
              {unitPercentSum !== 100 && unitPercentSum > 0 && (
                <span className="text-yellow-400 ml-1">
                  (100%가 되어야 합니다)
                </span>
              )}
            </p>
            {config.unitDistribution.map((row, i) => (
              <div key={i} className="flex items-center gap-2 mb-2">
                <select
                  className="flex-1 rounded-md bg-brand-dark border border-transparent px-2 py-1.5 text-xs text-foreground"
                  value={row.unitMajor ?? row.subject ?? ""}
                  onChange={(e) => {
                    const val = e.target.value;
                    setConfig((c) => {
                      const next = [...c.unitDistribution];
                      next[i] = {
                        ...next[i],
                        unitMajor: val,
                        label: val,
                      };
                      return { ...c, unitDistribution: next };
                    });
                  }}
                >
                  <option value="">단원 선택</option>
                  {filterOptions?.subjects?.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  className="w-20 bg-brand-dark border-transparent text-xs"
                  value={row.percentage}
                  onChange={(e) => {
                    setConfig((c) => {
                      const next = [...c.unitDistribution];
                      next[i] = {
                        ...next[i],
                        percentage: parseInt(e.target.value) || 0,
                      };
                      return { ...c, unitDistribution: next };
                    });
                  }}
                />
                <span className="text-xs text-muted-foreground">%</span>
                <button
                  type="button"
                  className="rounded p-1 text-muted-foreground hover:text-red-400"
                  onClick={() =>
                    setConfig((c) => ({
                      ...c,
                      unitDistribution: c.unitDistribution.filter(
                        (_, j) => j !== i,
                      ),
                    }))
                  }
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            <Button
              variant="ghost"
              size="sm"
              className="text-xs"
              onClick={() =>
                setConfig((c) => ({
                  ...c,
                  unitDistribution: [
                    ...c.unitDistribution,
                    { label: "", percentage: 0 },
                  ],
                }))
              }
            >
              <Plus className="mr-1 h-3 w-3" />
              단원 추가
            </Button>
          </DistributionSection>

          {/* ── Difficulty Distribution ────────────────────────────── */}
          <DistributionSection title="난이도 배분">
            <p className="text-xs text-muted-foreground mb-2">
              비율 합계: {diffPercentSum}%
              {diffPercentSum !== 100 && diffPercentSum > 0 && (
                <span className="text-yellow-400 ml-1">
                  (100%가 되어야 합니다)
                </span>
              )}
            </p>
            {config.difficultyDistribution.map((row, i) => (
              <div key={i} className="flex items-center gap-2 mb-2">
                <div className="flex items-center gap-1">
                  <Input
                    type="number"
                    min={1}
                    max={5}
                    className="w-14 bg-brand-dark border-transparent text-xs"
                    value={row.min}
                    onChange={(e) => {
                      setConfig((c) => {
                        const next = [...c.difficultyDistribution];
                        next[i] = {
                          ...next[i],
                          min: parseInt(e.target.value) || 1,
                        };
                        return { ...c, difficultyDistribution: next };
                      });
                    }}
                  />
                  <span className="text-xs text-muted-foreground">~</span>
                  <Input
                    type="number"
                    min={1}
                    max={5}
                    className="w-14 bg-brand-dark border-transparent text-xs"
                    value={row.max}
                    onChange={(e) => {
                      setConfig((c) => {
                        const next = [...c.difficultyDistribution];
                        next[i] = {
                          ...next[i],
                          max: parseInt(e.target.value) || 1,
                        };
                        return { ...c, difficultyDistribution: next };
                      });
                    }}
                  />
                </div>
                <Input
                  className="w-20 bg-brand-dark border-transparent text-xs"
                  value={row.label}
                  onChange={(e) => {
                    setConfig((c) => {
                      const next = [...c.difficultyDistribution];
                      next[i] = { ...next[i], label: e.target.value };
                      return { ...c, difficultyDistribution: next };
                    });
                  }}
                  placeholder="라벨"
                />
                <Input
                  type="number"
                  min={0}
                  max={100}
                  className="w-20 bg-brand-dark border-transparent text-xs"
                  value={row.percentage}
                  onChange={(e) => {
                    setConfig((c) => {
                      const next = [...c.difficultyDistribution];
                      next[i] = {
                        ...next[i],
                        percentage: parseInt(e.target.value) || 0,
                      };
                      return { ...c, difficultyDistribution: next };
                    });
                  }}
                />
                <span className="text-xs text-muted-foreground">%</span>
                <button
                  type="button"
                  className="rounded p-1 text-muted-foreground hover:text-red-400"
                  onClick={() =>
                    setConfig((c) => ({
                      ...c,
                      difficultyDistribution: c.difficultyDistribution.filter(
                        (_, j) => j !== i,
                      ),
                    }))
                  }
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            <Button
              variant="ghost"
              size="sm"
              className="text-xs"
              onClick={() =>
                setConfig((c) => ({
                  ...c,
                  difficultyDistribution: [
                    ...c.difficultyDistribution,
                    { min: 1, max: 5, label: "", percentage: 0 },
                  ],
                }))
              }
            >
              <Plus className="mr-1 h-3 w-3" />
              난이도 추가
            </Button>
          </DistributionSection>

          {/* ── Type Distribution ──────────────────────────────────── */}
          <DistributionSection title="문제 유형 배분">
            <p className="text-xs text-muted-foreground mb-2">
              유형별 합계: {typeCountSum}문제
              {typeCountSum !== config.totalQuestions &&
                config.totalQuestions > 0 && (
                  <span className="text-yellow-400 ml-1">
                    (총 {config.totalQuestions}문제와 일치해야 합니다)
                  </span>
                )}
            </p>
            {config.typeDistribution.map((row, i) => (
              <div key={i} className="flex items-center gap-2 mb-2">
                <select
                  className="flex-1 rounded-md bg-brand-dark border border-transparent px-2 py-1.5 text-xs text-foreground"
                  value={row.problemType}
                  onChange={(e) => {
                    setConfig((c) => {
                      const next = [...c.typeDistribution];
                      next[i] = { ...next[i], problemType: e.target.value };
                      return { ...c, typeDistribution: next };
                    });
                  }}
                >
                  <option value="">유형 선택</option>
                  {(
                    filterOptions?.problemTypes ?? [
                      "multiple_choice",
                      "short_answer",
                      "essay",
                      "true_false",
                    ]
                  ).map((t) => (
                    <option key={t} value={t}>
                      {PROBLEM_TYPE_LABELS[t] ?? t}
                    </option>
                  ))}
                </select>
                <Input
                  type="number"
                  min={0}
                  className="w-20 bg-brand-dark border-transparent text-xs"
                  value={row.count}
                  onChange={(e) => {
                    setConfig((c) => {
                      const next = [...c.typeDistribution];
                      next[i] = {
                        ...next[i],
                        count: parseInt(e.target.value) || 0,
                      };
                      return { ...c, typeDistribution: next };
                    });
                  }}
                />
                <span className="text-xs text-muted-foreground">문제</span>
                <button
                  type="button"
                  className="rounded p-1 text-muted-foreground hover:text-red-400"
                  onClick={() =>
                    setConfig((c) => ({
                      ...c,
                      typeDistribution: c.typeDistribution.filter(
                        (_, j) => j !== i,
                      ),
                    }))
                  }
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            <Button
              variant="ghost"
              size="sm"
              className="text-xs"
              onClick={() =>
                setConfig((c) => ({
                  ...c,
                  typeDistribution: [
                    ...c.typeDistribution,
                    { problemType: "", count: 0 },
                  ],
                }))
              }
            >
              <Plus className="mr-1 h-3 w-3" />
              유형 추가
            </Button>
          </DistributionSection>

          {/* ── Exclude recently used ──────────────────────────────── */}
          <div className="rounded-lg border border-border p-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={config.excludeRecent}
                onChange={(e) =>
                  setConfig((c) => ({
                    ...c,
                    excludeRecent: e.target.checked,
                  }))
                }
                className="rounded border-border"
              />
              최근 출제 문제 제외
            </label>
            {config.excludeRecent && (
              <div className="mt-2 flex items-center gap-2">
                <Input
                  type="number"
                  min={1}
                  className="w-20 bg-brand-dark border-transparent text-sm"
                  value={config.excludeRecentDays}
                  onChange={(e) =>
                    setConfig((c) => ({
                      ...c,
                      excludeRecentDays: parseInt(e.target.value) || 30,
                    }))
                  }
                />
                <span className="text-sm text-muted-foreground">일 이내</span>
              </div>
            )}
          </div>

          {/* ── Action buttons ─────────────────────────────────────── */}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={() => previewMutation.mutate()}
              disabled={!isConfigValid || isBusy}
            >
              {previewMutation.isPending ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Eye className="mr-1 h-4 w-4" />
              )}
              가용성 확인
            </Button>
            <Button
              onClick={() => composeMutation.mutate()}
              disabled={!isConfigValid || isBusy}
            >
              {composeMutation.isPending ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="mr-1 h-4 w-4" />
              )}
              자동 선택
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ── Preview (Feasibility) Result ────────────────────────────── */}
      {preview && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FeasibilityIcon status={preview.feasibility} />
              가용성 결과
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-3">
              <FeasibilityBadge status={preview.feasibility} />
              <span className="text-sm text-muted-foreground">
                필요: {preview.totalRequired}문제 / 가용:{" "}
                {preview.totalAvailable}문제
              </span>
            </div>

            {/* Slot-level details */}
            <div className="rounded-lg border border-border bg-brand-dark p-3">
              <p className="mb-2 text-xs font-medium text-muted-foreground">
                슬롯별 현황
              </p>
              <div className="grid grid-cols-2 gap-1 sm:grid-cols-4 md:grid-cols-6">
                {preview.slotDetails.map((s) => (
                  <div
                    key={s.slot}
                    className={`rounded px-2 py-1 text-center text-xs ${
                      s.available > 0
                        ? "bg-green-900/20 text-green-400"
                        : "bg-red-900/20 text-red-400"
                    }`}
                  >
                    #{s.slot + 1}: {s.available}개
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Composition Result ──────────────────────────────────────── */}
      {composition && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4" />
              자동 선택 결과
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Match score */}
            <div className="flex items-center gap-3">
              <MatchScoreBadge score={composition.matchScore} />
              <span className="text-sm text-muted-foreground">
                {composedProblems.length}문제 선택됨
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => composeMutation.mutate()}
                disabled={isBusy}
              >
                <RefreshCw className="mr-1 h-3.5 w-3.5" />
                재시도
              </Button>
            </div>

            {/* Relaxations as warnings */}
            {composition.relaxations.length > 0 && (
              <div className="rounded-lg border border-yellow-400/30 bg-yellow-900/10 p-3">
                <p className="mb-1 flex items-center gap-1 text-xs font-medium text-yellow-400">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  조건 완화 적용됨
                </p>
                <ul className="space-y-0.5 text-xs text-yellow-300/80">
                  {composition.relaxations.map((r, i) => (
                    <li key={i}>
                      슬롯 #{r.slot + 1}: {r.from} → {r.to}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Problem list */}
            <div className="space-y-2">
              {composedProblems.map((problem, index) => {
                const preview = buildProblemPreview(problem, 80);
                return (
                  <div
                    key={problem.id}
                    className="flex items-center gap-3 rounded-lg border border-border bg-brand-dark p-3"
                  >
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-brand-charcoal text-xs font-bold text-brand-beige">
                      {index + 1}
                    </div>
                    <p className="min-w-0 flex-1 truncate text-sm">
                      {preview || "문제"}
                    </p>
                    <Badge variant="outline" className="text-[10px]">
                      {PROBLEM_TYPE_LABELS[problem.problemType] ??
                        problem.problemType}
                    </Badge>
                    {problem.difficulty !== null && (
                      <span
                        className={`rounded-full px-1.5 py-0 text-[10px] font-medium ${difficultyColor(problem.difficulty)}`}
                      >
                        {difficultyLabel(problem.difficulty)}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Accept button */}
            {composedProblems.length > 0 && (
              <Button
                size="lg"
                className="w-full"
                onClick={() => onAccept(composedProblems)}
              >
                선택 확정 & 다음 단계로
                <ArrowRight className="ml-1 h-4 w-4" />
              </Button>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function DistributionSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border p-4">
      <p className="mb-3 text-sm font-medium">{title}</p>
      {children}
    </div>
  );
}

function FeasibilityIcon({ status }: { status: string }) {
  if (status === "full") return <CheckCircle2 className="h-4 w-4 text-green-400" />;
  if (status === "partial")
    return <AlertTriangle className="h-4 w-4 text-yellow-400" />;
  return <X className="h-4 w-4 text-red-400" />;
}

function FeasibilityBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    full: {
      label: "충분",
      className: "bg-green-900/30 text-green-400 border-green-400/30",
    },
    partial: {
      label: "부분 가능",
      className: "bg-yellow-900/30 text-yellow-400 border-yellow-400/30",
    },
    insufficient: {
      label: "부족",
      className: "bg-red-900/30 text-red-400 border-red-400/30",
    },
  };
  const info = map[status] ?? map.insufficient;
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-xs font-medium ${info.className}`}
    >
      {info.label}
    </span>
  );
}

function MatchScoreBadge({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  let color = "bg-green-900/30 text-green-400 border-green-400/30";
  if (pct < 70) color = "bg-red-900/30 text-red-400 border-red-400/30";
  else if (pct < 90)
    color = "bg-yellow-900/30 text-yellow-400 border-yellow-400/30";

  return (
    <span className={`rounded-full border px-2.5 py-0.5 text-sm font-bold ${color}`}>
      {pct}% 매칭
    </span>
  );
}

function difficultyLabel(d: number | null): string | null {
  if (d === null) return null;
  if (d <= 2) return "하";
  if (d <= 4) return "중";
  return "상";
}

function difficultyColor(d: number | null): string {
  if (d === null) return "";
  if (d <= 2) return "bg-green-900/30 text-green-400";
  if (d <= 4) return "bg-yellow-900/30 text-yellow-400";
  return "bg-red-900/30 text-red-400";
}
