import { View, Text, Pressable, useWindowDimensions } from "react-native";
import { useLocalSearchParams, Stack, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Send } from "lucide-react-native";
import { api } from "@/lib/api";
import { useTheme } from "@/lib/theme";
import { DrawingCanvas } from "@/components/canvas/drawing-canvas";

export default function CanvasScreen() {
  const { problemId } = useLocalSearchParams<{ problemId: string }>();
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const isTablet = width > 768;
  const router = useRouter();

  const { data: problem } = useQuery({
    queryKey: ["problem", problemId],
    queryFn: () => api.get<{ stemText: string; subject: string }>(`/problems/${problemId}/student-view`),
    enabled: !!problemId,
  });

  async function handleSubmit(imageBase64: string) {
    const uploadRes = await api.post<{ s3Key: string }>("/student-ai/canvas/upload", { image: imageBase64 });
    const session = await api.post<{ id: string }>("/student-ai/tutor/sessions", { problemId });
    await api.post(`/student-ai/tutor/sessions/${session.id}/message`, {
      content: "제 풀이를 확인해주세요",
      imageS3Key: uploadRes.s3Key,
    });
    router.push(`/tutor/${session.id}`);
  }

  if (isTablet) {
    return (
      <View style={{ flex: 1, flexDirection: "row", backgroundColor: colors.bg }}>
        <Stack.Screen options={{ title: "펜슬 풀이", headerShown: true }} />

        {/* Left: Problem */}
        <View style={{ flex: 1, borderRightWidth: 1, borderRightColor: colors.border, padding: 20 }}>
          <Text style={{ fontSize: 13, color: colors.textMuted, marginBottom: 8 }}>문제</Text>
          <View style={{ backgroundColor: colors.card, borderRadius: 12, padding: 16, flex: 1, borderWidth: 1, borderColor: colors.border }}>
            <Text style={{ fontSize: 16, color: colors.textPrimary, lineHeight: 26 }}>
              {problem?.stemText ?? "로딩 중..."}
            </Text>
          </View>
        </View>

        {/* Right: Canvas */}
        <View style={{ flex: 1 }}>
          <DrawingCanvas onCapture={handleSubmit} />
          <View style={{ padding: 12, borderTopWidth: 1, borderTopColor: colors.border, flexDirection: "row", justifyContent: "flex-end", gap: 12 }}>
            <Pressable
              onPress={() => handleSubmit("")}
              style={{
                backgroundColor: colors.accent, borderRadius: 20, paddingVertical: 10, paddingHorizontal: 24,
                flexDirection: "row", alignItems: "center", gap: 6,
              }}
            >
              <Send color="#fff" size={16} />
              <Text style={{ color: "#fff", fontWeight: "700" }}>풀이 제출</Text>
            </Pressable>
          </View>
        </View>
      </View>
    );
  }

  // Phone: full-screen canvas
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen options={{ title: "펜슬 풀이", headerShown: true }} />
      <DrawingCanvas onCapture={handleSubmit} />
      <View style={{ padding: 12, borderTopWidth: 1, borderTopColor: colors.border }}>
        <Pressable
          onPress={() => handleSubmit("")}
          style={{
            backgroundColor: colors.accent, borderRadius: 20, paddingVertical: 14, alignItems: "center",
            flexDirection: "row", justifyContent: "center", gap: 8,
          }}
        >
          <Send color="#fff" size={18} />
          <Text style={{ color: "#fff", fontSize: 15, fontWeight: "700" }}>풀이 제출</Text>
        </Pressable>
      </View>
    </View>
  );
}
