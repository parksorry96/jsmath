import { View, Text, ScrollView, Pressable, useWindowDimensions, Platform } from "react-native";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { MessageCircle, PenTool } from "lucide-react-native";
import { api } from "@/lib/api";
import { useTheme } from "@/lib/theme";

interface ProblemDetail {
  id: string;
  stemLatex: string;
  stemText: string;
  subject: string;
  unitMajor: string;
  unitMinor: string;
  difficulty: number;
  problemType: string;
}

export default function ProblemDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const isTablet = width > 768;

  const { data: problem } = useQuery({
    queryKey: ["problem", id],
    queryFn: () => api.get<ProblemDetail>(`/problems/${id}/student-view`),
    enabled: !!id,
  });

  async function startTutor() {
    const session = await api.post<{ id: string }>("/student-ai/tutor/sessions", { problemId: id });
    router.push(`/tutor/${session.id}`);
  }

  if (!problem) return null;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 20 }}>
      <Stack.Screen options={{ title: `${problem.subject} · ${problem.unitMajor}`, headerShown: true }} />

      {/* Meta badges */}
      <View style={{ flexDirection: "row", gap: 8, marginBottom: 16 }}>
        <View style={{ backgroundColor: colors.surface, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 }}>
          <Text style={{ fontSize: 12, color: colors.textSecondary }}>{problem.subject}</Text>
        </View>
        <View style={{ backgroundColor: colors.surface, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 }}>
          <Text style={{ fontSize: 12, color: colors.textSecondary }}>난이도 {problem.difficulty}</Text>
        </View>
        <View style={{ backgroundColor: colors.surface, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 }}>
          <Text style={{ fontSize: 12, color: colors.textSecondary }}>{problem.problemType}</Text>
        </View>
      </View>

      {/* Problem stem */}
      <View style={{
        backgroundColor: colors.card, borderRadius: 16, padding: 20,
        borderWidth: 1, borderColor: colors.border, minHeight: 120,
      }}>
        <Text style={{ fontSize: 16, color: colors.textPrimary, lineHeight: 26 }}>
          {problem.stemText || problem.stemLatex}
        </Text>
      </View>

      {/* Actions */}
      <View style={{ gap: 12, marginTop: 24 }}>
        <Pressable
          onPress={startTutor}
          style={{
            backgroundColor: colors.accent, borderRadius: 16, paddingVertical: 16,
            flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
          }}
        >
          <MessageCircle color="#fff" size={20} />
          <Text style={{ color: "#fff", fontSize: 16, fontWeight: "700" }}>AI 튜터에게 질문</Text>
        </Pressable>

        {(isTablet || Platform.OS === "ios") && (
          <Pressable
            onPress={() => router.push(`/canvas/${id}`)}
            style={{
              backgroundColor: colors.surface, borderRadius: 16, paddingVertical: 16,
              flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
              borderWidth: 1, borderColor: colors.border,
            }}
          >
            <PenTool color={colors.textSecondary} size={20} />
            <Text style={{ color: colors.textPrimary, fontSize: 16, fontWeight: "600" }}>펜슬로 풀기</Text>
          </Pressable>
        )}
      </View>
    </ScrollView>
  );
}
