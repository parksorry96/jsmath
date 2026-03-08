"use client";

import { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Clock,
  MapPin,
  Check,
  X,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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

interface Lesson {
  id: string;
  title: string;
  classId: string;
  className?: string;
  startTime: string;
  endTime: string;
  status: "scheduled" | "completed" | "cancelled";
  location?: string | null;
  memo?: string | null;
  rrule?: string | null;
}

interface LessonFormData {
  title: string;
  classId: string;
  startTime: string;
  endTime: string;
  location: string;
  memo: string;
  recurrence: "none" | "weekly" | "biweekly";
  recurrenceDays: number[];
}

interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

// --- Helpers ---

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const WEEKDAY_RRULE = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

const CLASS_COLORS = [
  { bg: "bg-blue-500/20", text: "text-blue-300", border: "border-blue-500/40" },
  { bg: "bg-purple-500/20", text: "text-purple-300", border: "border-purple-500/40" },
  { bg: "bg-emerald-500/20", text: "text-emerald-300", border: "border-emerald-500/40" },
  { bg: "bg-amber-500/20", text: "text-amber-300", border: "border-amber-500/40" },
  { bg: "bg-rose-500/20", text: "text-rose-300", border: "border-rose-500/40" },
  { bg: "bg-cyan-500/20", text: "text-cyan-300", border: "border-cyan-500/40" },
  { bg: "bg-orange-500/20", text: "text-orange-300", border: "border-orange-500/40" },
  { bg: "bg-pink-500/20", text: "text-pink-300", border: "border-pink-500/40" },
];

function getClassColor(classId: string) {
  let hash = 0;
  for (let i = 0; i < classId.length; i++) {
    hash = (hash * 31 + classId.charCodeAt(i)) | 0;
  }
  return CLASS_COLORS[Math.abs(hash) % CLASS_COLORS.length];
}

function getCalendarDays(year: number, month: number) {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startOffset = firstDay.getDay();
  const days: { date: Date; isCurrentMonth: boolean }[] = [];

  for (let i = startOffset - 1; i >= 0; i--) {
    days.push({ date: new Date(year, month, -i), isCurrentMonth: false });
  }
  for (let d = 1; d <= lastDay.getDate(); d++) {
    days.push({ date: new Date(year, month, d), isCurrentMonth: true });
  }
  while (days.length < 42) {
    const nextDay = days.length - startOffset - lastDay.getDate() + 1;
    days.push({ date: new Date(year, month + 1, nextDay), isCurrentMonth: false });
  }
  return days;
}

function getWeekDays(baseDate: Date) {
  const dayOfWeek = baseDate.getDay();
  const startOfWeek = new Date(baseDate);
  startOfWeek.setDate(baseDate.getDate() - dayOfWeek);

  const days: { date: Date; isCurrentMonth: boolean }[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(startOfWeek);
    d.setDate(startOfWeek.getDate() + i);
    days.push({ date: d, isCurrentMonth: true });
  }
  return days;
}

function formatTime(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function formatDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function toLocalDatetimeValue(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}T09:00`;
}

function buildRrule(recurrence: "none" | "weekly" | "biweekly", days: number[]) {
  if (recurrence === "none" || days.length === 0) return undefined;
  const interval = recurrence === "biweekly" ? 2 : 1;
  const byDay = days.map((d) => WEEKDAY_RRULE[d]).join(",");
  return `FREQ=WEEKLY;INTERVAL=${interval};BYDAY=${byDay}`;
}

const emptyForm: LessonFormData = {
  title: "",
  classId: "",
  startTime: "",
  endTime: "",
  location: "",
  memo: "",
  recurrence: "none",
  recurrenceDays: [],
};

// --- Component ---

export default function CalendarPage() {
  const queryClient = useQueryClient();
  const today = new Date();

  const [currentDate, setCurrentDate] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [view, setView] = useState<"month" | "week">("month");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingLesson, setEditingLesson] = useState<Lesson | null>(null);
  const [form, setForm] = useState<LessonFormData>(emptyForm);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  // Query range for API
  const queryRange = useMemo(() => {
    if (view === "month") {
      const start = new Date(year, month, 1);
      start.setDate(start.getDate() - start.getDay());
      const end = new Date(year, month + 1, 0);
      end.setDate(end.getDate() + (6 - end.getDay()));
      return {
        start: start.toISOString().split("T")[0],
        end: end.toISOString().split("T")[0],
      };
    }
    const days = getWeekDays(currentDate);
    return {
      start: formatDateKey(days[0].date),
      end: formatDateKey(days[6].date),
    };
  }, [year, month, view, currentDate]);

  // Fetch lessons
  const lessonsQuery = useQuery({
    queryKey: ["lessons", "calendar", queryRange.start, queryRange.end],
    queryFn: () =>
      api.get<Lesson[] | PaginatedResponse<Lesson>>(
        `/lessons/calendar?start=${queryRange.start}&end=${queryRange.end}`,
      ),
  });

  // Fetch classes for selector
  const classesQuery = useQuery({
    queryKey: ["classes"],
    queryFn: () => api.get<ClassItem[] | PaginatedResponse<ClassItem>>("/classes"),
  });

  const lessons: Lesson[] = lessonsQuery.data
    ? Array.isArray(lessonsQuery.data)
      ? lessonsQuery.data
      : lessonsQuery.data.data
    : [];

  const classes: ClassItem[] = classesQuery.data
    ? Array.isArray(classesQuery.data)
      ? classesQuery.data
      : classesQuery.data.data
    : [];

  // Group lessons by date
  const lessonsByDate = useMemo(() => {
    const map: Record<string, Lesson[]> = {};
    for (const lesson of lessons) {
      const key = formatDateKey(new Date(lesson.startTime));
      if (!map[key]) map[key] = [];
      map[key].push(lesson);
    }
    // Sort each day's lessons by start time
    for (const key in map) {
      map[key].sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
    }
    return map;
  }, [lessons]);

  const calendarDays = useMemo(() => {
    if (view === "week") return getWeekDays(currentDate);
    return getCalendarDays(year, month);
  }, [year, month, view, currentDate]);

  // Mutations
  const createMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post("/lessons", body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lessons"] });
      closeDialog();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      api.patch(`/lessons/${id}`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lessons"] });
      closeDialog();
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/lessons/${id}/cancel`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lessons"] });
      closeDialog();
    },
  });

  const completeMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/lessons/${id}/complete`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lessons"] });
      closeDialog();
    },
  });

  // Navigation
  const navigate = useCallback(
    (dir: -1 | 1) => {
      if (view === "month") {
        setCurrentDate(new Date(year, month + dir, 1));
      } else {
        const d = new Date(currentDate);
        d.setDate(d.getDate() + dir * 7);
        setCurrentDate(d);
      }
    },
    [view, year, month, currentDate],
  );

  const goToday = useCallback(() => {
    setCurrentDate(new Date(today.getFullYear(), today.getMonth(), view === "month" ? 1 : today.getDate()));
  }, [view, today]);

  // Dialog
  const openCreateDialog = useCallback(
    (date: Date) => {
      setEditingLesson(null);
      setForm({
        ...emptyForm,
        startTime: toLocalDatetimeValue(date),
        endTime: `${formatDateKey(date)}T10:00`,
      });
      setDialogOpen(true);
    },
    [],
  );

  const openEditDialog = useCallback((lesson: Lesson) => {
    setEditingLesson(lesson);
    const start = new Date(lesson.startTime);
    const end = new Date(lesson.endTime);
    setForm({
      title: lesson.title,
      classId: lesson.classId,
      startTime: toLocalDatetimeValue(start).replace(/T\d{2}:\d{2}/, `T${String(start.getHours()).padStart(2, "0")}:${String(start.getMinutes()).padStart(2, "0")}`),
      endTime: `${formatDateKey(end)}T${String(end.getHours()).padStart(2, "0")}:${String(end.getMinutes()).padStart(2, "0")}`,
      location: lesson.location ?? "",
      memo: lesson.memo ?? "",
      recurrence: "none",
      recurrenceDays: [],
    });
    setDialogOpen(true);
  }, []);

  const closeDialog = useCallback(() => {
    setDialogOpen(false);
    setEditingLesson(null);
    setForm(emptyForm);
  }, []);

  const handleSubmit = useCallback(() => {
    if (!form.title.trim() || !form.classId || !form.startTime || !form.endTime) return;

    const body: Record<string, unknown> = {
      title: form.title.trim(),
      classId: form.classId,
      startTime: new Date(form.startTime).toISOString(),
      endTime: new Date(form.endTime).toISOString(),
      location: form.location.trim() || undefined,
      memo: form.memo.trim() || undefined,
    };

    if (!editingLesson) {
      const rrule = buildRrule(form.recurrence, form.recurrenceDays);
      if (rrule) body.rrule = rrule;
      createMutation.mutate(body);
    } else {
      updateMutation.mutate({ id: editingLesson.id, body });
    }
  }, [form, editingLesson, createMutation, updateMutation]);

  const isPending =
    createMutation.isPending || updateMutation.isPending || cancelMutation.isPending || completeMutation.isPending;

  const todayKey = formatDateKey(today);

  // Header title
  const headerTitle = useMemo(() => {
    if (view === "month") {
      return `${year}년 ${month + 1}월`;
    }
    const days = getWeekDays(currentDate);
    const first = days[0].date;
    const last = days[6].date;
    if (first.getMonth() === last.getMonth()) {
      return `${first.getFullYear()}년 ${first.getMonth() + 1}월 ${first.getDate()}일 — ${last.getDate()}일`;
    }
    return `${first.getMonth() + 1}/${first.getDate()} — ${last.getMonth() + 1}/${last.getDate()}`;
  }, [view, year, month, currentDate]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">캘린더</h1>
          <p className="text-muted-foreground">수업 일정을 관리합니다.</p>
        </div>
        <Button onClick={() => openCreateDialog(today)}>
          <Plus className="mr-2 h-4 w-4" />
          수업 추가
        </Button>
      </div>

      {/* Navigation */}
      <Card>
        <CardContent className="flex items-center justify-between p-3">
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="sm" onClick={goToday}>
              오늘
            </Button>
            <Button variant="ghost" size="icon" onClick={() => navigate(1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
            <span className="ml-2 text-lg font-semibold">{headerTitle}</span>
          </div>
          <div className="flex rounded-lg border border-border">
            <Button
              variant={view === "month" ? "secondary" : "ghost"}
              size="sm"
              className="rounded-r-none"
              onClick={() => setView("month")}
            >
              월간
            </Button>
            <Button
              variant={view === "week" ? "secondary" : "ghost"}
              size="sm"
              className="rounded-l-none"
              onClick={() => setView("week")}
            >
              주간
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Calendar Grid */}
      {lessonsQuery.isLoading ? (
        <Card>
          <CardContent className="p-4">
            <div className="grid grid-cols-7 gap-1">
              {Array.from({ length: 7 }).map((_, i) => (
                <Skeleton key={i} className="h-6" />
              ))}
              {Array.from({ length: view === "week" ? 7 : 35 }).map((_, i) => (
                <Skeleton key={`c-${i}`} className="h-24" />
              ))}
            </div>
          </CardContent>
        </Card>
      ) : lessonsQuery.isError ? (
        <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
          <AlertCircle className="h-8 w-8" />
          <p className="text-sm">일정을 불러올 수 없습니다.</p>
          <Button variant="ghost" size="sm" onClick={() => lessonsQuery.refetch()}>
            다시 시도
          </Button>
        </div>
      ) : (
        <Card>
          <CardContent className="p-2 sm:p-4">
            {/* Weekday headers */}
            <div className="grid grid-cols-7 gap-1 mb-1">
              {WEEKDAYS.map((day, i) => (
                <div
                  key={day}
                  className={`py-2 text-center text-xs font-medium ${
                    i === 0 ? "text-rose-400" : i === 6 ? "text-blue-400" : "text-muted-foreground"
                  }`}
                >
                  {day}
                </div>
              ))}
            </div>

            {/* Day cells */}
            <div className="grid grid-cols-7 gap-1">
              {calendarDays.map(({ date, isCurrentMonth }, idx) => {
                const key = formatDateKey(date);
                const dayLessons = lessonsByDate[key] ?? [];
                const isToday = key === todayKey;
                const dayOfWeek = date.getDay();

                return (
                  <div
                    key={idx}
                    className={`group relative min-h-[5.5rem] cursor-pointer rounded-md border p-1 transition-colors hover:border-brand-beige/50 ${
                      isCurrentMonth
                        ? "border-border bg-card"
                        : "border-transparent bg-card/30"
                    } ${isToday ? "border-brand-beige" : ""} ${
                      view === "week" ? "min-h-[10rem]" : ""
                    }`}
                    onClick={() => openCreateDialog(date)}
                  >
                    <div className="flex items-center justify-between px-1">
                      <span
                        className={`text-xs font-medium ${
                          !isCurrentMonth
                            ? "text-muted-foreground/50"
                            : isToday
                              ? "flex h-5 w-5 items-center justify-center rounded-full bg-brand-beige text-brand-dark"
                              : dayOfWeek === 0
                                ? "text-rose-400"
                                : dayOfWeek === 6
                                  ? "text-blue-400"
                                  : "text-foreground"
                        }`}
                      >
                        {date.getDate()}
                      </span>
                      {dayLessons.length > 0 && view === "month" && (
                        <span className="text-[10px] text-muted-foreground">
                          {dayLessons.length}
                        </span>
                      )}
                    </div>

                    <div className="mt-0.5 space-y-0.5">
                      {dayLessons
                        .slice(0, view === "week" ? 10 : 3)
                        .map((lesson) => {
                          const color = getClassColor(lesson.classId);
                          const isCancelled = lesson.status === "cancelled";
                          const isCompleted = lesson.status === "completed";

                          return (
                            <button
                              key={lesson.id}
                              className={`w-full rounded px-1 py-0.5 text-left text-[11px] leading-tight transition-opacity hover:opacity-80 ${
                                color.bg
                              } ${color.text} ${
                                isCancelled ? "line-through opacity-50" : ""
                              }`}
                              onClick={(e) => {
                                e.stopPropagation();
                                openEditDialog(lesson);
                              }}
                            >
                              <span className="flex items-center gap-0.5">
                                {isCompleted && (
                                  <Check className="h-2.5 w-2.5 shrink-0 text-emerald-400" />
                                )}
                                {isCancelled && (
                                  <X className="h-2.5 w-2.5 shrink-0 text-muted-foreground" />
                                )}
                                <span className="truncate">
                                  {formatTime(lesson.startTime)} {lesson.title}
                                </span>
                              </span>
                            </button>
                          );
                        })}
                      {dayLessons.length > (view === "week" ? 10 : 3) && (
                        <p className="px-1 text-[10px] text-muted-foreground">
                          +{dayLessons.length - (view === "week" ? 10 : 3)}개 더
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingLesson ? "수업 수정" : "수업 추가"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 pt-2">
            {/* Title */}
            <div className="space-y-2">
              <Label htmlFor="lesson-title">수업 제목</Label>
              <Input
                id="lesson-title"
                placeholder="예: 수학 I 정기수업"
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              />
            </div>

            {/* Class Selector */}
            <div className="space-y-2">
              <Label>반 선택</Label>
              <Select
                value={form.classId}
                onValueChange={(v) => setForm((f) => ({ ...f, classId: v }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="반을 선택하세요" />
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

            {/* Time */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="lesson-start">시작 시간</Label>
                <Input
                  id="lesson-start"
                  type="datetime-local"
                  value={form.startTime}
                  onChange={(e) => setForm((f) => ({ ...f, startTime: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lesson-end">종료 시간</Label>
                <Input
                  id="lesson-end"
                  type="datetime-local"
                  value={form.endTime}
                  onChange={(e) => setForm((f) => ({ ...f, endTime: e.target.value }))}
                />
              </div>
            </div>

            {/* Recurrence (create only) */}
            {!editingLesson && (
              <div className="space-y-2">
                <Label>반복</Label>
                <Select
                  value={form.recurrence}
                  onValueChange={(v) =>
                    setForm((f) => ({
                      ...f,
                      recurrence: v as LessonFormData["recurrence"],
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">없음</SelectItem>
                    <SelectItem value="weekly">매주</SelectItem>
                    <SelectItem value="biweekly">격주</SelectItem>
                  </SelectContent>
                </Select>

                {form.recurrence !== "none" && (
                  <div className="flex flex-wrap gap-1 pt-1">
                    {WEEKDAYS.map((day, i) => {
                      const active = form.recurrenceDays.includes(i);
                      return (
                        <Button
                          key={day}
                          type="button"
                          size="sm"
                          variant={active ? "default" : "outline"}
                          className="h-8 w-8 p-0 text-xs"
                          onClick={() =>
                            setForm((f) => ({
                              ...f,
                              recurrenceDays: active
                                ? f.recurrenceDays.filter((d) => d !== i)
                                : [...f.recurrenceDays, i],
                            }))
                          }
                        >
                          {day}
                        </Button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Location */}
            <div className="space-y-2">
              <Label htmlFor="lesson-location">장소 (선택)</Label>
              <div className="relative">
                <MapPin className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="lesson-location"
                  className="pl-9"
                  placeholder="예: 201호"
                  value={form.location}
                  onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
                />
              </div>
            </div>

            {/* Memo */}
            <div className="space-y-2">
              <Label htmlFor="lesson-memo">메모 (선택)</Label>
              <Input
                id="lesson-memo"
                placeholder="수업 관련 메모"
                value={form.memo}
                onChange={(e) => setForm((f) => ({ ...f, memo: e.target.value }))}
              />
            </div>

            {/* Status badge for editing */}
            {editingLesson && (
              <div className="flex items-center gap-2">
                <Label>상태</Label>
                <Badge
                  variant={
                    editingLesson.status === "completed"
                      ? "default"
                      : editingLesson.status === "cancelled"
                        ? "secondary"
                        : "outline"
                  }
                >
                  {editingLesson.status === "scheduled"
                    ? "예정"
                    : editingLesson.status === "completed"
                      ? "완료"
                      : "취소"}
                </Badge>
              </div>
            )}

            {/* Actions */}
            <div className="flex flex-col gap-2 pt-2">
              <Button
                onClick={handleSubmit}
                disabled={
                  !form.title.trim() || !form.classId || !form.startTime || !form.endTime || isPending
                }
              >
                {isPending
                  ? "저장 중..."
                  : editingLesson
                    ? "수정"
                    : "추가"}
              </Button>

              {editingLesson && editingLesson.status === "scheduled" && (
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    variant="outline"
                    onClick={() => completeMutation.mutate(editingLesson.id)}
                    disabled={isPending}
                  >
                    <Check className="mr-1 h-4 w-4 text-emerald-400" />
                    수업 완료
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => cancelMutation.mutate(editingLesson.id)}
                    disabled={isPending}
                  >
                    <X className="mr-1 h-4 w-4 text-destructive" />
                    수업 취소
                  </Button>
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
