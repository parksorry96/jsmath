import { useState, useMemo, useCallback } from "react";
import {
  View,
  Text,
  Pressable,
  FlatList,
  TextInput,
  Modal,
  ScrollView,
  Alert,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

interface Class {
  id: string;
  name: string;
}

interface Lesson {
  id: string;
  classId: string;
  title: string;
  startTime: string;
  endTime: string;
  status: "scheduled" | "completed" | "cancelled";
  location?: string;
  memo?: string;
  class?: Class;
}

interface LessonForm {
  classId: string;
  title: string;
  startTime: string;
  endTime: string;
  location: string;
  memo: string;
  recurrence: "none" | "weekly" | "biweekly";
}

const DAYS = ["일", "월", "화", "수", "목", "금", "토"];
const MONTHS = [
  "1월", "2월", "3월", "4월", "5월", "6월",
  "7월", "8월", "9월", "10월", "11월", "12월",
];

function sameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function formatDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
}

function getMonthDays(year: number, month: number) {
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const days: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) days.push(null);
  for (let i = 1; i <= daysInMonth; i++) days.push(i);
  return days;
}

const STATUS_LABEL: Record<string, string> = {
  scheduled: "예정",
  completed: "완료",
  cancelled: "취소",
};

const CLASS_COLORS = [
  "#d4a574", "#4ade80", "#60a5fa", "#f472b6",
  "#a78bfa", "#facc15", "#fb923c", "#34d399",
];

const EMPTY_FORM: LessonForm = {
  classId: "",
  title: "",
  startTime: "09:00",
  endTime: "10:00",
  location: "",
  memo: "",
  recurrence: "none",
};

