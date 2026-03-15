import { useCallback, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  RefreshControl,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

interface ReviewStats {
  dueToday: number;
  completedToday: number;
}

interface ReviewProblem {
  reviewScheduleId: string;
  wrongAnswerId: string;
  errorType: string;
  interval: number;
  repetitions: number;
  lastReviewedAt: string | null;
  problem: {
    id: string;
    stemLatex: string;
    stemText: string;
    answerText: string | null;
    answerLatex: string | null;
    solutionText: string | null;
    choices: Array<{
      label: string;
      contentLatex: string;
      contentText: string;
      position: number;
    }>;
  } | null;
}

interface DailyReviewResponse {
  dueCount: number;
  problems: ReviewProblem[];
}

const QUALITY_BUTTONS = [
  { value: 0, label: "모름", bg: "bg-red-900/40", text: "text-red-400" },
  { value: 1, label: "어려움", bg: "bg-red-900/30", text: "text-red-300" },
  { value: 2, label: "헷갈림", bg: "bg-orange-900/30", text: "text-orange-400" },
  { value: 3, label: "힘듦", bg: "bg-yellow-900/30", text: "text-yellow-400" },
  { value: 4, label: "쉬움", bg: "bg-green-900/30", text: "text-green-400" },
  { value: 5, label: "완벽", bg: "bg-green-900/40", text: "text-green-300" },
] as const;

export default function DailyReviewScreen() {
  const queryClient = useQueryClient();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showSolution, setShowSolution] = useState(false);
  const [completedCount, setCompletedCount] = useState(0);

  const statsQuery = useQuery({
    queryKey: ["reviews", "stats"],
    queryFn: () => api.get<ReviewStats>("/reviews/stats"),
  });

  const reviewsQuery = useQuery({
    queryKey: ["reviews", "daily"],
    queryFn: () => api.get<DailyReviewResponse>("/reviews/daily"),
  });

  const gradeMutation = useMutation({
    mutationFn: ({ id, quality }: { id: string; quality: number }) =>
      api.post(`/reviews/${id}/grade`, { quality }),
    onSuccess: () => {
      setShowSolution(false);
      setCompletedCount((count) => count + 1);

      const items = reviewsQuery.data?.problems ?? [];
      if (currentIndex < items.length - 1) {
        setCurrentIndex((index) => index + 1);
      } else {
        queryClient.invalidateQueries({ queryKey: ["reviews"] });
        setCurrentIndex(0);
      }
    },
  });

  const onRefresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["reviews"] });
    setCurrentIndex(0);
    setShowSolution(false);
    setCompletedCount(0);
  }, [queryClient]);

  const isLoading = statsQuery.isLoading || reviewsQuery.isLoading;
  const isRefreshing = statsQuery.isRefetching || reviewsQuery.isRefetching;
  const stats = statsQuery.data;
  const items = reviewsQuery.data?.problems ?? [];
  const currentItem = items[currentIndex];
  const totalItems = items.length;

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

  if (totalItems === 0) {
    return (
      <SafeAreaView className="flex-1 bg-brand-dark" edges={["left", "right"]}>
        <ScrollView
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={onRefresh}
              tintColor="#d4a574"
            />
          }
          contentContainerStyle={{
            flex: 1,
            justifyContent: "center",
            alignItems: "center",
            padding: 24,
          }}
        >
          {stats && (
            <View className="flex-row gap-4 mb-8">
              <View className="bg-[#2a2a2a] rounded-2xl p-5 border border-[#333]/40 items-center flex-1">
                <Text className="text-brand-accent text-2xl font-bold">
                  {stats.dueToday}
                </Text>
                <Text className="text-gray-400 text-xs mt-1">오늘 예정</Text>
              </View>
              <View className="bg-[#2a2a2a] rounded-2xl p-5 border border-[#333]/40 items-center flex-1">
                <Text className="text-green-400 text-2xl font-bold">
                  {stats.completedToday}
                </Text>
                <Text className="text-gray-400 text-xs mt-1">완료</Text>
              </View>
            </View>
          )}
          <Text className="text-brand-beige text-lg font-semibold mb-2">
            복습 완료!
          </Text>
          <Text className="text-gray-400 text-center text-sm">
            오늘의 복습을 모두 마쳤습니다.{"\n"}내일 다시 확인해 주세요.
          </Text>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-brand-dark" edges={["left", "right"]}>
      <ScrollView
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={onRefresh}
            tintColor="#d4a574"
          />
        }
        contentContainerStyle={{ paddingBottom: 24 }}
      >
        {stats && (
          <View className="flex-row mx-4 mt-4 gap-3">
            <View className="flex-1 bg-[#2a2a2a] rounded-2xl p-4 border border-[#333]/40 items-center">
              <Text className="text-brand-accent text-xl font-bold">
                {stats.dueToday}
              </Text>
              <Text className="text-gray-400 text-xs mt-1">오늘 예정</Text>
            </View>
            <View className="flex-1 bg-[#2a2a2a] rounded-2xl p-4 border border-[#333]/40 items-center">
              <Text className="text-green-400 text-xl font-bold">
                {stats.completedToday + completedCount}
              </Text>
              <Text className="text-gray-400 text-xs mt-1">완료</Text>
            </View>
          </View>
        )}

        <View className="mx-4 mt-4 mb-2">
          <View className="flex-row items-center justify-between mb-1.5">
            <Text className="text-gray-400 text-xs">진행도</Text>
            <Text className="text-gray-400 text-xs">
              {currentIndex + 1}/{totalItems}
            </Text>
          </View>
          <View className="h-2 bg-[#333] rounded-full overflow-hidden">
            <View
              className="h-full bg-brand-accent rounded-full"
              style={{
                width: `${((currentIndex + 1) / totalItems) * 100}%`,
              }}
            />
          </View>
        </View>

        {currentItem?.problem && (
          <View className="mx-4 mt-4">
            <View className="bg-[#2a2a2a] rounded-2xl border border-[#333]/40 overflow-hidden">
              <View className="p-5">
                <Text className="text-gray-400 text-xs mb-2">문제</Text>
                <Text className="text-brand-beige text-base leading-6">
                  {currentItem.problem.stemLatex || currentItem.problem.stemText}
                </Text>

                {currentItem.problem.choices.length > 0 && (
                  <View className="mt-4 gap-2">
                    {currentItem.problem.choices.map((choice) => (
                      <Text
                        key={`${currentItem.reviewScheduleId}-${choice.position}`}
                        className="text-brand-beige/80 text-sm leading-6"
                      >
                        {choice.label}. {choice.contentLatex || choice.contentText}
                      </Text>
                    ))}
                  </View>
                )}
              </View>

              {!showSolution ? (
                <Pressable
                  className="border-t border-[#333] py-4 items-center"
                  onPress={() => setShowSolution(true)}
                >
                  <Text className="text-brand-accent font-semibold text-sm">
                    정답 보기
                  </Text>
                </Pressable>
              ) : (
                <View className="border-t border-[#333] p-5">
                  <Text className="text-gray-400 text-xs mb-2">정답</Text>
                  <Text className="text-green-400 text-sm leading-6 mb-4">
                    {currentItem.problem.answerLatex ||
                      currentItem.problem.answerText ||
                      "등록된 정답이 없습니다"}
                  </Text>
                  <Text className="text-gray-400 text-xs mb-2">풀이</Text>
                  <Text className="text-brand-beige text-base leading-6">
                    {currentItem.problem.solutionText || "등록된 풀이가 없습니다"}
                  </Text>
                </View>
              )}
            </View>

            {showSolution && (
              <View className="mt-4">
                <Text className="text-gray-400 text-xs mb-3 text-center">
                  얼마나 잘 기억했나요?
                </Text>
                <View className="flex-row flex-wrap gap-2">
                  {QUALITY_BUTTONS.map((button) => (
                    <Pressable
                      key={button.value}
                      className={`flex-1 min-w-[30%] rounded-xl py-3 items-center ${button.bg}`}
                      onPress={() =>
                        gradeMutation.mutate({
                          id: currentItem.reviewScheduleId,
                          quality: button.value,
                        })
                      }
                      disabled={gradeMutation.isPending}
                    >
                      <Text className={`text-lg font-bold ${button.text}`}>
                        {button.value}
                      </Text>
                      <Text className={`text-xs mt-0.5 ${button.text}`}>
                        {button.label}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            )}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
