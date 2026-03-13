"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Loader2,
  AlertCircle,
  Users,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Radio,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { streamSse } from "@/lib/sse";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// --- Types ---

interface ClassItem {
  id: string;
  title: string;
}

interface AssignmentItem {
  id: string;
  title: string;
  dueAt: string | null;
}

interface StudentProgress {
  studentId: string;
  name: string;
  submittedCount: number;
  totalProblems: number;
  score: number | null;
  status: "not_started" | "in_progress" | "completed";
  lastActivityAt: string | null;
}

interface ClassMonitorStatus {
  classId: string;
  classTitle: string;
  assignment: {
    id: string;
    title: string;
    totalProblems: number;
    dueAt: string | null;
  } | null;
  students: StudentProgress[];
  alerts: StudentProgress[];
}

// --- Helpers ---

const STATUS_CONFIG: Record<
  string,
  { label: string; className: string }
> = {
  not_started: {
    label: "미시작",
    className: "bg-muted text-muted-foreground",
  },
  in_progress: {
    label: "진행중",
    className: "bg-blue-900/30 text-blue-400 border-blue-400/30",
  },
  completed: {
    label: "완료",
    className: "bg-green-900/30 text-green-400 border-green-400/30",
  },
};

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "방금 전";
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  return `${Math.floor(hours / 24)}일 전`;
}

function progressPercent(student: StudentProgress): number {
  if (student.totalProblems === 0) return 0;
  return Math.round((student.submittedCount / student.totalProblems) * 100);
}

// --- SSE Hook ---

function useClassMonitorSSE(classId: string | null, assignmentId: string | null) {
  const [status, setStatus] = useState<ClassMonitorStatus | null>(null);
  const [connected, setConnected] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closedRef = useRef(false);
  const reconnectDelay = useRef(1000);

  const close = useCallback(() => {
    closedRef.current = true;
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }
    if (controllerRef.current) {
      controllerRef.current.abort();
      controllerRef.current = null;
      setConnected(false);
    }
  }, []);

  useEffect(() => {
    if (!classId) return;
    closedRef.current = false;
    reconnectDelay.current = 1000;

    function connect() {
      if (closedRef.current) return;
      const apiUrl =
        process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/v1";
      const token = localStorage.getItem("token");
      if (!token) {
        setConnected(false);
        return;
      }

      const controller = new AbortController();
      controllerRef.current = controller;

      const qs = assignmentId ? `?assignmentId=${assignmentId}` : "";

      void streamSse({
        url: `${apiUrl}/class-monitor/${classId}/stream${qs}`,
        token,
        signal: controller.signal,
        onOpen: () => {
          setConnected(true);
          reconnectDelay.current = 1000;
        },
        onMessage: (message) => {
          if (message.event !== "status") return;
          try {
            const data = JSON.parse(message.data) as ClassMonitorStatus;
            setStatus(data);
          } catch {
            // ignore parse errors
          }
        },
      }).catch(() => {
        if (controller.signal.aborted) return;
        if (controllerRef.current === controller) {
          controllerRef.current = null;
        }
        setConnected(false);

        if (!closedRef.current) {
          reconnectTimer.current = setTimeout(() => {
            reconnectDelay.current = Math.min(
              reconnectDelay.current * 2,
              10_000,
            );
            connect();
          }, reconnectDelay.current);
        }
      });
    }

    connect();
    return () => {
      close();
    };
  }, [classId, assignmentId, close]);

  return { status, connected, close };
}

// --- Components ---

