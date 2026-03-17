import { useState } from "react";
import { View, Text, FlatList, Pressable, ActivityIndicator } from "react-native";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useTheme } from "@/lib/theme";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { LatexText } from "@/components/math/latex-text";

interface WrongAnswer {
  id: string;
  problemId: string;
  problemContent: string;
  solution: string;
  errorType: string;
  studentAnswer: string | null;
  retryCount: number;
  resolved: boolean;
  createdAt: string;
}

interface WrongAnswersResponse {
  items: WrongAnswer[];
  total: number;
}

const ERROR_LABELS: Record<string, string> = {
  concept_gap: "개념부족",
  pattern_gap: "유형미숙",
  calculation_error: "계산실수",
  careless_mistake: "부주의",
};

const ERROR_COLORS: Record<string, string> = {
  concept_gap: "#a78bfa",
  pattern_gap: "#60a5fa",
  calculation_error: "#f87171",
  careless_mistake: "#fbbf24",
};

export function WrongAnswersSection() {
  const { colors } = useTheme();
  const { user } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["wrong-answers"],
    queryFn: () => api.get<WrongAnswersResponse>("/student-ai/wrong-answers?limit=50"),
    enabled: !!user,
  });

  const resolveMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/student-ai/wrong-answers/${id}/resolve`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["wrong-answers"] }),
  });

  const startTutorMutation = useMutation({
    mutationFn: (problemId: string) =>
      api.post<{ id: string }>("/student-ai/tutor/sessions", { problemId }),
    onSuccess: (session) => {
      router.push(`/tutor/${session.id}`);
    },
  });

  if (isLoading) {
    return (
      <View style={{ paddingVertical: 48, alignItems: "center" }}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  const items = data?.items ?? [];

  return (
    <FlatList
      data={items}
      keyExtractor={(item) => item.id}
      scrollEnabled={false}
      contentContainerStyle={{ padding: 16, gap: 10 }}
      ListEmptyComponent={
        <View style={{ alignItems: "center", paddingVertical: 48 }}>
          <Text style={{ color: colors.textMuted, fontSize: 14 }}>오답 기록이 없습니다</Text>
        </View>
      }
      renderItem={({ item }) => {
        const errorColor = ERROR_COLORS[item.errorType] ?? colors.textMuted;
        const errorLabel = ERROR_LABELS[item.errorType] ?? item.errorType;
        const isExpanded = expandedId === item.id;

        return (
          <Pressable
            onPress={() => setExpandedId(isExpanded ? null : item.id)}
            style={{
              backgroundColor: colors.card,
              borderRadius: 14,
              borderWidth: 1,
              borderColor: colors.border,
              overflow: "hidden",
            }}
          >
              <View style={{ padding: 16 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <View
                  style={{
                    flex: 1,
                    marginRight: 8,
                    maxHeight: isExpanded ? undefined : 44,
                    overflow: "hidden",
                  }}
                >
                  <LatexText style={{ fontSize: 14, lineHeight: 20 }}>
                    {item.problemContent}
                  </LatexText>
                </View>
                <View style={{ backgroundColor: errorColor + "22", borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 }}>
                  <Text style={{ color: errorColor, fontSize: 11, fontWeight: "600" }}>{errorLabel}</Text>
                </View>
              </View>
              <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 8 }}>
                <Text style={{ color: colors.textMuted, fontSize: 12 }}>
                  재시도 {item.retryCount}회
                </Text>
                <Text style={{ color: item.resolved ? colors.success : colors.accent, fontSize: 12, fontWeight: "600" }}>
                  {item.resolved ? "해결됨" : "미해결"}
                </Text>
              </View>
            </View>

            {isExpanded && (
              <View style={{ borderTopWidth: 1, borderTopColor: colors.border, padding: 16, gap: 10 }}>
                <View style={{ flexDirection: "row", gap: 10 }}>
                  <Pressable
                    onPress={() => startTutorMutation.mutate(item.problemId)}
                    disabled={startTutorMutation.isPending}
                    style={{
                      flex: 1, backgroundColor: colors.accent, borderRadius: 12,
                      paddingVertical: 12, alignItems: "center",
                      opacity: startTutorMutation.isPending ? 0.7 : 1,
                    }}
                  >
                    <Text style={{ color: "#fff", fontSize: 14, fontWeight: "700" }}>
                      {startTutorMutation.isPending ? "시작 중..." : "AI 튜터"}
                    </Text>
                  </Pressable>
                  {!item.resolved && (
                    <Pressable
                      onPress={() => resolveMutation.mutate(item.id)}
                      disabled={resolveMutation.isPending}
                      style={{
                        flex: 1, backgroundColor: colors.success + "22", borderRadius: 12,
                        paddingVertical: 12, alignItems: "center", borderWidth: 1, borderColor: colors.success + "44",
                      }}
                    >
                      <Text style={{ color: colors.success, fontSize: 14, fontWeight: "700" }}>해결됨</Text>
                    </Pressable>
                  )}
                </View>
              </View>
            )}
          </Pressable>
        );
      }}
    />
  );
}
