import { useState, useCallback } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

interface Notification {
  id: string;
  type: "lesson" | "assignment" | "grade" | "general";
  title: string;
  body: string;
  isRead: boolean;
  createdAt: string;
}

const FILTER_TABS = [
  { key: "all", label: "전체" },
  { key: "lesson", label: "수업" },
  { key: "assignment", label: "과제" },
  { key: "grade", label: "성적" },
] as const;

type FilterKey = (typeof FILTER_TABS)[number]["key"];

const TYPE_ICONS: Record<string, string> = {
  lesson: "📅",
  assignment: "📝",
  grade: "📊",
  general: "🔔",
};

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "방금 전";
  if (mins < 60) return `${mins}분 전`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}일 전`;
  return new Date(dateStr).toLocaleDateString("ko-KR");
}

export default function ParentNotifications() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<FilterKey>("all");

  const {
    data: notifications,
    isLoading,
    refetch,
    isRefetching,
  } = useQuery<Notification[]>({
    queryKey: ["parent-notifications"],
    queryFn: () => api.get("/notifications"),
  });

  const markReadMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/notifications/${id}/read`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["parent-notifications"] });
    },
  });

  const filtered =
    notifications?.filter((n) => filter === "all" || n.type === filter) ?? [];

  const handleTap = useCallback(
    (item: Notification) => {
      if (!item.isRead) {
        markReadMutation.mutate(item.id);
      }
    },
    [markReadMutation],
  );

  return (
    <SafeAreaView className="flex-1 bg-brand-dark" edges={["bottom"]}>
      {/* Filter tabs */}
      <View className="flex-row px-4 pt-3 pb-2 gap-2">
        {FILTER_TABS.map((tab) => (
          <TouchableOpacity
            key={tab.key}
            className={`px-4 py-2 rounded-full ${
              filter === tab.key ? "bg-brand-accent" : "bg-[#2a2a2a]"
            }`}
            onPress={() => setFilter(tab.key)}
          >
            <Text
              className={`text-sm font-bold ${
                filter === tab.key ? "text-brand-dark" : "text-gray-400"
              }`}
            >
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#d4a574" />
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingBottom: 20 }}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={refetch}
              tintColor="#d4a574"
            />
          }
          ListEmptyComponent={
            <View className="items-center mt-12">
              <Text className="text-gray-500">알림이 없습니다</Text>
            </View>
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              className={`mx-4 mb-2 rounded-xl p-4 ${
                item.isRead ? "bg-[#2a2a2a]" : "bg-[#2f2a24]"
              }`}
              onPress={() => handleTap(item)}
              activeOpacity={0.7}
            >
              <View className="flex-row items-start gap-3">
                <Text className="text-xl mt-0.5">
                  {TYPE_ICONS[item.type] || "🔔"}
                </Text>
                <View className="flex-1">
                  <View className="flex-row items-center gap-2">
                    {!item.isRead && (
                      <View className="w-2 h-2 rounded-full bg-brand-accent" />
                    )}
                    <Text className="text-brand-beige font-bold text-sm flex-1">
                      {item.title}
                    </Text>
                    <Text className="text-gray-500 text-xs">
                      {relativeTime(item.createdAt)}
                    </Text>
                  </View>
                  <Text className="text-gray-400 text-sm mt-1">
                    {item.body}
                  </Text>
                </View>
              </View>
            </TouchableOpacity>
          )}
        />
      )}
    </SafeAreaView>
  );
}
