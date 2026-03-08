import { useState, useMemo, useCallback } from "react";
import { View, Text, FlatList, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Calendar, type DateData } from "react-native-calendars";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

interface Lesson {
  id: string;
  title: string;
  className: string;
  classColor?: string;
  startTime: string;
  endTime: string;
  status: string;
}

const CLASS_COLORS = [
  "#d4a574",
  "#74b4d4",
  "#74d4a5",
  "#d474b4",
  "#d4d474",
  "#a574d4",
];

function formatTime(iso: string) {
  const d = new Date(iso);
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}

function getMonthRange(dateStr: string) {
  const d = new Date(dateStr + "T00:00:00");
  const start = new Date(d.getFullYear(), d.getMonth(), 1);
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59);
  return { start: start.toISOString(), end: end.toISOString() };
}

function toDateKey(iso: string) {
  return iso.slice(0, 10);
}

export default function StudentCalendar() {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [selectedDate, setSelectedDate] = useState(today);
  const [currentMonth, setCurrentMonth] = useState(today);

  const { start, end } = useMemo(
    () => getMonthRange(currentMonth),
    [currentMonth],
  );

  const { data: lessons = [], isLoading } = useQuery({
    queryKey: ["lessons", "calendar", currentMonth],
    queryFn: () =>
      api.get<Lesson[]>(`/lessons/calendar?start=${start}&end=${end}`),
  });

  // Build color map for classes
  const classColorMap = useMemo(() => {
    const map = new Map<string, string>();
    let idx = 0;
    for (const l of lessons) {
      if (!map.has(l.className)) {
        map.set(l.className, l.classColor ?? CLASS_COLORS[idx % CLASS_COLORS.length]);
        idx++;
      }
    }
    return map;
  }, [lessons]);

  // Build markedDates
  const markedDates = useMemo(() => {
    const marks: Record<
      string,
      { dots: { key: string; color: string }[]; selected?: boolean; selectedColor?: string }
    > = {};

    for (const l of lessons) {
      const dateKey = toDateKey(l.startTime);
      if (!marks[dateKey]) {
        marks[dateKey] = { dots: [] };
      }
      const color = classColorMap.get(l.className) ?? "#d4a574";
      if (!marks[dateKey].dots.some((d) => d.color === color)) {
        marks[dateKey].dots.push({ key: l.className, color });
      }
    }

    // Mark selected date
    if (!marks[selectedDate]) {
      marks[selectedDate] = { dots: [] };
    }
    marks[selectedDate].selected = true;
    marks[selectedDate].selectedColor = "#d4a574";

    return marks;
  }, [lessons, selectedDate, classColorMap]);

  // Filter lessons for selected date
  const dayLessons = useMemo(
    () => lessons.filter((l) => toDateKey(l.startTime) === selectedDate),
    [lessons, selectedDate],
  );

  const onDayPress = useCallback((day: DateData) => {
    setSelectedDate(day.dateString);
  }, []);

  const onMonthChange = useCallback((month: DateData) => {
    setCurrentMonth(month.dateString);
  }, []);

  const classNames = useMemo(
    () => Array.from(classColorMap.entries()),
    [classColorMap],
  );

  const renderLessonItem = useCallback(
    ({ item }: { item: Lesson }) => {
      const color = classColorMap.get(item.className) ?? "#d4a574";
      return (
        <View className="bg-[#2a2a2a] rounded-xl p-3 mb-2 flex-row">
          <View
            style={{ backgroundColor: color }}
            className="w-1 rounded-full mr-3"
          />
          <View className="flex-1">
            <View className="flex-row items-center justify-between">
              <Text className="text-brand-beige font-medium flex-1 mr-2">
                {item.title}
              </Text>
              <View
                className={`rounded-full px-2 py-0.5 ${
                  item.status === "completed"
                    ? "bg-green-900/50"
                    : "bg-[#333]"
                }`}
              >
                <Text
                  className={`text-xs ${
                    item.status === "completed"
                      ? "text-green-400"
                      : "text-gray-400"
                  }`}
                >
                  {item.status === "completed" ? "완료" : "예정"}
                </Text>
              </View>
            </View>
            <Text className="text-gray-400 text-xs mt-1">
              {formatTime(item.startTime)} - {formatTime(item.endTime)}
            </Text>
            <Text className="text-gray-500 text-xs mt-0.5">
              {item.className}
            </Text>
          </View>
        </View>
      );
    },
    [classColorMap],
  );

  return (
    <SafeAreaView className="flex-1 bg-brand-dark" edges={["left", "right"]}>
      <Calendar
        current={currentMonth}
        onDayPress={onDayPress}
        onMonthChange={onMonthChange}
        markingType="multi-dot"
        markedDates={markedDates}
        theme={{
          calendarBackground: "#1a1a1a",
          textSectionTitleColor: "#888",
          selectedDayBackgroundColor: "#d4a574",
          selectedDayTextColor: "#1a1a1a",
          todayTextColor: "#d4a574",
          dayTextColor: "#f5f0e8",
          textDisabledColor: "#555",
          monthTextColor: "#f5f0e8",
          arrowColor: "#d4a574",
          textMonthFontWeight: "bold",
        }}
      />

      {/* Color legend */}
      {classNames.length > 0 && (
        <View className="px-4 py-2 flex-row flex-wrap gap-3">
          {classNames.map(([name, color]) => (
            <View key={name} className="flex-row items-center">
              <View
                style={{ backgroundColor: color }}
                className="w-2.5 h-2.5 rounded-full mr-1.5"
              />
              <Text className="text-gray-400 text-xs">{name}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Day lessons */}
      <View className="flex-1 px-4 pt-2">
        <Text className="text-brand-beige font-semibold mb-2">
          {selectedDate} 수업
        </Text>
        {isLoading ? (
          <ActivityIndicator color="#d4a574" className="mt-4" />
        ) : dayLessons.length === 0 ? (
          <View className="bg-[#2a2a2a] rounded-xl p-4 mt-1">
            <Text className="text-gray-400 text-center">
              이 날에 수업이 없습니다
            </Text>
          </View>
        ) : (
          <FlatList
            data={dayLessons}
            renderItem={renderLessonItem}
            keyExtractor={(item) => item.id}
          />
        )}
      </View>
    </SafeAreaView>
  );
}
