import { useCallback, useMemo } from "react";
import {
  View,
  Text,
  FlatList,
  Pressable,
  RefreshControl,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import type { StudentGamificationProfile } from "@jsmath/shared-types";

interface Lesson {
  id: string;
  title: string;
  className: string;
  startTime: string;
  endTime: string;
  status: string;
}

interface Assignment {
  id: string;
  title: string;
  className: string;
  type: string;
  dueDate: string;
  status: string;
}

interface Notification {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  read: boolean;
}

interface NotificationsResponse {
  items: Notification[];
}

function todayRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

function formatTime(iso: string) {
  const d = new Date(iso);
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}

function relativeDue(iso: string) {
  const now = Date.now();
  const due = new Date(iso).getTime();
  const diff = due - now;
  if (diff < 0) return "기한 지남";
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return "오늘 마감";
  if (days === 1) return "내일 마감";
  return `${days}일 남음`;
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}분 전`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}시간 전`;
  return `${Math.floor(hours / 24)}일 전`;
}

export default function StudentHome() {
  const { user } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();

  const { start, end } = useMemo(() => todayRange(), []);

  const lessonsQuery = useQuery({
    queryKey: ["lessons", "today"],
    queryFn: () =>
      api.get<Lesson[]>(`/lessons/calendar?start=${start}&end=${end}`),
  });

  const assignmentsQuery = useQuery({
    queryKey: ["assignments", "pending"],
    queryFn: () => api.get<Assignment[]>("/assignments/my"),
  });

  const notificationsQuery = useQuery({
    queryKey: ["notifications", "recent"],
    queryFn: () =>
      api.get<NotificationsResponse>("/notifications").then((res) =>
        res.items.slice(0, 3),
      ),
  });

  const gamificationQuery = useQuery({
    queryKey: ["gamification", "profile"],
    queryFn: () => api.get<StudentGamificationProfile>("/gamification/profile"),
  });

  const isLoading =
    lessonsQuery.isLoading ||
    assignmentsQuery.isLoading ||
    notificationsQuery.isLoading;

  const isRefreshing =
    lessonsQuery.isRefetching ||
    assignmentsQuery.isRefetching ||
    notificationsQuery.isRefetching;

  const onRefresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["lessons", "today"] });
    queryClient.invalidateQueries({ queryKey: ["assignments", "pending"] });
    queryClient.invalidateQueries({ queryKey: ["notifications", "recent"] });
    queryClient.invalidateQueries({ queryKey: ["gamification", "profile"] });
  }, [queryClient]);

  const lessons = lessonsQuery.data ?? [];
  const notifications = notificationsQuery.data ?? [];

  const sections = [
    { key: "header" },
    { key: "lessons" },
    { key: "learning" },
    { key: "gamification" },
    { key: "assignments" },
    { key: "notifications" },
  ];

  const renderItem = useCallback(
    ({ item }: { item: (typeof sections)[number] }) => {
      switch (item.key) {
        case "header":
          return (
            <View className="px-5 pt-6 pb-3">
              <Text className="text-brand-beige text-2xl font-bold tracking-tight">
                안녕하세요{user?.email ? `, ${user.email.split("@")[0]}` : ""}
              </Text>
              <Text className="text-[#999] text-sm mt-1.5">
                오늘도 열심히 공부해봐요!
              </Text>
            </View>
          );

        case "lessons":
          return (
            <View className="px-5 mt-6">
              <Text className="text-brand-beige text-lg font-bold mb-2">
                오늘 수업
              </Text>
              {isLoading ? (
                <ActivityIndicator color="#d4a574" />
              ) : lessons.length === 0 ? (
                <View className="bg-[#2a2a2a] rounded-xl p-4">
                  <Text className="text-gray-400 text-center text-sm">
                    오늘 수업이 없습니다
                  </Text>
                </View>
              ) : (
                lessons.map((lesson) => (
                  <View
                    key={lesson.id}
                    className="bg-[#2a2a2a] rounded-2xl p-4 mb-3 border border-[#333]/40 flex-row items-center"
                  >
                    <View className="bg-brand-accent/15 rounded-lg px-3 py-1.5 mr-3">
                      <Text className="text-brand-accent text-xs font-medium">
                        {formatTime(lesson.startTime)}
                      </Text>
                    </View>
                    <View className="flex-1">
                      <Text className="text-brand-beige font-medium">
                        {lesson.title}
                      </Text>
                      <Text className="text-gray-400 text-xs mt-0.5">
                        {lesson.className}
                      </Text>
                    </View>
                    <View
                      className={`rounded-full px-2 py-0.5 ${
                        lesson.status === "completed"
                          ? "bg-green-900/50"
                          : "bg-brand-accent/20"
                      }`}
                    >
                      <Text
                        className={`text-xs ${
                          lesson.status === "completed"
                            ? "text-green-400"
                            : "text-brand-accent"
                        }`}
                      >
                        {lesson.status === "completed" ? "완료" : "예정"}
                      </Text>
                    </View>
                  </View>
                ))
              )}
            </View>
          );

        case "learning":
          return (
            <View className="px-5 mt-6">
              <Text className="text-brand-beige text-lg font-bold mb-2">
                학습 도구
              </Text>
              <View className="flex-row gap-3">
                <Pressable
                  className="flex-1 bg-red-900/20 rounded-2xl p-4 border border-red-900/30"
                  onPress={() => router.push("/(student)/wrong-answers")}
                >
                  <Text className="text-red-400 text-lg font-bold">오답노트</Text>
                  <Text className="text-red-400/60 text-xs mt-1">틀린 문제 복습</Text>
                </Pressable>
                <Pressable
                  className="flex-1 bg-blue-900/20 rounded-2xl p-4 border border-blue-900/30"
                  onPress={() => router.push("/(student)/mastery")}
                >
                  <Text className="text-blue-400 text-lg font-bold">학습 현황</Text>
                  <Text className="text-blue-400/60 text-xs mt-1">교육과정 진도</Text>
                </Pressable>
              </View>
              <Pressable
                className="bg-brand-accent/15 rounded-2xl p-4 mt-3 border border-brand-accent/20"
                onPress={() => router.push("/(student)/daily-review")}
              >
                <View className="flex-row items-center justify-between">
                  <View>
                    <Text className="text-brand-accent text-lg font-bold">오늘의 복습</Text>
                    <Text className="text-brand-accent/60 text-xs mt-1">간격 반복 학습</Text>
                  </View>
                  <Text className="text-brand-accent text-2xl font-bold">→</Text>
                </View>
              </Pressable>
            </View>
          );

        case "gamification": {
          const gp = gamificationQuery.data;
          if (!gp) return null;
          const streak = gp.streaks.find((s) => s.streakType === "daily") ?? gp.streaks[0];
          const xpForNext = gp.level * 100;
          const xpProgress = Math.min(gp.xp / xpForNext, 1);
          return (
            <Pressable
              className="mx-5 mt-4 bg-[#2a2a2a] rounded-2xl p-4 border border-[#333]/40 flex-row items-center"
              onPress={() => router.push("/(student)/achievements")}
            >
              <View className="bg-brand-accent/20 rounded-full w-10 h-10 items-center justify-center mr-3">
                <Text className="text-brand-accent text-sm font-bold">
                  Lv.{gp.level}
                </Text>
              </View>
              <View className="flex-1 mr-3">
                <View className="flex-row items-center justify-between mb-1">
                  <Text className="text-brand-beige text-sm font-medium">
                    {gp.xp} / {xpForNext} XP
                  </Text>
                  {streak && streak.currentStreak > 0 && (
                    <Text className="text-orange-400 text-xs font-medium">
                      {streak.currentStreak}일 연속
                    </Text>
                  )}
                </View>
                <View className="bg-[#444] rounded-full h-2 overflow-hidden">
                  <View
                    className="bg-brand-accent rounded-full h-2"
                    style={{ width: `${xpProgress * 100}%` }}
                  />
                </View>
              </View>
              <Text className="text-gray-500 text-lg">{'>'}</Text>
            </Pressable>
          );
        }

        case "assignments":
          return (
            <View className="px-5 mt-6">
              <View className="flex-row items-center justify-between mb-2">
                <Text className="text-brand-beige text-lg font-bold">
                  할 일
                </Text>
                <Pressable onPress={() => router.push("/(student)/assignments")}>
                  <Text className="text-brand-accent text-sm font-medium">전체보기</Text>
                </Pressable>
              </View>
              {isLoading ? (
                <ActivityIndicator color="#d4a574" />
              ) : !assignmentsQuery.data ||
                assignmentsQuery.data.length === 0 ? (
                <View className="bg-[#2a2a2a] rounded-xl p-4">
                  <Text className="text-gray-400 text-center text-sm">
                    대기 중인 과제가 없습니다
                  </Text>
                </View>
              ) : (
                assignmentsQuery.data.slice(0, 3).map((a) => (
                  <Pressable
                    key={a.id}
                    className="bg-[#2a2a2a] rounded-2xl p-4 mb-3 border border-[#333]/40"
                    onPress={() =>
                      router.push(`/(student)/assignment/${a.id}`)
                    }
                  >
                    <View className="flex-row items-center justify-between">
                      <Text className="text-brand-beige font-medium flex-1 mr-2">
                        {a.title}
                      </Text>
                      <Text className="text-yellow-400 text-xs">
                        {relativeDue(a.dueDate)}
                      </Text>
                    </View>
                    <Text className="text-gray-400 text-xs mt-1">
                      {a.className}
                    </Text>
                  </Pressable>
                ))
              )}
            </View>
          );

        case "notifications":
          return (
            <View className="px-5 mt-6 pb-8">
              <Text className="text-brand-beige text-lg font-bold mb-2">
                최근 알림
              </Text>
              {isLoading ? (
                <ActivityIndicator color="#d4a574" />
              ) : notifications.length === 0 ? (
                <View className="bg-[#2a2a2a] rounded-xl p-4">
                  <Text className="text-gray-400 text-center text-sm">
                    새로운 알림이 없습니다
                  </Text>
                </View>
              ) : (
                notifications.map((n) => (
                  <View
                    key={n.id}
                    className={`bg-[#2a2a2a] rounded-2xl p-4 mb-3 border border-[#333]/40 ${
                      !n.read ? "border-l-2 border-brand-accent" : ""
                    }`}
                  >
                    <View className="flex-row items-center justify-between">
                      <Text className="text-brand-beige font-medium flex-1 mr-2">
                        {n.title}
                      </Text>
                      <Text className="text-gray-500 text-xs">
                        {timeAgo(n.createdAt)}
                      </Text>
                    </View>
                    <Text className="text-gray-400 text-xs mt-1">{n.body}</Text>
                  </View>
                ))
              )}
            </View>
          );

        default:
          return null;
      }
    },
    [isLoading, lessons, assignmentsQuery.data, notifications, gamificationQuery.data, user, router],
  );

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