function StudentCard({
  student,
  isAlert,
}: {
  student: StudentProgress;
  isAlert: boolean;
}) {
  const percent = progressPercent(student);
  const statusInfo = STATUS_CONFIG[student.status] ?? STATUS_CONFIG.not_started;

  return (
    <Card
      className={`transition-colors ${
        isAlert ? "border-red-500/50 bg-red-950/20" : ""
      }`}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-dark text-sm font-bold text-brand-beige">
              {student.name.charAt(0)}
            </div>
            <div>
              <p className="font-medium">{student.name}</p>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                {student.lastActivityAt && (
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {formatRelativeTime(student.lastActivityAt)}
                  </span>
                )}
                {isAlert && (
                  <span className="flex items-center gap-1 text-red-400">
                    <AlertTriangle className="h-3 w-3" />
                    응답 없음
                  </span>
                )}
              </div>
            </div>
          </div>
          <Badge
            variant="outline"
            className={statusInfo.className}
          >
            {statusInfo.label}
          </Badge>
        </div>

        {/* Progress bar */}
        <div className="mt-3">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {student.submittedCount}/{student.totalProblems}문제
            </span>
            <span>{percent}%</span>
          </div>
          <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={`h-full rounded-full transition-all ${
                student.status === "completed"
                  ? "bg-green-500"
                  : student.status === "in_progress"
                    ? "bg-blue-500"
                    : "bg-muted-foreground/30"
              }`}
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>

        {/* Score */}
        {student.score != null && (
          <div className="mt-2 text-right text-sm font-medium text-green-400">
            {Math.round(student.score)}점
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SummaryCards({ students }: { students: StudentProgress[] }) {
  const total = students.length;
  const completed = students.filter((s) => s.status === "completed").length;
  const inProgress = students.filter((s) => s.status === "in_progress").length;
  const notStarted = students.filter((s) => s.status === "not_started").length;

  const items = [
    { label: "전체", value: total, icon: Users, color: "text-muted-foreground" },
    { label: "완료", value: completed, icon: CheckCircle2, color: "text-green-400" },
    { label: "진행중", value: inProgress, icon: Clock, color: "text-blue-400" },
    { label: "미시작", value: notStarted, icon: AlertCircle, color: "text-muted-foreground" },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {items.map((item) => (
        <Card key={item.label}>
          <CardContent className="flex items-center gap-3 p-4">
            <item.icon className={`h-5 w-5 ${item.color}`} />
            <div>
              <p className="text-2xl font-bold">{item.value}</p>
              <p className="text-xs text-muted-foreground">{item.label}</p>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// --- Main Page ---

export default function ClassMonitorPage() {
  const [selectedClassId, setSelectedClassId] = useState<string>("");
  const [selectedAssignmentId, setSelectedAssignmentId] = useState<string>("");

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

  const effectiveClassId = selectedClassId || classes[0]?.id || "";

  const assignmentsQuery = useQuery({
    queryKey: ["class-monitor-assignments", effectiveClassId],
    queryFn: () =>
      api.get<AssignmentItem[]>(
        `/class-monitor/${effectiveClassId}/assignments`,
      ),
    enabled: !!effectiveClassId,
  });

  const assignments = assignmentsQuery.data ?? [];

  // Reset assignment selection when class changes
  useEffect(() => {
    setSelectedAssignmentId("");
  }, [effectiveClassId]);

  const { status, connected } = useClassMonitorSSE(
    effectiveClassId || null,
    selectedAssignmentId || null,
  );

  const alertIds = new Set(
    (status?.alerts ?? []).map((a) => a.studentId),
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            실시간 모니터
          </h1>
          <p className="text-muted-foreground">
            학생들의 과제 진행 상황을 실시간으로 확인합니다.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Radio
            className={`h-4 w-4 ${
              connected ? "text-green-400 animate-pulse" : "text-muted-foreground"
            }`}
          />
          <span className="text-xs text-muted-foreground">
            {connected ? "실시간 연결" : "연결 중..."}
          </span>
        </div>
      </div>

      {/* Selectors */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        {classes.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="shrink-0 text-sm text-muted-foreground">반:</span>
            <Select
              value={effectiveClassId}
              onValueChange={(v) => setSelectedClassId(v)}
            >
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="반 선택" />
              </SelectTrigger>
              <SelectContent>
                {classes.map((cls) => (
                  <SelectItem key={cls.id} value={cls.id}>
                    {cls.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {assignments.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="shrink-0 text-sm text-muted-foreground">과제:</span>
            <Select
              value={selectedAssignmentId || status?.assignment?.id || ""}
              onValueChange={(v) => setSelectedAssignmentId(v)}
            >
              <SelectTrigger className="w-[260px]">
                <SelectValue placeholder="과제 선택" />
              </SelectTrigger>
              <SelectContent>
                {assignments.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {/* Loading */}
      {classesQuery.isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
      )}

      {/* No classes */}
      {!classesQuery.isLoading && classes.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-20">
            <Users className="h-16 w-16 text-muted-foreground" />
            <p className="mt-4 text-lg font-medium">
              반이 없습니다
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              반 관리 페이지에서 반을 생성해주세요.
            </p>
          </CardContent>
        </Card>
      )}

      {/* No assignment for this class */}
      {effectiveClassId && status && !status.assignment && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-20">
            <AlertCircle className="h-16 w-16 text-muted-foreground" />
            <p className="mt-4 text-lg font-medium">
              진행 중인 과제가 없습니다
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              이 반에 과제를 출제하면 학생 진행 상황이 여기에 표시됩니다.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Main content */}
      {status?.assignment && (
        <>
          {/* Assignment info */}
          <Card>
            <CardContent className="flex items-center gap-4 p-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-dark">
                <CheckCircle2 className="h-5 w-5 text-brand-beige" />
              </div>
              <div>
                <p className="font-medium">{status.assignment.title}</p>
                <p className="text-xs text-muted-foreground">
                  {status.assignment.totalProblems}문제
                  {status.assignment.dueAt &&
                    ` | 마감: ${new Date(status.assignment.dueAt).toLocaleDateString("ko-KR")}`}
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Summary */}
          <SummaryCards students={status.students} />

          {/* Alerts */}
          {status.alerts.length > 0 && (
            <Card className="border-red-500/50 bg-red-950/20">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-3">
                  <AlertTriangle className="h-4 w-4 text-red-400" />
                  <p className="text-sm font-medium text-red-400">
                    주의 필요 ({status.alerts.length}명)
                  </p>
                </div>
                <p className="text-xs text-muted-foreground">
                  아래 학생들은 5분 이상 활동이 없습니다.
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {status.alerts.map((s) => (
                    <Badge
                      key={s.studentId}
                      variant="outline"
                      className="border-red-500/30 text-red-400"
                    >
                      {s.name}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Student grid */}
          {status.students.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {status.students.map((student) => (
                <StudentCard
                  key={student.studentId}
                  student={student}
                  isAlert={alertIds.has(student.studentId)}
                />
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-16">
                <Users className="h-12 w-12 text-muted-foreground" />
                <p className="mt-4 text-sm text-muted-foreground">
                  수강 학생이 없습니다.
                </p>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* Loading SSE initial state */}
      {effectiveClassId && !status && !classesQuery.isLoading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <span className="ml-3 text-muted-foreground">
            데이터 로딩 중...
          </span>
        </div>
      )}
    </div>
  );
}
