import { useState, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { ChevronLeft, ChevronRight } from "lucide-react-native";

interface Child {
  id: string;
  student: { id: string; name: string };
}

interface WeaknessEntry {
  unit: string;
  accuracy: number;
  correct: number;
  total: number;
  level: "red" | "yellow" | "green";
}

interface ScoreTrendEntry {
  date: string;
  score: number | null;
  maxScore: number;
  label: string;
}

interface WeeklyReport {
  id: string;
  weekStart: string;
  weekEnd: string;
  assignmentCompletionRate: number;
  avgScore: number | null;
  problemsSolved: number;
  correctRate: number | null;
  lessonsAttended: number;
  lessonsTotal: number;
  weaknessHeatmap: WeaknessEntry[];
  scoreTrend: ScoreTrendEntry[];
}

function getMonday(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? 6 : day - 1;
  d.setDate(d.getDate() - diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatWeek(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function formatWeekRange(start: string, end: string): string {
  const s = new Date(start);
  const e = new Date(end);
  return `${s.getMonth() + 1}/${s.getDate()} - ${e.getMonth() + 1}/${e.getDate()}`;
}

const LEVEL_COLORS = {
  red: { bg: "#7f1d1d", text: "#fca5a5" },
  yellow: { bg: "#78350f", text: "#fcd34d" },
  green: { bg: "#14532d", text: "#86efac" },
} as const;

export default function ParentDashboard() {
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedChildIdx, setSelectedChildIdx] = useState(0);

  const weekStart = getMonday(new Date());
  weekStart.setDate(weekStart.getDate() + weekOffset * 7);
  const weekStartStr = formatDateKey(weekStart);

  const childrenQuery = useQuery<Child[]>({
    queryKey: ["parent-children"],
    queryFn: () => api.get("/parent-links/children"),
  });

  const children = childrenQuery.data ?? [];
  const selectedChild = children[selectedChildIdx];

  const reportQuery = useQuery<WeeklyReport>({
    queryKey: ["parent-weekly-report", selectedChild?.student.id, weekStartStr],
    queryFn: () =>
      api.get(
        `/analytics/parent/weekly-report/${selectedChild!.student.id}?weekStart=${weekStartStr}`,
      ),
    enabled: !!selectedChild,
  });

  const report = reportQuery.data;

  const onRefresh = useCallback(() => {
    childrenQuery.refetch();
    reportQuery.refetch();
  }, [childrenQuery, reportQuery]);

  if (childrenQuery.isLoading) {
    return (
      <SafeAreaView className="flex-1 bg-brand-dark items-center justify-center">
        <ActivityIndicator size="large" color="#d4a574" />
      </SafeAreaView>
    );
  }

  if (children.length === 0) {
    return (
      <SafeAreaView className="flex-1 bg-brand-dark items-center justify-center px-6">
        <Text className="text-gray-400 text-center">
          연결된 자녀가 없습니다.{"\n"}홈 탭에서 초대 코드로 자녀를 등록해주세요.
        </Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-brand-dark" edges={["bottom"]}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 100 }}
        refreshControl={
          <RefreshControl
            refreshing={reportQuery.isRefetching}
            onRefresh={onRefresh}
            tintColor="#d4a574"
          />
        }
      >
        {/* Child selector */}
        {children.length > 1 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 16, gap: 8 }}
          >
            {children.map((child, idx) => (
              <TouchableOpacity
                key={child.id}
                className={`px-4 py-2 rounded-full ${
                  idx === selectedChildIdx
                    ? "bg-brand-accent"
                    : "bg-[#2a2a2a] border border-[#333]/40"
                }`}
                onPress={() => setSelectedChildIdx(idx)}
              >
                <Text
                  className={`font-bold ${
                    idx === selectedChildIdx ? "text-brand-dark" : "text-brand-beige"
                  }`}
                >
                  {child.student.name}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}

        {/* Week selector */}
        <View className="flex-row items-center justify-between px-4 pt-5 pb-2">
          <TouchableOpacity
            onPress={() => setWeekOffset((o) => o - 1)}
            className="p-2"
          >
            <ChevronLeft color="#d4a574" size={24} />
          </TouchableOpacity>
          <Text className="text-brand-beige text-base font-bold">
            {report
              ? formatWeekRange(report.weekStart, report.weekEnd)
              : weekStartStr}
          </Text>
          <TouchableOpacity
            onPress={() => setWeekOffset((o) => Math.min(o + 1, 0))}
            className="p-2"
            disabled={weekOffset >= 0}
          >
            <ChevronRight color={weekOffset >= 0 ? "#444" : "#d4a574"} size={24} />
          </TouchableOpacity>
        </View>

        {reportQuery.isLoading ? (
          <View className="items-center py-12">
            <ActivityIndicator size="large" color="#d4a574" />
          </View>
        ) : !report ? (
          <View className="items-center py-12">
            <Text className="text-gray-400">리포트 데이터가 없습니다.</Text>
          </View>
        ) : (
          <>
            {/* Summary cards */}
            <View className="flex-row flex-wrap px-4 gap-3 mt-2">
              <SummaryCard
                label="과제 완료율"
                value={`${report.assignmentCompletionRate}%`}
              />
              <SummaryCard
                label="평균 점수"
                value={report.avgScore !== null ? `${report.avgScore}점` : "-"}
              />
              <SummaryCard
                label="풀이 문제"
                value={`${report.problemsSolved}개`}
              />
              <SummaryCard
                label="수업 출석"
                value={`${report.lessonsAttended}/${report.lessonsTotal}`}
              />
            </View>

            {/* Correct rate */}
            {report.correctRate !== null && (
              <View className="mx-4 mt-4 bg-[#2a2a2a] rounded-2xl p-5 border border-[#333]/40">
                <Text className="text-gray-400 text-sm mb-2">정답률</Text>
                <View className="flex-row items-end gap-2">
                  <Text className="text-brand-beige text-3xl font-bold">
                    {report.correctRate}%
                  </Text>
                </View>
                <View className="mt-3 h-2 bg-[#333] rounded-full overflow-hidden">
                  <View
                    className="h-full bg-brand-accent rounded-full"
                    style={{ width: `${report.correctRate}%` }}
                  />
                </View>
              </View>
            )}

            {/* Weakness heatmap */}
            {report.weaknessHeatmap.length > 0 && (
              <View className="mx-4 mt-4 bg-[#2a2a2a] rounded-2xl p-5 border border-[#333]/40">
                <Text className="text-brand-beige text-lg font-bold mb-3">
                  단원별 정답률
                </Text>
                <View className="flex-row flex-wrap gap-2">
                  {report.weaknessHeatmap.map((entry) => {
                    const colors = LEVEL_COLORS[entry.level];
                    return (
                      <View
                        key={entry.unit}
                        className="rounded-xl px-3 py-2 min-w-[80px]"
                        style={{ backgroundColor: colors.bg }}
                      >
                        <Text
                          className="text-xs font-medium"
                          style={{ color: colors.text }}
                          numberOfLines={1}
                        >
                          {entry.unit}
                        </Text>
                        <Text
                          className="text-lg font-bold mt-0.5"
                          style={{ color: colors.text }}
                        >
                          {entry.accuracy}%
                        </Text>
                        <Text
                          className="text-[10px]"
                          style={{ color: colors.text, opacity: 0.7 }}
                        >
                          {entry.correct}/{entry.total}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              </View>
            )}

            {/* Score trend */}
            {report.scoreTrend.length > 0 && (
              <View className="mx-4 mt-4 bg-[#2a2a2a] rounded-2xl p-5 border border-[#333]/40">
                <Text className="text-brand-beige text-lg font-bold mb-3">
                  점수 추이
                </Text>
                <View className="flex-row items-end gap-1.5" style={{ height: 120 }}>
                  {report.scoreTrend.map((entry, idx) => {
                    const pct =
                      entry.score !== null
                        ? (entry.score / entry.maxScore) * 100
                        : 0;
                    return (
                      <View
                        key={`trend-${idx}`}
                        className="flex-1 items-center"
                      >
                        <Text className="text-[10px] text-gray-400 mb-1">
                          {entry.score !== null ? Math.round(entry.score) : "-"}
                        </Text>
                        <View
                          className="w-full rounded-t-md bg-brand-accent"
                          style={{
                            height: `${Math.max(pct, 4)}%`,
                            minHeight: 4,
                          }}
                        />
                        <Text className="text-[9px] text-gray-500 mt-1">
                          {formatWeek(entry.date)}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <View className="bg-[#2a2a2a] rounded-2xl p-4 border border-[#333]/40 flex-1 min-w-[45%]">
      <Text className="text-gray-400 text-xs">{label}</Text>
      <Text className="text-brand-beige text-xl font-bold mt-1">{value}</Text>
    </View>
  );
}