export default function TeacherCalendar() {
  const queryClient = useQueryClient();
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [selectedDate, setSelectedDate] = useState<Date>(today);
  const [showModal, setShowModal] = useState(false);
  const [editingLesson, setEditingLesson] = useState<Lesson | null>(null);
  const [form, setForm] = useState<LessonForm>(EMPTY_FORM);
  const [refreshing, setRefreshing] = useState(false);

  const monthStart = new Date(year, month, 1);
  const monthEnd = new Date(year, month + 1, 0, 23, 59, 59);

  const lessonsQuery = useQuery({
    queryKey: ["lessons", "calendar", year, month],
    queryFn: () =>
      api.get<Lesson[]>(
        `/lessons/calendar?start=${monthStart.toISOString()}&end=${monthEnd.toISOString()}`
      ),
  });

  const classesQuery = useQuery({
    queryKey: ["classes"],
    queryFn: () => api.get<Class[]>("/classes"),
  });

  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      api.post<Lesson>("/lessons", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lessons"] });
      setShowModal(false);
      resetForm();
    },
    onError: (err) => Alert.alert("오류", err.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      api.patch<Lesson>(`/lessons/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lessons"] });
      setShowModal(false);
      resetForm();
    },
    onError: (err) => Alert.alert("오류", err.message),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "complete" | "cancel" }) =>
      api.patch<Lesson>(`/lessons/${id}/${action}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["lessons"] }),
    onError: (err) => Alert.alert("오류", err.message),
  });

  const lessons = lessonsQuery.data ?? [];
  const classes = classesQuery.data ?? [];
  const days = useMemo(() => getMonthDays(year, month), [year, month]);

  const classColorMap = useMemo(() => {
    const map: Record<string, string> = {};
    classes.forEach((c, i) => {
      map[c.id] = CLASS_COLORS[i % CLASS_COLORS.length];
    });
    return map;
  }, [classes]);

  const lessonsByDate = useMemo(() => {
    const map: Record<string, Lesson[]> = {};
    lessons.forEach((l) => {
      const key = formatDate(new Date(l.startTime));
      if (!map[key]) map[key] = [];
      map[key].push(l);
    });
    return map;
  }, [lessons]);

  const selectedKey = formatDate(selectedDate);
  const selectedLessons = lessonsByDate[selectedKey] ?? [];

  function prevMonth() {
    if (month === 0) { setYear(year - 1); setMonth(11); }
    else setMonth(month - 1);
  }
  function nextMonth() {
    if (month === 11) { setYear(year + 1); setMonth(0); }
    else setMonth(month + 1);
  }

  function resetForm() {
    setForm(EMPTY_FORM);
    setEditingLesson(null);
  }

  function openAdd() {
    resetForm();
    setShowModal(true);
  }

  function openEdit(lesson: Lesson) {
    setEditingLesson(lesson);
    const st = new Date(lesson.startTime);
    const et = new Date(lesson.endTime);
    setForm({
      classId: lesson.classId,
      title: lesson.title,
      startTime: `${String(st.getHours()).padStart(2, "0")}:${String(st.getMinutes()).padStart(2, "0")}`,
      endTime: `${String(et.getHours()).padStart(2, "0")}:${String(et.getMinutes()).padStart(2, "0")}`,
      location: lesson.location ?? "",
      memo: lesson.memo ?? "",
      recurrence: "none",
    });
    setShowModal(true);
  }

  function handleSave() {
    if (!form.classId || !form.title) {
      Alert.alert("입력 오류", "반과 제목을 입력하세요");
      return;
    }

    const [sh, sm] = form.startTime.split(":").map(Number);
    const [eh, em] = form.endTime.split(":").map(Number);
    const startDt = new Date(selectedDate);
    startDt.setHours(sh, sm, 0, 0);
    const endDt = new Date(selectedDate);
    endDt.setHours(eh, em, 0, 0);

    const payload = {
      classId: form.classId,
      title: form.title,
      startTime: startDt.toISOString(),
      endTime: endDt.toISOString(),
      location: form.location || undefined,
      memo: form.memo || undefined,
      recurrence: form.recurrence === "none" ? undefined : form.recurrence,
    };

    if (editingLesson) {
      updateMutation.mutate({ id: editingLesson.id, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  }

  function handleStatusChange(lesson: Lesson, action: "complete" | "cancel") {
    const label = action === "complete" ? "완료" : "취소";
    Alert.alert(`수업 ${label}`, `이 수업을 ${label} 처리하시겠습니까?`, [
      { text: "아니오", style: "cancel" },
      { text: "예", onPress: () => statusMutation.mutate({ id: lesson.id, action }) },
    ]);
  }

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await lessonsQuery.refetch();
    setRefreshing(false);
  }, [lessonsQuery]);

  const isSaving = createMutation.isPending || updateMutation.isPending;

  return (
    <SafeAreaView edges={["bottom"]} className="flex-1 bg-brand-dark">
      <FlatList
        data={[]}
        renderItem={null}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#d4a574" />
        }
        ListHeaderComponent={
          <View className="px-4 pt-2 pb-8">
            {/* Month Navigation */}
            <View className="flex-row justify-between items-center mb-4">
              <Pressable onPress={prevMonth} className="p-2">
                <Text className="text-brand-beige text-xl">‹</Text>
              </Pressable>
              <Text className="text-brand-beige text-lg font-bold">
                {year}년 {MONTHS[month]}
              </Text>
              <Pressable onPress={nextMonth} className="p-2">
                <Text className="text-brand-beige text-xl">›</Text>
              </Pressable>
            </View>

            {/* Day Headers */}
            <View className="flex-row mb-1">
              {DAYS.map((d) => (
                <View key={d} className="flex-1 items-center">
                  <Text className="text-[#888] text-xs">{d}</Text>
                </View>
              ))}
            </View>

            {/* Calendar Grid */}
            <View className="flex-row flex-wrap mb-4">
              {days.map((day, idx) => {
                if (day === null) {
                  return <View key={`e-${idx}`} style={{ width: "14.28%" }} className="h-12" />;
                }
                const date = new Date(year, month, day);
                const key = formatDate(date);
                const dayLessons = lessonsByDate[key] ?? [];
                const isSelected = sameDay(date, selectedDate);
                const isToday = sameDay(date, today);

                return (
                  <Pressable
                    key={key}
                    style={{ width: "14.28%" }}
                    className="h-12 items-center pt-1"
                    onPress={() => setSelectedDate(date)}
                  >
                    <View
                      className={`w-7 h-7 rounded-full items-center justify-center ${
                        isSelected ? "bg-brand-accent" : isToday ? "border border-brand-accent" : ""
                      }`}
                    >
                      <Text
                        className={`text-sm ${
                          isSelected ? "text-brand-dark font-bold" : "text-brand-beige"
                        }`}
                      >
                        {day}
                      </Text>
                    </View>
                    {dayLessons.length > 0 && (
                      <View className="flex-row gap-0.5 mt-0.5">
                        {dayLessons.slice(0, 3).map((l) => (
                          <View
                            key={l.id}
                            className="w-1.5 h-1.5 rounded-full"
                            style={{ backgroundColor: classColorMap[l.classId] ?? "#d4a574" }}
                          />
                        ))}
                      </View>
                    )}
                  </Pressable>
                );
              })}
            </View>

            {/* Selected Date Lessons */}
            <View className="flex-row justify-between items-center mb-3">
              <Text className="text-brand-beige font-bold text-base">
                {selectedDate.getMonth() + 1}월 {selectedDate.getDate()}일 ({DAYS[selectedDate.getDay()]})
              </Text>
              <Pressable
                className="bg-brand-accent px-4 py-2 rounded-lg"
                onPress={openAdd}
              >
                <Text className="text-brand-dark font-bold text-sm">수업 추가</Text>
              </Pressable>
            </View>

            {lessonsQuery.isLoading ? (
              <ActivityIndicator color="#d4a574" />
            ) : selectedLessons.length === 0 ? (
              <View className="bg-[#2a2a2a] rounded-xl p-4">
                <Text className="text-[#888] text-center">수업이 없습니다</Text>
              </View>
            ) : (
              selectedLessons.map((lesson) => (
                <View key={lesson.id} className="bg-[#2a2a2a] rounded-xl p-4 mb-2">
                  <View className="flex-row items-center mb-2">
                    <View
                      className="w-3 h-3 rounded-full mr-2"
                      style={{ backgroundColor: classColorMap[lesson.classId] ?? "#d4a574" }}
                    />
                    <Text className="text-brand-beige font-bold flex-1">
                      {lesson.title}
                    </Text>
                    <Text className="text-[#888] text-xs">
                      {STATUS_LABEL[lesson.status]}
                    </Text>
                  </View>
                  <Text className="text-[#aaa] text-sm mb-1">
                    {formatTime(lesson.startTime)} – {formatTime(lesson.endTime)}
                  </Text>
                  {lesson.class && (
                    <Text className="text-[#888] text-xs mb-1">{lesson.class.name}</Text>
                  )}
                  {lesson.location && (
                    <Text className="text-[#666] text-xs">📍 {lesson.location}</Text>
                  )}

                  {lesson.status === "scheduled" && (
                    <View className="flex-row gap-2 mt-3">
                      <Pressable
                        className="flex-1 border border-brand-accent rounded-lg py-2 items-center"
                        onPress={() => openEdit(lesson)}
                      >
                        <Text className="text-brand-accent text-sm">수정</Text>
                      </Pressable>
                      <Pressable
                        className="flex-1 bg-[#4ade80] rounded-lg py-2 items-center"
                        onPress={() => handleStatusChange(lesson, "complete")}
                      >
                        <Text className="text-brand-dark text-sm font-bold">완료</Text>
                      </Pressable>
                      <Pressable
                        className="flex-1 bg-[#555] rounded-lg py-2 items-center"
                        onPress={() => handleStatusChange(lesson, "cancel")}
                      >
                        <Text className="text-[#ccc] text-sm">취소</Text>
                      </Pressable>
                    </View>
                  )}
                </View>
              ))
            )}
          </View>
        }
      />

      {/* Add/Edit Lesson Modal */}
      <Modal visible={showModal} animationType="slide" transparent>
        <View className="flex-1 justify-end bg-black/50">
          <View className="bg-[#2a2a2a] rounded-t-3xl px-5 pt-5 pb-10">
            <View className="flex-row justify-between items-center mb-5">
              <Text className="text-brand-beige text-lg font-bold">
                {editingLesson ? "수업 수정" : "수업 추가"}
              </Text>
              <Pressable onPress={() => { setShowModal(false); resetForm(); }}>
                <Text className="text-[#888] text-lg">✕</Text>
              </Pressable>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              {/* Class Selector */}
              <Text className="text-[#aaa] text-sm mb-1">반 선택</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-4">
                <View className="flex-row gap-2">
                  {classes.map((c) => (
                    <Pressable
                      key={c.id}
                      className={`px-4 py-2 rounded-lg ${
                        form.classId === c.id ? "bg-brand-accent" : "bg-[#3a3a3a]"
                      }`}
                      onPress={() => setForm((f) => ({ ...f, classId: c.id }))}
                    >
                      <Text
                        className={
                          form.classId === c.id
                            ? "text-brand-dark font-bold"
                            : "text-brand-beige"
                        }
                      >
                        {c.name}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </ScrollView>

              {/* Title */}
              <Text className="text-[#aaa] text-sm mb-1">제목</Text>
              <TextInput
                className="bg-[#3a3a3a] text-brand-beige rounded-lg px-4 py-3 mb-4"
                placeholder="수업 제목"
                placeholderTextColor="#666"
                value={form.title}
                onChangeText={(v) => setForm((f) => ({ ...f, title: v }))}
              />

              {/* Time */}
              <View className="flex-row gap-3 mb-4">
                <View className="flex-1">
                  <Text className="text-[#aaa] text-sm mb-1">시작 시간</Text>
                  <TextInput
                    className="bg-[#3a3a3a] text-brand-beige rounded-lg px-4 py-3"
                    placeholder="09:00"
                    placeholderTextColor="#666"
                    value={form.startTime}
                    onChangeText={(v) => setForm((f) => ({ ...f, startTime: v }))}
                  />
                </View>
                <View className="flex-1">
                  <Text className="text-[#aaa] text-sm mb-1">종료 시간</Text>
                  <TextInput
                    className="bg-[#3a3a3a] text-brand-beige rounded-lg px-4 py-3"
                    placeholder="10:00"
                    placeholderTextColor="#666"
                    value={form.endTime}
                    onChangeText={(v) => setForm((f) => ({ ...f, endTime: v }))}
                  />
                </View>
              </View>

              {/* Recurrence */}
              <Text className="text-[#aaa] text-sm mb-1">반복</Text>
              <View className="flex-row gap-2 mb-4">
                {([["none", "없음"], ["weekly", "매주"], ["biweekly", "격주"]] as const).map(
                  ([val, label]) => (
                    <Pressable
                      key={val}
                      className={`px-4 py-2 rounded-lg ${
                        form.recurrence === val ? "bg-brand-accent" : "bg-[#3a3a3a]"
                      }`}
                      onPress={() => setForm((f) => ({ ...f, recurrence: val }))}
                    >
                      <Text
                        className={
                          form.recurrence === val
                            ? "text-brand-dark font-bold"
                            : "text-brand-beige"
                        }
                      >
                        {label}
                      </Text>
                    </Pressable>
                  )
                )}
              </View>

              {/* Location */}
              <Text className="text-[#aaa] text-sm mb-1">장소</Text>
              <TextInput
                className="bg-[#3a3a3a] text-brand-beige rounded-lg px-4 py-3 mb-4"
                placeholder="(선택) 장소"
                placeholderTextColor="#666"
                value={form.location}
                onChangeText={(v) => setForm((f) => ({ ...f, location: v }))}
              />

              {/* Memo */}
              <Text className="text-[#aaa] text-sm mb-1">메모</Text>
              <TextInput
                className="bg-[#3a3a3a] text-brand-beige rounded-lg px-4 py-3 mb-6"
                placeholder="(선택) 메모"
                placeholderTextColor="#666"
                multiline
                numberOfLines={3}
                value={form.memo}
                onChangeText={(v) => setForm((f) => ({ ...f, memo: v }))}
              />

              {/* Save */}
              <Pressable
                className={`rounded-xl py-4 items-center ${
                  isSaving ? "bg-[#555]" : "bg-brand-accent"
                }`}
                onPress={handleSave}
                disabled={isSaving}
              >
                {isSaving ? (
                  <ActivityIndicator color="#1a1a1a" />
                ) : (
                  <Text className="text-brand-dark font-bold text-base">
                    {editingLesson ? "수정" : "저장"}
                  </Text>
                )}
              </Pressable>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
