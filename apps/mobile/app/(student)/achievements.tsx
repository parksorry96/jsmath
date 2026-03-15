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
import { api } from "@/lib/api";
import type {
  StudentGamificationProfile,
  LeaderboardEntry,
} from "@jsmath/shared-types";

const ACHIEVEMENT_LABELS: Record<string, { title: string; description: string }> = {
  first_login: { title: "첫 발걸음", description: "처음 로그인했어요" },
  streak_7: { title: "7일 연속 학습", description: "7일 연속으로 문제를 풀었어요" },
  streak_30: { title: "30일 연속 학습", description: "30일 연속으로 문제를 풀었어요" },
  problems_50: { title: "50문제 정복", description: "50문제를 풀었어요" },
  problems_200: { title: "200문제 정복", description: "200문제를 풀었어요" },
  perfect_score: { title: "만점왕", description: "과제에서 만점을 받았어요" },
  level_5: { title: "성장 중!", description: "레벨 5에 도달했어요" },
  level_10: { title: "실력자", description: "레벨 10에 도달했어요" },
};

function getAchievementLabel(key: string) {
  return ACHIEVEMENT_LABELS[key] ?? { title: key, description: "" };
}

interface Section {
  key: "profile" | "streaks" | "achievements_header" | "achievements" | "leaderboard_header" | "leaderboard";
}

