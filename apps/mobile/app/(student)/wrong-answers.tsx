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
  resolved: number;
  unresolved: number;
  byErrorType: Record<string, number>;
}

interface WrongAnswer {
  id: string;
  problemContent: string;
  solution: string;
  errorType: string;
  studentAnswer: string | null;
  createdAt: string;
  resolved: boolean;
  retryCount: number;
}

interface WrongAnswersResponse {
  items: WrongAnswer[];
  total: number;
}

const ERROR_TYPE_LABELS: Record<string, string> = {
  calculation_error: "계산 실수",
  concept_gap: "개념 부족",
  pattern_gap: "유형 미숙",
  careless_mistake: "부주의",
};

const ERROR_TYPE_COLORS: Record<string, { bg: string; text: string }> = {
  calculation_error: { bg: "bg-red-900/40", text: "text-red-400" },
  concept_gap: { bg: "bg-purple-900/40", text: "text-purple-400" },
  pattern_gap: { bg: "bg-blue-900/40", text: "text-blue-400" },
  careless_mistake: { bg: "bg-yellow-900/40", text: "text-yellow-400" },
};

function errorLabel(type: string) {
  return ERROR_TYPE_LABELS[type] ?? type;
}

function errorColor(type: string) {
  return ERROR_TYPE_COLORS[type] ?? ERROR_TYPE_COLORS.careless_mistake;
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
      return api.get<WrongAnswersResponse>(`/wrong-answers${params}`);
    },
  });

  const retryMutation = useMutation({
    mutationFn: ({ id, isCorrect }: { id: string; isCorrect: boolean }) =>
      api.post(`/wrong-answers/${id}/retry`, { isCorrect }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["wrong-answers"] });
      queryClient.invalidateQueries({ queryKey: ["wrong-answers", "stats"] });
    },
  });

  const onRefresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["wrong-answers"] });
  }, [queryClient]);

  const isLoading = statsQuery.isLoading || listQuery.isLoading;
  const isRefreshing = statsQuery.isRefetching || listQuery.isRefetching;
  const stats = statsQuery.data;
  const items = listQuery.data?.items ?? [];

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
            <View className="flex-row items-center justify-between mt-1">
              <Text className="text-gray-500 text-xs">
                {new Date(item.createdAt).toLocaleDateString("ko-KR")}
              </Text>
              <Text
                className={`text-xs ${item.resolved ? "text-green-400" : "text-orange-400"}`}
              >
                {item.resolved ? "해결됨" : "미해결"}
              </Text>
            </View>
          </View>

          {isExpanded && (
            <View className="border-t border-[#333] px-4 py-3">
              <Text className="text-gray-400 text-xs mb-1">내 답안</Text>
              <Text className="text-red-400 text-sm mb-3">
                {item.studentAnswer ?? "기록 없음"}
              </Text>

              <Text className="text-gray-400 text-xs mb-1">풀이</Text>
              <Text className="text-brand-beige text-sm mb-4">
                {item.solution || "등록된 풀이가 없습니다"}
              </Text>

              <View className="flex-row gap-2">
                <Pressable
                  className="flex-1 bg-green-900/20 rounded-xl py-3 items-center border border-green-900/30"
                  onPress={() =>
                    retryMutation.mutate({ id: item.id, isCorrect: true })
                  }
                  disabled={retryMutation.isPending}
                >
                  <Text className="text-green-400 font-semibold text-sm">
                    맞았어요
                  </Text>
                </Pressable>
                <Pressable
                  className="flex-1 bg-brand-accent/20 rounded-xl py-3 items-center"
                  onPress={() =>
                    retryMutation.mutate({ id: item.id, isCorrect: false })
                  }
                  disabled={retryMutation.isPending}
                >
                  <Text className="text-brand-accent font-semibold text-sm">
                    아직 어려워요
                  </Text>
                </Pressable>
              </View>
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
                <View className="flex-1 bg-[#2a2a2a] rounded-2xl p-4 border border-[#333]/40 items-center">
                  <Text className="text-orange-400 text-2xl font-bold">
                    {stats.unresolved}
                  </Text>
                  <Text className="text-gray-400 text-xs mt-1">
                    미해결
                  </Text>
                </View>
                <View className="flex-1 bg-[#2a2a2a] rounded-2xl p-4 border border-[#333]/40 items-center">
                  <Text className="text-green-400 text-2xl font-bold">
                    {stats.resolved}
                  </Text>
                  <Text className="text-gray-400 text-xs mt-1">
                    해결
                  </Text>
                </View>
              </View>
            )}

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
