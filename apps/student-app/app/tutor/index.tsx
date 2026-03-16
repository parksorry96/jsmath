import { View, Text, FlatList, Pressable, ActivityIndicator } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useRouter, Stack } from "expo-router";
import { MessageCircle, Clock, CheckCircle2 } from "lucide-react-native";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";

interface TutorSession {
  id: string;
  problemId: string;
  status: "active" | "resolved" | "abandoned";
  createdAt: string;
  updatedAt: string;
  problem?: {
    stemText: string;
    subject: string | null;
    unitMajor: string | null;
  };
  _count?: { messages: number };
}

export default function TutorHistoryScreen() {
  const { colors } = useTheme();
  const { user } = useAuth();
  const router = useRouter();

  const { data, isLoading } = useQuery({
    queryKey: ["tutor-sessions"],
    queryFn: () => api.get<TutorSession[]>("/student-ai/tutor/sessions"),
    enabled: !!user,
  });

  const sessions = data ?? [];

  const statusIcon = (status: string) => {
    if (status === "active") return <Clock color={colors.accent} size={16} />;
    if (status === "resolved") return <CheckCircle2 color={colors.success} size={16} />;
    return <CheckCircle2 color={colors.textMuted} size={16} />;
  };

  const statusLabel = (status: string) => {
    if (status === "active") return "진행 중";
    if (status === "resolved") return "완료";
    return "종료";
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    const month = d.getMonth() + 1;
    const day = d.getDate();
    const hours = d.getHours().toString().padStart(2, "0");
    const mins = d.getMinutes().toString().padStart(2, "0");
    return `${month}/${day} ${hours}:${mins}`;
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen options={{ title: "튜터 대화 기록", headerShown: true }} />

      {isLoading ? (
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : sessions.length === 0 ? (
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: 40 }}>
          <MessageCircle color={colors.textMuted} size={48} strokeWidth={1} />
          <Text style={{ color: colors.textMuted, fontSize: 16, marginTop: 16 }}>
            아직 대화 기록이 없어요
          </Text>
          <Text style={{ color: colors.textMuted, fontSize: 13, marginTop: 4 }}>
            문제에서 "AI 튜터에게 질문"을 눌러보세요
          </Text>
        </View>
      ) : (
        <FlatList
          data={sessions}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 16, gap: 10 }}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => router.push(`/tutor/${item.id}`)}
              style={{
                backgroundColor: colors.card, borderRadius: 14, padding: 16,
                borderWidth: 1, borderColor: colors.border,
              }}
            >
              {/* Header: subject + status */}
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <View style={{ flexDirection: "row", gap: 6 }}>
                  {item.problem?.subject && (
                    <View style={{ backgroundColor: colors.surface, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 }}>
                      <Text style={{ fontSize: 11, color: colors.textSecondary }}>{item.problem.subject}</Text>
                    </View>
                  )}
                  {item.problem?.unitMajor && (
                    <View style={{ backgroundColor: colors.surface, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 }}>
                      <Text style={{ fontSize: 11, color: colors.textSecondary }}>{item.problem.unitMajor}</Text>
                    </View>
                  )}
                </View>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                  {statusIcon(item.status)}
                  <Text style={{ fontSize: 11, color: colors.textMuted }}>{statusLabel(item.status)}</Text>
                </View>
              </View>

              {/* Problem preview */}
              <Text numberOfLines={2} style={{ fontSize: 14, color: colors.textPrimary, lineHeight: 20 }}>
                {item.problem?.stemText?.slice(0, 100) || "문제 내용"}
              </Text>

              {/* Footer: date + message count */}
              <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 10 }}>
                <Text style={{ fontSize: 12, color: colors.textMuted }}>{formatDate(item.createdAt)}</Text>
                {item._count?.messages != null && (
                  <Text style={{ fontSize: 12, color: colors.textMuted }}>
                    {item._count.messages}개 메시지
                  </Text>
                )}
              </View>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}