export default function AchievementsScreen() {
  const queryClient = useQueryClient();

  const profileQuery = useQuery({
    queryKey: ["gamification", "profile"],
    queryFn: () => api.get<StudentGamificationProfile>("/gamification/profile"),
  });

  const leaderboardQuery = useQuery({
    queryKey: ["gamification", "leaderboard"],
    queryFn: () => api.get<LeaderboardEntry[]>("/gamification/leaderboard"),
  });

  const onRefresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["gamification"] });
  }, [queryClient]);

  const isRefreshing = profileQuery.isRefetching || leaderboardQuery.isRefetching;

  if (profileQuery.isLoading) {
    return (
      <SafeAreaView className="flex-1 bg-brand-dark items-center justify-center">
        <ActivityIndicator size="large" color="#d4a574" />
      </SafeAreaView>
    );
  }

  const profile = profileQuery.data;
  const leaderboard = leaderboardQuery.data ?? [];
  const xpForNext = (profile?.level ?? 1) * 100;
  const xpProgress = profile ? Math.min(profile.xp / xpForNext, 1) : 0;

  const earnedKeys = new Set(profile?.achievements.map((a) => a.achievementKey) ?? []);
  const allKeys = Object.keys(ACHIEVEMENT_LABELS);
  const earnedAchievements = allKeys.filter((k) => earnedKeys.has(k));
  const unearnedAchievements = allKeys.filter((k) => !earnedKeys.has(k));

  const sections: Section[] = [
    { key: "profile" },
    { key: "streaks" },
    { key: "achievements_header" },
    { key: "achievements" },
    { key: "leaderboard_header" },
    { key: "leaderboard" },
  ];

  const renderItem = ({ item }: { item: Section }) => {
    switch (item.key) {
      case "profile":
        return (
          <View className="mx-5 mt-4 bg-[#2a2a2a] rounded-2xl p-5 border border-[#333]/40 items-center">
            <View className="bg-brand-accent/20 rounded-full w-16 h-16 items-center justify-center mb-3">
              <Text className="text-brand-accent text-xl font-bold">
                Lv.{profile?.level ?? 1}
              </Text>
            </View>
            <Text className="text-brand-beige text-lg font-bold mb-1">
              {profile?.xp ?? 0} XP
            </Text>
            <View className="w-full mt-2">
              <View className="flex-row justify-between mb-1">
                <Text className="text-gray-400 text-xs">현재 레벨</Text>
                <Text className="text-gray-400 text-xs">
                  {profile?.xp ?? 0} / {xpForNext} XP
                </Text>
              </View>
              <View className="bg-[#444] rounded-full h-3 overflow-hidden">
                <View
                  className="bg-brand-accent rounded-full h-3"
                  style={{ width: `${xpProgress * 100}%` }}
                />
              </View>
            </View>
          </View>
        );

      case "streaks":
        return (
          <View className="mx-5 mt-4 flex-row gap-3">
            {(profile?.streaks ?? []).map((s) => (
              <View
                key={s.streakType}
                className="flex-1 bg-[#2a2a2a] rounded-2xl p-4 border border-[#333]/40 items-center"
              >
                <Text className="text-orange-400 text-2xl font-bold">
                  {s.currentStreak}
                </Text>
                <Text className="text-gray-400 text-xs mt-1">
                  {s.streakType === "daily" ? "일 연속" : s.streakType}
                </Text>
                <Text className="text-gray-500 text-xs mt-0.5">
                  최고 {s.longestStreak}일
                </Text>
              </View>
            ))}
            {(profile?.streaks ?? []).length === 0 && (
              <View className="flex-1 bg-[#2a2a2a] rounded-2xl p-4 border border-[#333]/40 items-center">
                <Text className="text-gray-400 text-sm">연속 학습 기록 없음</Text>
              </View>
            )}
          </View>
        );

      case "achievements_header":
        return (
          <View className="mx-5 mt-6 mb-2">
            <Text className="text-brand-beige text-lg font-bold">업적</Text>
          </View>
        );

      case "achievements":
        return (
          <View className="mx-5">
            {earnedAchievements.map((key) => {
              const label = getAchievementLabel(key);
              return (
                <View
                  key={key}
                  className="bg-[#2a2a2a] rounded-2xl p-4 mb-3 border border-brand-accent/30 flex-row items-center"
                >
                  <View className="bg-brand-accent/20 rounded-full w-10 h-10 items-center justify-center mr-3">
                    <Text className="text-brand-accent text-base">&#10003;</Text>
                  </View>
                  <View className="flex-1">
                    <Text className="text-brand-beige font-medium">{label.title}</Text>
                    <Text className="text-gray-400 text-xs mt-0.5">{label.description}</Text>
                  </View>
                </View>
              );
            })}
            {unearnedAchievements.map((key) => {
              const label = getAchievementLabel(key);
              return (
                <View
                  key={key}
                  className="bg-[#2a2a2a] rounded-2xl p-4 mb-3 border border-[#333]/40 flex-row items-center opacity-50"
                >
                  <View className="bg-[#444] rounded-full w-10 h-10 items-center justify-center mr-3">
                    <Text className="text-gray-500 text-base">?</Text>
                  </View>
                  <View className="flex-1">
                    <Text className="text-gray-400 font-medium">{label.title}</Text>
                    <Text className="text-gray-500 text-xs mt-0.5">{label.description}</Text>
                  </View>
                </View>
              );
            })}
          </View>
        );

      case "leaderboard_header":
        return (
          <View className="mx-5 mt-6 mb-2">
            <Text className="text-brand-beige text-lg font-bold">리더보드</Text>
          </View>
        );

      case "leaderboard":
        return (
          <View className="mx-5 pb-8">
            {leaderboardQuery.isLoading ? (
              <ActivityIndicator color="#d4a574" />
            ) : leaderboard.length === 0 ? (
              <View className="bg-[#2a2a2a] rounded-xl p-4">
                <Text className="text-gray-400 text-center text-sm">
                  리더보드 데이터가 없습니다
                </Text>
              </View>
            ) : (
              leaderboard.map((entry) => (
                <View
                  key={entry.studentId}
                  className={`bg-[#2a2a2a] rounded-2xl p-4 mb-2 border flex-row items-center ${
                    entry.rank <= 3 ? "border-brand-accent/30" : "border-[#333]/40"
                  }`}
                >
                  <Text
                    className={`text-lg font-bold w-8 ${
                      entry.rank === 1
                        ? "text-yellow-400"
                        : entry.rank === 2
                          ? "text-gray-300"
                          : entry.rank === 3
                            ? "text-orange-600"
                            : "text-gray-500"
                    }`}
                  >
                    {entry.rank}
                  </Text>
                  <View className="flex-1 ml-2">
                    <Text className="text-brand-beige font-medium">{entry.name}</Text>
                    <Text className="text-gray-400 text-xs">Lv.{entry.level}</Text>
                  </View>
                  <Text className="text-brand-accent font-bold">{entry.xp} XP</Text>
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
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={onRefresh}
            tintColor="#d4a574"
          />
        }
      />
    </SafeAreaView>
  );
}
