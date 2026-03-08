import { useState, useCallback } from "react";
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
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

interface Lesson {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  status: "scheduled" | "completed" | "cancelled";
  class?: { id: string; name: string };
}

interface Submission {
  id: string;
  status: string;
  submittedAt: string;
  student?: { id: string; name: string };
  assignment?: { id: string; title: string };
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
  return d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
}

const STATUS_LABEL: Record<string, string> = {
  scheduled: "예정",
  completed: "완료",
  cancelled: "취소",
};

const STATUS_COLOR: Record<string, string> = {
  scheduled: "#d4a574",
  completed: "#4ade80",
  cancelled: "#888",
};

export default function TeacherHome() {
  const router = useRouter();
  const { user } = useAuth();
  const [refreshing, setRefreshing] = useState(false);

  const { start, end } = todayRange();

  const lessonsQuery = useQuery({
    queryKey: ["lessons", "today"],
    queryFn: () =>
      api.get<Lesson[]>(`/lessons/calendar?start=${start}&end=${end}`),
  });

  const pendingQuery = useQuery({
    queryKey: ["submissions", "pending"],
    queryFn: () =>
      api.get<Submission[]>("/submissions?status=submitted&limit=20"),
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([lessonsQuery.refetch(), pendingQuery.refetch()]);
    setRefreshing(false);
  }, [lessonsQuery, pendingQuery]);

  const lessons = lessonsQuery.data ?? [];
  const pendingSubmissions = pendingQuery.data ?? [];
  const pendingCount = pendingSubmissions.length;

  return (
    <SafeAreaView edges={["bottom"]} className="flex-1 bg-brand-dark">
      <FlatList
        data={[]}
        renderItem={null}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#d4a574"
          />
        }
        ListHeaderComponent={
          <View className="px-4 pt-4 pb-8">
            {/* Quick Actions */}
            <View className="flex-row gap-3 mb-6">
              <Pressable
                className="flex-1 bg-brand-accent rounded-xl py-3 items-center"
                onPress={() => router.push("/(teacher)/calendar")}
              >
                <Text className="text-brand-dark font-bold text-base">
                  수업 추가
                </Text>
              </Pressable>
              <Pressable
                className="flex-1 border border-brand-accent rounded-xl py-3 items-center"
                onPress={() => router.push("/(teacher)/assignment/new")}
              >
                <Text className="text-brand-accent font-bold text-base">
                  과제 출제
                </Text>
              </Pressable>
            </View>

            {/* Today's Lessons */}
            <View className="mb-6">
              <Text className="text-brand-beige text-lg font-bold mb-3">
                오늘 수업
              </Text>
              {lessonsQuery.isLoading ? (
                <ActivityIndicator color="#d4a574" />
              ) : lessons.length === 0 ? (
                <View className="bg-[#2a2a2a] rounded-xl p-4">
                  <Text className="text-[#888] text-center">
                    오늘 예정된 수업이 없습니다
                  </Text>
                </View>
              ) : (
                lessons.map((lesson) => (
                  <View
                    key={lesson.id}
                    className="bg-[#2a2a2a] rounded-xl p-4 mb-2"
                  >
                    <View className="flex-row justify-between items-center mb-1">
                      <Text className="text-brand-beige font-bold text-base">
                        {lesson.title}
                      </Text>
                      <View
                        className="px-2 py-0.5 rounded-full"
                        style={{
                          backgroundColor:
                            STATUS_COLOR[lesson.status] + "20",
                        }}
                      >
                        <Text
                          style={{ color: STATUS_COLOR[lesson.status] }}
                          className="text-xs font-medium"
                        >
                          {STATUS_LABEL[lesson.status]}
                        </Text>
                      </View>
                    </View>
                    <Text className="text-[#aaa] text-sm">
                      {formatTime(lesson.startTime)} –{" "}
                      {formatTime(lesson.endTime)}
                    </Text>
                    {lesson.class && (
                      <Text className="text-[#888] text-xs mt-1">
                        {lesson.class.name}
                      </Text>
                    )}
                  </View>
                ))
              )}
            </View>

            {/* Grading Badge */}
            <Pressable
              className="bg-[#2a2a2a] rounded-xl p-4 mb-6 flex-row justify-between items-center"
              onPress={() => router.push("/(teacher)/grading")}
            >
              <View>
                <Text className="text-brand-beige font-bold text-base">
                  채점 대기
                </Text>
                <Text className="text-[#888] text-sm mt-0.5">
                  제출된 과제를 확인하세요
                </Text>
              </View>
              <View className="bg-brand-accent rounded-full w-10 h-10 items-center justify-center">
                <Text className="text-brand-dark font-bold text-lg">
                  {pendingCount}
                </Text>
              </View>
            </Pressable>

            {/* Recent Submissions */}
            <View>
              <Text className="text-brand-beige text-lg font-bold mb-3">
                최근 제출
              </Text>
              {pendingQuery.isLoading ? (
                <ActivityIndicator color="#d4a574" />
              ) : pendingSubmissions.length === 0 ? (
                <View className="bg-[#2a2a2a] rounded-xl p-4">
                  <Text className="text-[#888] text-center">
                    최근 제출된 과제가 없습니다
                  </Text>
                </View>
              ) : (
                pendingSubmissions.slice(0, 5).map((sub) => (
                  <View
                    key={sub.id}
                    className="bg-[#2a2a2a] rounded-xl p-3 mb-2 flex-row justify-between items-center"
                  >
                    <View className="flex-1">
                      <Text className="text-brand-beige text-sm font-medium">
                        {sub.student?.name ?? "학생"}
                      </Text>
                      <Text className="text-[#888] text-xs mt-0.5">
                        {sub.assignment?.title ?? "과제"}
                      </Text>
                    </View>
                    <Text className="text-[#666] text-xs">
                      {formatTime(sub.submittedAt)}
                    </Text>
                  </View>
                ))
              )}
            </View>
          </View>
        }
      />
    </SafeAreaView>
  );
}
