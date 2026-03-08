import { useState, useMemo } from "react";
import { View, Text, FlatList, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Calendar, type DateData } from "react-native-calendars";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

interface Lesson {
  id: string;
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  status: string;
  childId: string;
  childName: string;
}

const CHILD_COLORS = ["#5B8DEF", "#4CAF50", "#FF9800", "#E91E63", "#9C27B0"];

function getMonthRange(dateStr: string) {
  const d = new Date(dateStr);
  const start = new Date(d.getFullYear(), d.getMonth(), 1)
    .toISOString()
    .split("T")[0];
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0)
    .toISOString()
    .split("T")[0];
  return { start, end };
}

export default function ParentCalendar() {
  const today = new Date().toISOString().split("T")[0];
  const [selectedDate, setSelectedDate] = useState(today);
  const [currentMonth, setCurrentMonth] = useState(today);

  const { start, end } = getMonthRange(currentMonth);

  const { data: lessons, isLoading } = useQuery<Lesson[]>({
    queryKey: ["parent-lessons", start, end],
    queryFn: () => api.get(`/lessons/calendar?start=${start}&end=${end}`),
  });

  // Build child → color map
  const childColorMap = useMemo(() => {
    if (!lessons) return new Map<string, string>();
    const uniqueIds = [...new Set(lessons.map((l) => l.childId))];
    const map = new Map<string, string>();
    uniqueIds.forEach((id, i) => map.set(id, CHILD_COLORS[i % CHILD_COLORS.length]));
    return map;
  }, [lessons]);

  // Calendar marked dates with dots
  const markedDates = useMemo(() => {
    const marks: Record<string, { dots: { color: string }[]; selected?: boolean; selectedColor?: string }> = {};

    lessons?.forEach((lesson) => {
      if (!marks[lesson.date]) {
        marks[lesson.date] = { dots: [] };
      }
      const color = childColorMap.get(lesson.childId) || CHILD_COLORS[0];
      const alreadyHasColor = marks[lesson.date].dots.some((d) => d.color === color);
      if (!alreadyHasColor) {
        marks[lesson.date].dots.push({ color });
      }
    });

    // Mark selected date
    if (marks[selectedDate]) {
      marks[selectedDate].selected = true;
      marks[selectedDate].selectedColor = "#d4a574";
    } else {
      marks[selectedDate] = {
        dots: [],
        selected: true,
        selectedColor: "#d4a574",
      };
    }

    return marks;
  }, [lessons, selectedDate, childColorMap]);

  const selectedLessons = useMemo(
    () => lessons?.filter((l) => l.date === selectedDate) ?? [],
    [lessons, selectedDate],
  );

  // Legend entries
  const legendEntries = useMemo(() => {
    if (!lessons) return [];
    const seen = new Map<string, { name: string; color: string }>();
    lessons.forEach((l) => {
      if (!seen.has(l.childId)) {
        seen.set(l.childId, {
          name: l.childName,
          color: childColorMap.get(l.childId) || CHILD_COLORS[0],
        });
      }
    });
    return [...seen.values()];
  }, [lessons, childColorMap]);

  return (
    <SafeAreaView className="flex-1 bg-brand-dark" edges={["bottom"]}>
      <Calendar
        current={currentMonth}
        onDayPress={(day: DateData) => setSelectedDate(day.dateString)}
        onMonthChange={(month: DateData) =>
          setCurrentMonth(month.dateString)
        }
        markingType="multi-dot"
        markedDates={markedDates}
        theme={{
          backgroundColor: "#1a1a1a",
          calendarBackground: "#1a1a1a",
          textSectionTitleColor: "#888",
          dayTextColor: "#f5f0e8",
          todayTextColor: "#d4a574",
          selectedDayTextColor: "#1a1a1a",
          monthTextColor: "#f5f0e8",
          arrowColor: "#d4a574",
          textDisabledColor: "#444",
          textMonthFontSize: 18,
          textDayFontSize: 14,
        }}
      />

      {/* Legend */}
      {legendEntries.length > 0 && (
        <View className="flex-row flex-wrap px-4 py-3 gap-4">
          {legendEntries.map((entry) => (
            <View key={entry.name} className="flex-row items-center gap-1">
              <View
                style={{ backgroundColor: entry.color, width: 12, height: 12, borderRadius: 6 }}
              />
              <Text className="text-gray-400 text-xs">{entry.name}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Lessons for selected date */}
      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#d4a574" />
        </View>
      ) : (
        <FlatList
          data={selectedLessons}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 20 }}
          ListEmptyComponent={
            <View className="items-center mt-10 px-4">
              <Text className="text-gray-500">이 날짜에 수업이 없습니다</Text>
            </View>
          }
          renderItem={({ item }) => {
            const dotColor = childColorMap.get(item.childId) || CHILD_COLORS[0];
            return (
              <View className="bg-[#2a2a2a] rounded-2xl p-4 mb-3">
                <View className="flex-row items-center gap-2 mb-1">
                  <View
                    style={{ backgroundColor: dotColor, width: 10, height: 10, borderRadius: 5 }}
                  />
                  <Text className="text-brand-accent text-xs font-bold">
                    {item.childName}
                  </Text>
                </View>
                <Text className="text-brand-beige text-base font-bold">
                  {item.title}
                </Text>
                <Text className="text-gray-400 text-sm mt-1">
                  {item.startTime} – {item.endTime}
                </Text>
                <View className="mt-2 self-start bg-[#333] rounded-full px-3.5 py-1.5">
                  <Text className="text-gray-400 text-xs">{item.status}</Text>
                </View>
              </View>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}
