import { useCallback } from "react";
import {
  View,
  Text,
  FlatList,
  RefreshControl,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";

interface ChapterStat {
  name: string;
  accuracy: number;
}

interface ScoreTrend {
  date: string;
  score: number;
}

interface CommonError {
  type: string;
  count: number;
}

interface StudentAnalytics {
  overallAccuracy: number;
  totalProblems: number;
  chapterStats: ChapterStat[];
  scoreTrend: ScoreTrend[];
  weakChapters: ChapterStat[];
  commonErrors: CommonError[];
}

function AccuracyCircle({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color =
    pct >= 80 ? "text-green-400" : pct >= 60 ? "text-yellow-400" : "text-red-400";

  return (
    <View className="items-center justify-center bg-[#2a2a2a] rounded-2xl p-8 mx-4 border border-[#333]/40">
      <Text className="text-gray-400 text-sm mb-2">전체 정답률</Text>
      <View className="w-28 h-28 rounded-full border-4 border-[#3a3a3a] items-center justify-center">
        <Text className={`text-3xl font-bold ${color}`}>{pct}%</Text>
      </View>
    </View>
  );
}

function BarChart({
  data,
  title,
}: {
  data: ChapterStat[];
  title: string;
}) {
  return (
    <View className="mx-4 mt-4">
      <Text className="text-brand-beige font-semibold text-base mb-2">
        {title}
      </Text>
      <View className="bg-[#2a2a2a] rounded-2xl p-4 border border-[#333]/40">
        {data.length === 0 ? (
          <Text className="text-gray-400 text-center py-2">데이터 없음</Text>
        ) : (
          data.map((item) => {
            const pct = Math.round(item.accuracy * 100);
            const barColor =
              pct >= 80
                ? "bg-green-500"
                : pct >= 60
                  ? "bg-yellow-500"
                  : "bg-red-500";
            return (
              <View key={item.name} className="mb-3 last:mb-0">
                <View className="flex-row items-center justify-between mb-1">
                  <Text className="text-brand-beige text-sm flex-1 mr-2">
                    {item.name}
                  </Text>
                  <Text className="text-gray-400 text-xs">{pct}%</Text>
                </View>
                <View className="h-2.5 bg-[#333] rounded-full overflow-hidden">
                  <View
                    className={`h-full rounded-full ${barColor}`}
                    style={{ width: `${pct}%` }}
                  />
                </View>
              </View>
            );
          })
        )}
      </View>
    </View>
  );
}

function TrendChart({ data }: { data: ScoreTrend[] }) {
  if (data.length === 0) return null;

  const maxScore = Math.max(...data.map((d) => d.score), 100);

  return (
    <View className="mx-4 mt-4">
      <Text className="text-brand-beige font-semibold text-base mb-2">
        성적 추이
      </Text>
      <View className="bg-[#2a2a2a] rounded-xl p-3">
        <View className="flex-row items-end h-32 gap-1">
          {data.slice(-10).map((item, i) => {
            const height = (item.score / maxScore) * 100;
            return (
              <View key={i} className="flex-1 items-center justify-end h-full">
                <View
                  className="bg-brand-accent rounded-t w-full min-w-[4px]"
                  style={{ height: `${height}%` }}
                />
                <Text className="text-gray-500 text-[8px] mt-1">
                  {item.date.slice(5)}
                </Text>
              </View>
            );
          })}
        </View>
      </View>
    </View>
  );
}

export default function StudentReport() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data, isLoading, isRefetching } = useQuery({
    queryKey: ["analytics", "student", user?.id],
    queryFn: () =>
      api.get<StudentAnalytics>(`/analytics/student/${user!.id}`),
    enabled: !!user?.id,
  });

  const onRefresh = useCallback(() => {
    queryClient.invalidateQueries({
      queryKey: ["analytics", "student", user?.id],
    });
  }, [queryClient, user?.id]);

  if (isLoading || !data) {
    return (
      <SafeAreaView className="flex-1 bg-brand-dark items-center justify-center" edges={["left", "right"]}>
        <ActivityIndicator color="#d4a574" size="large" />
      </SafeAreaView>
    );
  }

  const sections = [
    { key: "accuracy" },
    { key: "chapters" },
    { key: "trend" },
    { key: "weak" },
    { key: "errors" },
  ];

  const renderItem = ({ item }: { item: (typeof sections)[number] }) => {
    switch (item.key) {
      case "accuracy":
        return <AccuracyCircle value={data.overallAccuracy} />;

      case "chapters":
        return (
          <BarChart data={data.chapterStats} title="단원별 정답률" />
        );

      case "trend":
        return <TrendChart data={data.scoreTrend} />;

      case "weak":
        return (
          <View className="mx-4 mt-4">
            <Text className="text-brand-beige font-semibold text-base mb-2">
              취약 단원
            </Text>
            {data.weakChapters.length === 0 ? (
              <View className="bg-[#2a2a2a] rounded-xl p-4">
                <Text className="text-gray-400 text-center">
                  취약 단원이 없습니다
                </Text>
              </View>
            ) : (
              data.weakChapters.map((ch) => (
                <View
                  key={ch.name}
                  className="bg-red-900/20 border border-red-900/40 rounded-2xl p-4 mb-3"
                >
                  <View className="flex-row items-center justify-between">
                    <Text className="text-brand-beige font-medium">
                      {ch.name}
                    </Text>
                    <Text className="text-red-400 font-semibold">
                      {Math.round(ch.accuracy * 100)}%
                    </Text>
                  </View>
                </View>
              ))
            )}
          </View>
        );

      case "errors":
        return (
          <View className="mx-4 mt-4 pb-6">
            <Text className="text-brand-beige font-semibold text-base mb-2">
              자주 하는 실수
            </Text>
            {data.commonErrors.length === 0 ? (
              <View className="bg-[#2a2a2a] rounded-xl p-4">
                <Text className="text-gray-400 text-center">
                  기록된 실수 패턴이 없습니다
                </Text>
              </View>
            ) : (
              data.commonErrors.map((err, i) => (
                <View
                  key={i}
                  className="bg-[#2a2a2a] rounded-2xl p-4 mb-3 border border-[#333]/40 flex-row items-center"
                >
                  <View className="bg-yellow-900/50 rounded-full w-9 h-9 items-center justify-center mr-3">
                    <Text className="text-yellow-400 font-bold text-sm">
                      {err.count}
                    </Text>
                  </View>
                  <Text className="text-brand-beige flex-1">{err.type}</Text>
                </View>
              ))
            )}
          </View>
        );

      default:
        return null;
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-brand-dark" edges={["left", "right"]}>
      <FlatList
        data={sections}
        renderItem={renderItem}
        keyExtractor={(item) => item.key}
        contentContainerStyle={{ paddingTop: 16 }}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={onRefresh}
            tintColor="#d4a574"
          />
        }
      />
    </SafeAreaView>
  );
}
