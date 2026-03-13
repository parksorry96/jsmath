"use client";

import { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CalendarCheck,
  CreditCard,
  Users,
  AlertCircle,
  CheckCircle2,
  Clock,
  XCircle,
} from "lucide-react";
import { api } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

// ─── Types ───

interface ClassItem {
  id: string;
  title: string;
}

interface Student {
  id: string;
  name: string;
}

type AttendanceStatus = "present" | "absent" | "late" | "excused";

interface AttendanceRecord {
  id: string;
  studentId: string;
  classId: string;
  date: string;
  status: AttendanceStatus;
  note: string | null;
  student: Student;
}

interface AttendanceGridData {
  students: Student[];
  attendances: AttendanceRecord[];
  month: string;
}

interface AttendanceStat {
  id: string;
  name: string;
  present: number;
  absent: number;
  late: number;
  excused: number;
}

type BillingType = "tuition" | "material" | "extra_class" | "other";
type BillingStatus = "pending" | "paid" | "overdue" | "cancelled";

interface BillingRecord {
  id: string;
  studentId: string;
  classId: string | null;
  type: BillingType;
  amount: number;
  description: string | null;
  billingMonth: string;
  status: BillingStatus;
  paidAt: string | null;
  student: Student;
}

interface BillingStatement {
  month: string;
  classId: string;
  records: BillingRecord[];
  summary: {
    totalBilled: number;
    totalPaid: number;
    totalPending: number;
    totalOverdue: number;
    count: number;
  };
}

// ─── Labels ───

const attendanceStatusLabel: Record<AttendanceStatus, string> = {
  present: "출석",
  absent: "결석",
  late: "지각",
  excused: "사유",
};

const attendanceStatusIcon: Record<AttendanceStatus, string> = {
  present: "\u25CF",
  absent: "\u2715",
  late: "\u25B3",
  excused: "\u25CB",
};

const attendanceStatusColor: Record<AttendanceStatus, string> = {
  present: "text-emerald-600",
  absent: "text-red-500",
  late: "text-amber-500",
  excused: "text-blue-500",
};

const billingTypeLabel: Record<BillingType, string> = {
  tuition: "수업료",
  material: "교재비",
  extra_class: "특강",
  other: "기타",
};

const billingStatusLabel: Record<BillingStatus, string> = {
  pending: "미납",
  paid: "납부완료",
  overdue: "연체",
  cancelled: "취소",
};

const billingStatusVariant: Record<BillingStatus, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "outline",
  paid: "default",
  overdue: "destructive",
  cancelled: "secondary",
};

