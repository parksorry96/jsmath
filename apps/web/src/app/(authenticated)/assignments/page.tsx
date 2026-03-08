"use client";

import { useState } from "react";
import {
  Plus,
  Inbox,
  Loader2,
  AlertCircle,
  GraduationCap,
  Calendar,
  Users,
  Search,
  ChevronLeft,
  ChevronRight,
  X,
  Check,
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LatexRenderer } from "@/components/math/latex-renderer";

// --- Types ---

interface ClassItem {
  id: string;
  name: string;
  grade: number | null;
  _count?: { enrollments: number };
}

interface Assignment {
  id: string;
  classId: string;
  title: string;
  description: string | null;
  type: string; // "problem_set" | "text_task"
  dueDate: string | null;
  maxScore: number;
  status: string;
  createdAt: string;
  _count?: {
    submissions: number;
  };
  class?: { name: string; _count?: { enrollments: number } };
  averageScore?: number | null;
}

interface Problem {
  id: string;
  displayNumber: string | null;
  problemNumber: string | null;
  stemText: string;
  stemLatex: string;
  problemType: string;
  reviewStatus: string;
  difficulty: number | null;
  unitMajor: string | null;
  subject: string | null;
}

interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// --- Helpers ---

const TYPE_LABELS: Record<string, { label: string; className: string }> = {
  problem_set: {
    label: "문제풀이",
    className: "bg-blue-900/30 text-blue-400 border-blue-400/30",
  },
  text_task: {
    label: "일반과제",
    className: "bg-purple-900/30 text-purple-400 border-purple-400/30",
  },
};

const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  draft: {
    label: "초안",
    className: "bg-muted text-muted-foreground",
  },
  published: {
    label: "배포됨",
    className: "bg-green-900/30 text-green-400 border-green-400/30",
  },
  closed: {
    label: "마감",
    className: "bg-red-900/30 text-red-400 border-red-400/30",
  },
};

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("ko-KR", {
    month: "short",
    day: "numeric",
    weekday: "short",
  });
}

