import { useCallback, useState } from "react";
import {
  View,
  Text,
  FlatList,
  Pressable,
  RefreshControl,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

interface WrongAnswerStats {
  total: number;
  byErrorType: Record<string, number>;
}

interface WrongAnswer {
  id: string;
  problemId: string;
  problemContent: string;
  solution: string;
  errorType: string;
  studentAnswer: string;
  createdAt: string;
  resolved: boolean;
}

const ERROR_TYPE_LABELS: Record<string, string> = {
  calculation: "계산 실수",
  concept: "개념 오류",
  reading: "문제 해석",
  formula: "공식 오류",
  sign: "부호 실수",
  other: "기타",
};

const ERROR_TYPE_COLORS: Record<string, { bg: string; text: string }> = {
  calculation: { bg: "bg-red-900/40", text: "text-red-400" },
  concept: { bg: "bg-purple-900/40", text: "text-purple-400" },
  reading: { bg: "bg-blue-900/40", text: "text-blue-400" },
  formula: { bg: "bg-yellow-900/40", text: "text-yellow-400" },
  sign: { bg: "bg-orange-900/40", text: "text-orange-400" },
  other: { bg: "bg-[#333]", text: "text-gray-400" },
};

function errorLabel(type: string) {
  return ERROR_TYPE_LABELS[type] ?? type;
}

function errorColor(type: string) {
  return ERROR_TYPE_COLORS[type] ?? ERROR_TYPE_COLORS.other;
}

export default function WrongAnswersScreen() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const statsQuery = useQuery({
    queryKey: ["wrong-answers", "stats"],
    queryFn: () => api.get<WrongAnswerStats>("/wrong-answers/stats"),
  });

  const listQuery = useQuery({
    queryKey: ["wrong-answers", filter],
    queryFn: () => {
      const params = filter ? `?errorType=${filter}` : "";
      return api.get<WrongAnswer[]>(`/wrong-answers${params}`);
    },
  });

  const retryMutation = useMutation({
    mutationFn: (id: string) => api.post(`/wrong-answers/${id}/retry`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["wrong-answers"] });
    },
  });

  const onRefresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["wrong-answers"] });
  }, [queryClient]);

  const isLoading = statsQuery.isLoading || listQuery.isLoading;
  const isRefreshing = statsQuery.isRefetching || listQuery.isRefetching;
  const stats = statsQuery.data;
  const items = listQuery.data ?? [];

  const errorTypes = stats
    ? Object.entries(stats.byErrorType).sort(([, a], [, b]) => b - a)
    : [];

  const renderItem = useCallback(
    ({ item }: { item: WrongAnswer }) => {
      const isExpanded = expandedId === item.id;
      const color = errorColor(item.errorType);

      return (
        <Pressable
          className="bg-[#2a2a2a] rounded-2xl mx-4 mb-3 border border-[#333]/40 overflow-hidden"
          onPress={() => setExpandedId(isExpanded ? null : item.id)}
        >
          <View className="p-4">
            <View className="flex-row items-center justify-between mb-1">
              <Text
                className="text-brand-beige font-medium flex-1 mr-2"
                numberOfLines={isExpanded ? undefined : 2}
              >
                {item.problemContent}
              </Text>
              <View className={`rounded-full px-2.5 py-1 ${color.bg}`}>
                <Text className={`text-xs ${color.text}`}>
                  {errorLabel(item.errorType)}
                </Text>
              </View>
            </View>
            <Text className="text-gray-500 text-xs mt-1">
              {new Date(item.createdAt).toLocaleDateString("ko-KR")}
            </Text>
          </View>

          {isExpanded && (
            <View className="border-t border-[#333] px-4 py-3">
              <Text className="text-gray-400 text-xs mb-1">내 답안</Text>
              <Text className="text-red-400 text-sm mb-3">
                {item.studentAnswer}
              </Text>

              <Text className="text-gray-400 text-xs mb-1">풀이</Text>
              <Text className="text-brand-beige text-sm mb-4">
                {item.solution}
              </Text>

              <Pressable
                className="bg-brand-accent/20 rounded-xl py-3 items-center"
                onPress={() => retryMutation.mutate(item.id)}
                disabled={retryMutation.isPending}
              >
                <Text className="text-brand-accent font-semibold text-sm">
                  {retryMutation.isPending ? "처리 중..." : "다시 풀기"}
                </Text>
              </Pressable>
            </View>
          )}
        </Pressable>
      );
    },
    [expandedId, retryMutation],
  );

  if (isLoading) {
    return (
      <SafeAreaView
        className="flex-1 bg-brand-dark items-center justify-center"
        edges={["left", "right"]}
      >
        <ActivityIndicator color="#d4a574" size="large" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-brand-dark" edges={["left", "right"]}>
      <FlatList
        data={items}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={onRefresh}
            tintColor="#d4a574"
          />
        }
        contentContainerStyle={{ paddingBottom: 16 }}
        ListHeaderComponent={
          <View>
            {/* Stats summary */}
            {stats && (
              <View className="flex-row mx-4 mt-4 mb-3 gap-3">
                <View className="flex-1 bg-[#2a2a2a] rounded-2xl p-4 border border-[#333]/40 items-center">
                  <Text className="text-brand-accent text-2xl font-bold">
                    {stats.total}
                  </Text>
                  <Text className="text-gray-400 text-xs mt-1">
                    전체 오답
                  </Text>
                </View>
                {errorTypes.slice(0, 2).map(([type, count]) => (
                  <View
                    key={type}
                    className="flex-1 bg-[#2a2a2a] rounded-2xl p-4 border border-[#333]/40 items-center"
                  >
                    <Text className="text-brand-beige text-2xl font-bold">
                      {count}
                    </Text>
                    <Text className="text-gray-400 text-xs mt-1">
                      {errorLabel(type)}
                    </Text>
                  </View>
                ))}
              </View>
            )}

            {/* Filter chips */}
            {errorTypes.length > 0 && (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}
                className="mb-4"
              >
                <Pressable
                  className={`rounded-full px-4 py-2 ${
                    filter === null
                      ? "bg-brand-accent"
                      : "bg-[#2a2a2a] border border-[#333]"
                  }`}
                  onPress={() => setFilter(null)}
                >
                  <Text
                    className={`text-sm font-medium ${
                      filter === null ? "text-brand-dark" : "text-gray-400"
                    }`}
                  >
                    전체
                  </Text>
                </Pressable>
                {errorTypes.map(([type, count]) => {
                  const active = filter === type;
                  return (
                    <Pressable
                      key={type}
                      className={`rounded-full px-4 py-2 ${
                        active
                          ? "bg-brand-accent"
                          : "bg-[#2a2a2a] border border-[#333]"
                      }`}
                      onPress={() => setFilter(active ? null : type)}
                    >
                      <Text
                        className={`text-sm font-medium ${
                          active ? "text-brand-dark" : "text-gray-400"
                        }`}
                      >
                        {errorLabel(type)} ({count})
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            )}
          </View>
        }
        ListEmptyComponent={
          <View className="items-center justify-center py-12 px-4">
            <Text className="text-gray-400 text-center">
              {filter ? "해당 유형의 오답이 없습니다" : "오답 기록이 없습니다"}
            </Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}
