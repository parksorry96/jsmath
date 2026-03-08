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

interface Lesson {
  id: string;
  title: string;
  startTime: string;
}

interface ClassItem {
  id: string;
  name: string;
  description?: string;
  _count?: { enrollments: number };
  nextLesson?: Lesson | null;
}

function formatDateTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("ko-KR", {
    month: "short",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function TeacherClasses() {
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);

  const classesQuery = useQuery({
    queryKey: ["classes"],
    queryFn: () => api.get<ClassItem[]>("/classes"),
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await classesQuery.refetch();
    setRefreshing(false);
  }, [classesQuery]);

  const classes = classesQuery.data ?? [];

  if (classesQuery.isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-brand-dark">
        <ActivityIndicator size="large" color="#d4a574" />
      </View>
    );
  }

  return (
    <SafeAreaView edges={["bottom"]} className="flex-1 bg-brand-dark">
      <FlatList
        data={classes}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#d4a574"
          />
        }
        ListEmptyComponent={
          <View className="items-center justify-center py-24">
            <Text className="text-[#888] text-base">등록된 반이 없습니다</Text>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            className="bg-[#2a2a2a] rounded-2xl p-4 mb-3 border border-[#333]/40 active:opacity-80"
            onPress={() =>
              router.push(`/(teacher)/class/${item.id}` as never)
            }
          >
            <View className="flex-row justify-between items-start mb-2">
              <Text className="text-brand-beige text-base font-bold flex-1">
                {item.name}
              </Text>
              <View className="bg-brand-accent/15 rounded-full px-3 py-1">
                <Text className="text-brand-accent text-xs font-medium">
                  {item._count?.enrollments ?? 0}명
                </Text>
              </View>
            </View>
            {item.description && (
              <Text className="text-[#888] text-sm mb-2" numberOfLines={1}>
                {item.description}
              </Text>
            )}
            {item.nextLesson ? (
              <View className="flex-row items-center">
                <Text className="text-[#666] text-xs">다음 수업: </Text>
                <Text className="text-[#aaa] text-xs">
                  {formatDateTime(item.nextLesson.startTime)}
                </Text>
              </View>
            ) : (
              <Text className="text-[#555] text-xs">예정된 수업 없음</Text>
            )}
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}