function formatDateFull(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function isDueSoon(dueDate: string): boolean {
  const diff = new Date(dueDate).getTime() - Date.now();
  return diff > 0 && diff < 24 * 60 * 60 * 1000 * 2; // 2 days
}

function isOverdue(dueDate: string): boolean {
  return new Date(dueDate).getTime() < Date.now();
}

function stripLatexForPreview(text: string): string {
  return text
    .replace(/\$\$[\s\S]*?\$\$/g, "[수식]")
    .replace(/\$[^$]+?\$/g, "[수식]")
    .replace(/\\[a-zA-Z]+\{[^}]*\}/g, "")
    .replace(/\\[a-zA-Z]+/g, "")
    .replace(/[{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// --- Problem Search Modal ---

function ProblemSearchModal({
  open,
  onOpenChange,
  selectedProblems,
  onToggleProblem,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedProblems: Problem[];
  onToggleProblem: (problem: Problem) => void;
}) {
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  const queryString = [
    `page=${page}`,
    `limit=10`,
    `reviewStatus=approved`,
    searchQuery && `q=${encodeURIComponent(searchQuery)}`,
  ]
    .filter(Boolean)
    .join("&");

  const { data, isLoading } = useQuery({
    queryKey: ["problems-search", page, searchQuery],
    queryFn: () =>
      api.get<PaginatedResponse<Problem>>(`/problems?${queryString}`),
    enabled: open,
  });

  const problems = data?.data ?? [];
  const totalPages = data?.totalPages ?? 0;
  const selectedIds = new Set(selectedProblems.map((p) => p.id));

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setSearchQuery(searchInput);
    setPage(1);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>문제 추가</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSearch} className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="문제 검색..."
              className="pl-9 bg-brand-charcoal border-transparent"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
          </div>
          <Button type="submit" variant="secondary" size="sm">
            검색
          </Button>
        </form>

        {selectedProblems.length > 0 && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Check className="h-3 w-3 text-green-400" />
            {selectedProblems.length}개 선택됨
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-y-auto space-y-2">
          {isLoading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-16 rounded-lg" />
            ))
          ) : problems.length === 0 ? (
            <div className="flex flex-col items-center py-10 text-muted-foreground">
              <Inbox className="h-10 w-10" />
              <p className="mt-2 text-sm">검색 결과가 없습니다</p>
            </div>
          ) : (
            problems.map((problem) => {
              const isSelected = selectedIds.has(problem.id);
              return (
                <button
                  key={problem.id}
                  type="button"
                  onClick={() => onToggleProblem(problem)}
                  className={`w-full rounded-lg border p-3 text-left transition-colors ${
                    isSelected
                      ? "border-brand-beige bg-brand-beige/10"
                      : "border-border hover:border-brand-beige/50"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold ${
                        isSelected
                          ? "bg-brand-beige text-brand-dark"
                          : "bg-brand-dark text-brand-beige"
                      }`}
                    >
                      {isSelected ? (
                        <Check className="h-4 w-4" />
                      ) : (
                        problem.displayNumber ||
                        problem.problemNumber ||
                        "?"
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">
                        {stripLatexForPreview(
                          (problem.stemText || problem.stemLatex || "")
                            .split("\n")[0]
                            .slice(0, 100)
                        )}
                      </p>
                      <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                        {problem.subject && <span>{problem.subject}</span>}
                        {problem.unitMajor && (
                          <>
                            <span>&middot;</span>
                            <span>{problem.unitMajor}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-4 pt-2 border-t border-border">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm text-muted-foreground">
              {page} / {totalPages}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// --- Create Assignment Dialog ---

function CreateAssignmentDialog({
  classes,
  defaultClassId,
}: {
  classes: ClassItem[];
  defaultClassId: string;
}) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [classId, setClassId] = useState(defaultClassId);
  const [type, setType] = useState("problem_set");
  const [dueDate, setDueDate] = useState("");
  const [maxScore, setMaxScore] = useState("100");
  const [selectedProblems, setSelectedProblems] = useState<Problem[]>([]);
  const [problemSearchOpen, setProblemSearchOpen] = useState(false);

  // Sync default class when it changes
  const effectiveClassId = classId || defaultClassId;

  const createMutation = useMutation({
    mutationFn: async (body: {
      title: string;
      description?: string;
      type: string;
      dueDate?: string;
      maxScore: number;
    }) => {
      const assignment = await api.post<{ id: string }>(
        `/classes/${effectiveClassId}/assignments`,
        body
      );
      // If problem_set, add problems
      if (type === "problem_set" && selectedProblems.length > 0) {
        await api.post(`/assignments/${assignment.id}/problems`, {
          problemIds: selectedProblems.map((p) => p.id),
        });
      }
      return assignment;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["assignments"] });
      setOpen(false);
      resetForm();
      router.push(`/assignments/${data.id}`);
    },
  });

  function resetForm() {
    setTitle("");
    setDescription("");
    setType("problem_set");
    setDueDate("");
    setMaxScore("100");
    setSelectedProblems([]);
  }

  function toggleProblem(problem: Problem) {
    setSelectedProblems((prev) => {
      const exists = prev.find((p) => p.id === problem.id);
      if (exists) return prev.filter((p) => p.id !== problem.id);
      return [...prev, problem];
    });
  }

  function removeProblem(id: string) {
    setSelectedProblems((prev) => prev.filter((p) => p.id !== id));
  }

  function handleCreate() {
    if (!title.trim() || !effectiveClassId) return;
    createMutation.mutate({
      title: title.trim(),
      description: description.trim() || undefined,
      type,
      dueDate: dueDate || undefined,
      maxScore: Number(maxScore) || 100,
    });
  }

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            새 과제
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>새 과제 만들기</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            {/* Class selector */}
            <div className="space-y-2">
              <Label>반</Label>
              <Select
                value={effectiveClassId}
                onValueChange={setClassId}
              >
                <SelectTrigger>
                  <SelectValue placeholder="반 선택" />
                </SelectTrigger>
                <SelectContent>
                  {classes.map((cls) => (
                    <SelectItem key={cls.id} value={cls.id}>
                      {cls.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Title */}
            <div className="space-y-2">
              <Label htmlFor="asgn-title">과제 제목</Label>
              <Input
                id="asgn-title"
                placeholder="예: 미적분 단원평가"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>

            {/* Description */}
            <div className="space-y-2">
              <Label htmlFor="asgn-desc">설명</Label>
              <Textarea
                id="asgn-desc"
                placeholder="과제 설명 (선택)"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
              />
            </div>

            {/* Type */}
            <div className="space-y-2">
              <Label>과제 유형</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="problem_set">문제풀이</SelectItem>
                  <SelectItem value="text_task">일반과제</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Due date + max score */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="asgn-due">마감일</Label>
                <Input
                  id="asgn-due"
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="asgn-score">배점</Label>
                <Input
                  id="asgn-score"
                  type="number"
                  min={1}
                  value={maxScore}
                  onChange={(e) => setMaxScore(e.target.value)}
                />
              </div>
            </div>

            {/* Problem selection (for problem_set) */}
            {type === "problem_set" && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>문제 선택</Label>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => setProblemSearchOpen(true)}
                  >
                    <Search className="mr-1.5 h-3.5 w-3.5" />
                    문제 추가
                  </Button>
                </div>
                {selectedProblems.length > 0 ? (
                  <div className="space-y-1.5 rounded-lg border border-border p-3">
                    {selectedProblems.map((p, i) => (
                      <div
                        key={p.id}
                        className="flex items-center gap-2 text-sm"
                      >
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-brand-dark text-xs font-bold text-brand-beige">
                          {i + 1}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-muted-foreground">
                          {stripLatexForPreview(
                            (p.stemText || p.stemLatex || "")
                              .split("\n")[0]
                              .slice(0, 80)
                          )}
                        </span>
                        <button
                          type="button"
                          onClick={() => removeProblem(p.id)}
                          className="shrink-0 text-muted-foreground hover:text-destructive"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    문제를 선택하지 않았습니다.
                  </p>
                )}
              </div>
            )}

            <Button
              className="w-full"
              onClick={handleCreate}
              disabled={
                !title.trim() ||
                !effectiveClassId ||
                createMutation.isPending
              }
            >
              {createMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  생성 중...
                </>
              ) : (
                "과제 생성"
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <ProblemSearchModal
        open={problemSearchOpen}
        onOpenChange={setProblemSearchOpen}
        selectedProblems={selectedProblems}
        onToggleProblem={toggleProblem}
      />
    </>
  );
}

// --- Main Page ---

export default function AssignmentsPage() {
  const router = useRouter();
  const [selectedClassId, setSelectedClassId] = useState<string>("");

  const classesQuery = useQuery({
    queryKey: ["classes"],
    queryFn: () =>
      api.get<ClassItem[] | { data: ClassItem[] }>("/classes"),
  });

  const classes: ClassItem[] = classesQuery.data
    ? Array.isArray(classesQuery.data)
      ? classesQuery.data
      : classesQuery.data.data
    : [];

  // Auto-select first class
  const effectiveClassId = selectedClassId || classes[0]?.id || "";

  const assignmentsQuery = useQuery({
    queryKey: ["assignments", effectiveClassId],
    queryFn: () =>
      api.get<Assignment[] | PaginatedResponse<Assignment>>(
        `/classes/${effectiveClassId}/assignments`
      ),
    enabled: !!effectiveClassId,
  });

  const assignments: Assignment[] = assignmentsQuery.data
    ? Array.isArray(assignmentsQuery.data)
      ? assignmentsQuery.data
      : assignmentsQuery.data.data
    : [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">과제 / 채점</h1>
          <p className="text-muted-foreground">
            과제를 관리하고 학생 제출물을 채점합니다.
          </p>
        </div>
        {classes.length > 0 && (
          <CreateAssignmentDialog
            classes={classes}
            defaultClassId={effectiveClassId}
          />
        )}
      </div>

      {/* Class selector */}
      {classes.length > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">반:</span>
          {classes.map((cls) => (
            <Button
              key={cls.id}
              variant={
                effectiveClassId === cls.id ? "default" : "secondary"
              }
              size="sm"
              onClick={() => setSelectedClassId(cls.id)}
            >
              {cls.name}
            </Button>
          ))}
        </div>
      )}

      {/* Loading */}
      {(classesQuery.isLoading || assignmentsQuery.isLoading) && (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
      )}

      {/* Error */}
      {assignmentsQuery.isError && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <AlertCircle className="h-12 w-12 text-destructive" />
            <p className="mt-4 text-lg font-medium">
              과제 목록을 불러오지 못했습니다
            </p>
          </CardContent>
        </Card>
      )}

      {/* No classes */}
      {!classesQuery.isLoading && classes.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-20">
            <Users className="h-16 w-16 text-muted-foreground" />
            <p className="mt-4 text-lg font-medium">
              먼저 반을 생성해주세요
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              반 관리 페이지에서 반을 추가한 후 과제를 만들 수 있습니다.
            </p>
            <Button
              className="mt-4"
              variant="secondary"
              onClick={() => router.push("/classes")}
            >
              반 관리로 이동
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Empty assignments */}
      {!assignmentsQuery.isLoading &&
        !assignmentsQuery.isError &&
        effectiveClassId &&
        assignments.length === 0 && (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-20">
              <GraduationCap className="h-16 w-16 text-muted-foreground" />
              <p className="mt-4 text-lg font-medium">
                아직 과제가 없습니다
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                &quot;새 과제&quot; 버튼으로 첫 과제를 만들어보세요.
              </p>
            </CardContent>
          </Card>
        )}

      {/* Assignment list */}
      {!assignmentsQuery.isLoading &&
        !assignmentsQuery.isError &&
        assignments.length > 0 && (
          <div className="space-y-3">
            {assignments.map((asgn) => {
              const typeInfo = TYPE_LABELS[asgn.type] ?? {
                label: asgn.type,
                className: "bg-muted text-muted-foreground",
              };
              const statusInfo = STATUS_LABELS[asgn.status] ?? {
                label: asgn.status,
                className: "bg-muted text-muted-foreground",
              };
              const submissionCount = asgn._count?.submissions ?? 0;
              const totalStudents =
                asgn.class?._count?.enrollments ?? 0;
              const dueSoon = asgn.dueDate && isDueSoon(asgn.dueDate);
              const overdue = asgn.dueDate && isOverdue(asgn.dueDate);

              return (
                <Card
                  key={asgn.id}
                  className="cursor-pointer transition-colors hover:border-brand-beige"
                  onClick={() => router.push(`/assignments/${asgn.id}`)}
                >
                  <CardContent className="flex items-center gap-4 p-4">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-brand-dark">
                      <GraduationCap className="h-6 w-6 text-brand-beige" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate font-medium">{asgn.title}</p>
                        <span
                          className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium ${typeInfo.className}`}
                        >
                          {typeInfo.label}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                        {asgn.dueDate && (
                          <span
                            className={`flex items-center gap-1 ${
                              overdue
                                ? "text-red-400"
                                : dueSoon
                                  ? "text-yellow-400"
                                  : ""
                            }`}
                          >
                            <Calendar className="h-3 w-3" />
                            {formatDate(asgn.dueDate)}
                            {overdue && " (마감됨)"}
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <Users className="h-3 w-3" />
                          {submissionCount}
                          {totalStudents > 0 && `/${totalStudents}`}명 제출
                        </span>
                        {asgn.averageScore != null && (
                          <span>
                            평균 {Math.round(asgn.averageScore)}점
                          </span>
                        )}
                      </div>
                    </div>
                    <span
                      className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium ${statusInfo.className}`}
                    >
                      {statusInfo.label}
                    </span>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
    </div>
  );
}