// ─── Helpers ───

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function getDatesInMonth(month: string): string[] {
  const [y, m] = month.split("-").map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const dates: string[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    dates.push(`${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  }
  return dates;
}

function formatAmount(amount: number): string {
  return new Intl.NumberFormat("ko-KR").format(amount) + "원";
}

// ─── Attendance Status Cycle ───
const statusCycle: AttendanceStatus[] = ["present", "absent", "late", "excused"];

function nextStatus(current?: AttendanceStatus): AttendanceStatus {
  if (!current) return "present";
  const idx = statusCycle.indexOf(current);
  return statusCycle[(idx + 1) % statusCycle.length];
}

// ─── Page Component ───

export default function OperationsPage() {
  const [selectedClassId, setSelectedClassId] = useState<string>("");
  const [month, setMonth] = useState(currentMonth);

  const classesQuery = useQuery({
    queryKey: ["classes"],
    queryFn: () => api.get<ClassItem[]>("/classes"),
  });

  const classes = classesQuery.data ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">학원 운영</h1>
        <p className="text-muted-foreground">출석 관리 및 수강료 관리</p>
      </div>

      <div className="flex items-center gap-3">
        <div className="w-48">
          <Select value={selectedClassId} onValueChange={setSelectedClassId}>
            <SelectTrigger>
              <SelectValue placeholder="반 선택" />
            </SelectTrigger>
            <SelectContent>
              {classes.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-40">
          <Input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
          />
        </div>
      </div>

      {!selectedClassId ? (
        <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
          <Users className="h-8 w-8" />
          <p className="text-sm">반을 선택해주세요.</p>
        </div>
      ) : (
        <Tabs defaultValue="attendance">
          <TabsList>
            <TabsTrigger value="attendance">
              <CalendarCheck className="mr-1.5 h-4 w-4" />
              출석
            </TabsTrigger>
            <TabsTrigger value="billing">
              <CreditCard className="mr-1.5 h-4 w-4" />
              수강료
            </TabsTrigger>
          </TabsList>

          <TabsContent value="attendance" className="mt-4">
            <AttendanceTab classId={selectedClassId} month={month} />
          </TabsContent>
          <TabsContent value="billing" className="mt-4">
            <BillingTab classId={selectedClassId} month={month} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

// ─── Attendance Tab ───

function AttendanceTab({ classId, month }: { classId: string; month: string }) {
  const queryClient = useQueryClient();

  const gridQuery = useQuery({
    queryKey: ["attendance", "class", classId, month],
    queryFn: () =>
      api.get<AttendanceGridData>(
        `/operations/attendance/class/${classId}?month=${month}`,
      ),
  });

  const statsQuery = useQuery({
    queryKey: ["attendance", "stats", classId, month],
    queryFn: () =>
      api.get<AttendanceStat[]>(
        `/operations/attendance/stats/${classId}?month=${month}`,
      ),
  });

  const checkInMutation = useMutation({
    mutationFn: (body: {
      studentId: string;
      classId: string;
      date: string;
      status: AttendanceStatus;
    }) => api.post("/operations/attendance/check-in", body),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["attendance", "class", classId, month],
      });
      queryClient.invalidateQueries({
        queryKey: ["attendance", "stats", classId, month],
      });
    },
  });

  const bulkCheckInMutation = useMutation({
    mutationFn: (body: {
      classId: string;
      date: string;
      records: { studentId: string; status: AttendanceStatus }[];
    }) => api.post("/operations/attendance/bulk", body),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["attendance", "class", classId, month],
      });
      queryClient.invalidateQueries({
        queryKey: ["attendance", "stats", classId, month],
      });
    },
  });

  const data = gridQuery.data;
  const stats = statsQuery.data ?? [];
  const dates = useMemo(() => getDatesInMonth(month), [month]);

  // Build attendance lookup: studentId -> date -> status
  const attendanceMap = useMemo(() => {
    const map = new Map<string, Map<string, AttendanceStatus>>();
    if (!data) return map;
    for (const a of data.attendances) {
      const dateKey = a.date.slice(0, 10);
      if (!map.has(a.studentId)) map.set(a.studentId, new Map());
      map.get(a.studentId)!.set(dateKey, a.status);
    }
    return map;
  }, [data]);

  const handleCellClick = useCallback(
    (studentId: string, date: string) => {
      const current = attendanceMap.get(studentId)?.get(date);
      const next = nextStatus(current);
      checkInMutation.mutate({ studentId, classId, date, status: next });
    },
    [attendanceMap, classId, checkInMutation],
  );

  const handleBulkToday = useCallback(() => {
    if (!data) return;
    const today = new Date().toISOString().slice(0, 10);
    const records = data.students.map((s) => ({
      studentId: s.id,
      status: "present" as AttendanceStatus,
    }));
    bulkCheckInMutation.mutate({ classId, date: today, records });
  }, [data, classId, bulkCheckInMutation]);

  if (gridQuery.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (gridQuery.isError) {
    return (
      <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
        <AlertCircle className="h-8 w-8" />
        <p className="text-sm">출석 데이터를 불러올 수 없습니다.</p>
        <Button variant="ghost" size="sm" onClick={() => gridQuery.refetch()}>
          다시 시도
        </Button>
      </div>
    );
  }

  const students = data?.students ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          {statusCycle.map((s) => (
            <span key={s} className="flex items-center gap-1">
              <span className={attendanceStatusColor[s]}>
                {attendanceStatusIcon[s]}
              </span>
              {attendanceStatusLabel[s]}
            </span>
          ))}
        </div>
        <Button size="sm" onClick={handleBulkToday} disabled={bulkCheckInMutation.isPending}>
          {bulkCheckInMutation.isPending ? "처리 중..." : "오늘 전체 출석"}
        </Button>
      </div>

      {students.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
          <Users className="h-8 w-8" />
          <p className="text-sm">등록된 학생이 없습니다.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="sticky left-0 z-10 bg-muted/50 px-3 py-2 text-left font-medium">
                  학생
                </th>
                {dates.map((d) => (
                  <th
                    key={d}
                    className="min-w-[32px] px-1 py-2 text-center font-medium"
                  >
                    {parseInt(d.slice(8), 10)}
                  </th>
                ))}
                <th className="px-3 py-2 text-center font-medium">출석률</th>
              </tr>
            </thead>
            <tbody>
              {students.map((student) => {
                const studentStats = stats.find((s) => s.id === student.id);
                const total = studentStats
                  ? studentStats.present +
                    studentStats.absent +
                    studentStats.late +
                    studentStats.excused
                  : 0;
                const rate =
                  total > 0 && studentStats
                    ? Math.round(
                        ((studentStats.present + studentStats.late) / total) *
                          100,
                      )
                    : 0;

                return (
                  <tr key={student.id} className="border-b last:border-b-0">
                    <td className="sticky left-0 z-10 bg-background px-3 py-2 font-medium whitespace-nowrap">
                      {student.name}
                    </td>
                    {dates.map((d) => {
                      const status = attendanceMap.get(student.id)?.get(d);
                      return (
                        <td
                          key={d}
                          className="px-1 py-2 text-center cursor-pointer hover:bg-muted/50"
                          onClick={() => handleCellClick(student.id, d)}
                        >
                          {status && (
                            <span
                              className={`text-base ${attendanceStatusColor[status]}`}
                            >
                              {attendanceStatusIcon[status]}
                            </span>
                          )}
                        </td>
                      );
                    })}
                    <td className="px-3 py-2 text-center">
                      {total > 0 ? (
                        <span
                          className={
                            rate >= 80
                              ? "text-emerald-600"
                              : rate >= 60
                                ? "text-amber-500"
                                : "text-red-500"
                          }
                        >
                          {rate}%
                        </span>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Billing Tab ───

function BillingTab({ classId, month }: { classId: string; month: string }) {
  const queryClient = useQueryClient();
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkType, setBulkType] = useState<BillingType>("tuition");
  const [bulkAmount, setBulkAmount] = useState("");
  const [bulkDescription, setBulkDescription] = useState("");

  const statementQuery = useQuery({
    queryKey: ["billing", "statement", classId, month],
    queryFn: () =>
      api.get<BillingStatement>(
        `/operations/billing/statement/${classId}?month=${month}`,
      ),
  });

  const bulkGenerateMutation = useMutation({
    mutationFn: (body: {
      classId: string;
      billingMonth: string;
      type: BillingType;
      amount: number;
      description?: string;
    }) => api.post("/operations/billing/bulk-generate", body),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["billing", "statement", classId, month],
      });
      setBulkOpen(false);
      setBulkAmount("");
      setBulkDescription("");
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: (params: { id: string; status: BillingStatus }) =>
      api.patch(`/operations/billing/${params.id}/status`, {
        status: params.status,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["billing", "statement", classId, month],
      });
    },
  });

  const handleBulkGenerate = () => {
    const amount = parseInt(bulkAmount, 10);
    if (!amount || amount <= 0) return;
    bulkGenerateMutation.mutate({
      classId,
      billingMonth: month + "-01",
      type: bulkType,
      amount,
      description: bulkDescription.trim() || undefined,
    });
  };

  if (statementQuery.isLoading) {
    return (
      <div className="space-y-3">
        <div className="grid gap-4 md:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (statementQuery.isError) {
    return (
      <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
        <AlertCircle className="h-8 w-8" />
        <p className="text-sm">수강료 데이터를 불러올 수 없습니다.</p>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => statementQuery.refetch()}
        >
          다시 시도
        </Button>
      </div>
    );
  }

  const statement = statementQuery.data;
  const summary = statement?.summary;
  const records = statement?.records ?? [];

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <CreditCard className="h-8 w-8 text-muted-foreground" />
            <div>
              <p className="text-xs text-muted-foreground">총 청구</p>
              <p className="text-lg font-bold">
                {formatAmount(summary?.totalBilled ?? 0)}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <CheckCircle2 className="h-8 w-8 text-emerald-600" />
            <div>
              <p className="text-xs text-muted-foreground">납부 완료</p>
              <p className="text-lg font-bold text-emerald-600">
                {formatAmount(summary?.totalPaid ?? 0)}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <Clock className="h-8 w-8 text-amber-500" />
            <div>
              <p className="text-xs text-muted-foreground">미납</p>
              <p className="text-lg font-bold text-amber-500">
                {formatAmount(summary?.totalPending ?? 0)}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <XCircle className="h-8 w-8 text-red-500" />
            <div>
              <p className="text-xs text-muted-foreground">연체</p>
              <p className="text-lg font-bold text-red-500">
                {formatAmount(summary?.totalOverdue ?? 0)}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Action bar */}
      <div className="flex justify-end">
        <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
          <DialogTrigger asChild>
            <Button size="sm">일괄 청구 생성</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>일괄 수강료 청구</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="space-y-2">
                <Label>청구 유형</Label>
                <Select
                  value={bulkType}
                  onValueChange={(v) => setBulkType(v as BillingType)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(
                      Object.entries(billingTypeLabel) as [BillingType, string][]
                    ).map(([k, v]) => (
                      <SelectItem key={k} value={k}>
                        {v}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>금액 (원)</Label>
                <Input
                  type="number"
                  placeholder="예: 300000"
                  value={bulkAmount}
                  onChange={(e) => setBulkAmount(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>설명 (선택)</Label>
                <Input
                  placeholder="예: 3월 수업료"
                  value={bulkDescription}
                  onChange={(e) => setBulkDescription(e.target.value)}
                />
              </div>
              <Button
                className="w-full"
                onClick={handleBulkGenerate}
                disabled={
                  !bulkAmount ||
                  parseInt(bulkAmount, 10) <= 0 ||
                  bulkGenerateMutation.isPending
                }
              >
                {bulkGenerateMutation.isPending ? "생성 중..." : "일괄 생성"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Billing table */}
      {records.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
          <CreditCard className="h-8 w-8" />
          <p className="text-sm">이번 달 청구 내역이 없습니다.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-3 py-2 text-left font-medium">학생</th>
                <th className="px-3 py-2 text-left font-medium">유형</th>
                <th className="px-3 py-2 text-right font-medium">금액</th>
                <th className="px-3 py-2 text-left font-medium">설명</th>
                <th className="px-3 py-2 text-center font-medium">상태</th>
                <th className="px-3 py-2 text-center font-medium">납부일</th>
                <th className="px-3 py-2 text-center font-medium">관리</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r) => (
                <tr key={r.id} className="border-b last:border-b-0">
                  <td className="px-3 py-2 font-medium">{r.student.name}</td>
                  <td className="px-3 py-2">{billingTypeLabel[r.type]}</td>
                  <td className="px-3 py-2 text-right font-mono">
                    {formatAmount(r.amount)}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {r.description ?? "-"}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <Badge variant={billingStatusVariant[r.status]}>
                      {billingStatusLabel[r.status]}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-center text-muted-foreground">
                    {r.paidAt
                      ? new Date(r.paidAt).toLocaleDateString("ko-KR")
                      : "-"}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <div className="flex items-center justify-center gap-1">
                      {r.status !== "paid" && r.status !== "cancelled" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs text-emerald-600 hover:text-emerald-700"
                          disabled={updateStatusMutation.isPending}
                          onClick={() =>
                            updateStatusMutation.mutate({
                              id: r.id,
                              status: "paid",
                            })
                          }
                        >
                          납부
                        </Button>
                      )}
                      {r.status === "pending" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs text-red-500 hover:text-red-600"
                          disabled={updateStatusMutation.isPending}
                          onClick={() =>
                            updateStatusMutation.mutate({
                              id: r.id,
                              status: "overdue",
                            })
                          }
                        >
                          연체
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
