import { useCallback, useMemo } from "react";
import {
  View,
  Text,
  SectionList,
  Pressable,
  RefreshControl,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

interface Assignment {
  id: string;
  title: string;
  type: string;
  className: string;
  classId: string;
  dueDate: string;
  status: string;
  score?: number;
  maxScore?: number;
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

function statusConfig(status: string) {
  switch (status) {
    case "submitted":
      return { label: "제출완료", bg: "bg-blue-900/50", text: "text-blue-400" };
    case "graded":
      return { label: "채점완료", bg: "bg-green-900/50", text: "text-green-400" };
    default:
      return {
        label: "대기중",
        bg: "bg-yellow-900/50",
        text: "text-yellow-400",
      };
  }
}

function typeBadge(type: string) {
  switch (type) {
    case "problem_set":
      return { label: "문제풀이", bg: "bg-brand-accent/20", text: "text-brand-accent" };
    case "text_task":
      return { label: "서술형", bg: "bg-purple-900/50", text: "text-purple-400" };
    default:
      return { label: type, bg: "bg-[#333]", text: "text-gray-400" };
  }
}

export default function StudentAssignments() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: assignments = [], isLoading, isRefetching } = useQuery({
    queryKey: ["assignments", "all"],
    queryFn: () => api.get<Assignment[]>("/submissions?studentId=me"),
  });

  // Group by class
  const sections = useMemo(() => {
    const groups = new Map<string, Assignment[]>();
    for (const a of assignments) {
      const key = a.className || "기타";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(a);
    }

    return Array.from(groups.entries()).map(([title, data]) => ({
      title,
      data: data.sort(
        (a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime(),
      ),
    }));
  }, [assignments]);

  const onRefresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["assignments", "all"] });
  }, [queryClient]);

  const renderItem = useCallback(
    ({ item }: { item: Assignment }) => {
      const status = statusConfig(item.status);
      const type = typeBadge(item.type);
      const dueText = relativeDue(item.dueDate);
      const isOverdue = dueText === "기한 지남" && item.status === "pending";

      return (
        <Pressable
          className="bg-[#2a2a2a] rounded-xl p-3 mx-4 mb-2"
          onPress={() => router.push(`/(student)/assignment/${item.id}`)}
        >
          <View className="flex-row items-center justify-between mb-1">
            <Text className="text-brand-beige font-medium flex-1 mr-2">
              {item.title}
            </Text>
            <View className={`rounded-full px-2 py-0.5 ${status.bg}`}>
              <Text className={`text-xs ${status.text}`}>{status.label}</Text>
            </View>
          </View>

          <View className="flex-row items-center mt-1">
            <View className={`rounded px-1.5 py-0.5 mr-2 ${type.bg}`}>
              <Text className={`text-xs ${type.text}`}>{type.label}</Text>
            </View>
            <Text
              className={`text-xs ${isOverdue ? "text-red-400" : "text-gray-400"}`}
            >
              {dueText}
            </Text>
            {item.status === "graded" && item.score != null && (
              <Text className="text-green-400 text-xs ml-auto">
                {item.score}/{item.maxScore}
              </Text>
            )}
          </View>
        </Pressable>
      );
    },
    [router],
  );

  const renderSectionHeader = useCallback(
    ({ section }: { section: { title: string } }) => (
      <View className="px-4 pt-4 pb-1">
        <Text className="text-brand-beige font-semibold text-base">
          {section.title}
        </Text>
      </View>
    ),
    [],
  );

  if (isLoading) {
    return (
      <SafeAreaView className="flex-1 bg-brand-dark items-center justify-center" edges={["left", "right"]}>
        <ActivityIndicator color="#d4a574" size="large" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-brand-dark" edges={["left", "right"]}>
      {sections.length === 0 ? (
        <View className="flex-1 items-center justify-center px-4">
          <Text className="text-gray-400 text-center">
            등록된 과제가 없습니다
          </Text>
        </View>
      ) : (
        <SectionList
          sections={sections}
          renderItem={renderItem}
          renderSectionHeader={renderSectionHeader}
          keyExtractor={(item) => item.id}
          stickySectionHeadersEnabled={false}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={onRefresh}
              tintColor="#d4a574"
            />
          }
          contentContainerStyle={{ paddingBottom: 16 }}
        />
      )}
    </SafeAreaView>
  );
}
