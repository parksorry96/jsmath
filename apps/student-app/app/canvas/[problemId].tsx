import { useState } from "react";
import { View, Text, useWindowDimensions, Alert, Platform } from "react-native";
import { useLocalSearchParams, Stack, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import * as FileSystem from "expo-file-system/legacy";
import { api, API_URL, ApiError } from "@/lib/api";
import { useTheme } from "@/lib/theme";
import { DrawingCanvas } from "@/components/canvas/drawing-canvas";
import { getItemAsync } from "@/lib/storage";
import { LatexText } from "@/components/math/latex-text";
import { streamTutorMessage } from "@/lib/tutor-stream";

async function uploadCanvasImage(pngBase64: string) {
  const token = Platform.OS === "web" ? null : await getItemAsync("auth_token");
  if (!FileSystem.cacheDirectory) {
    throw new Error("expo-file-system is not available");
  }

  const tmpPath = `${FileSystem.cacheDirectory}canvas-${Date.now()}.png`;
  await FileSystem.writeAsStringAsync(tmpPath, pngBase64, {
    encoding: FileSystem.EncodingType.Base64,
  });

  const formData = new FormData();
  formData.append("file", {
    uri: tmpPath,
    type: "image/png",
    name: "canvas.png",
  } as any);

  const uploadRes = await fetch(`${API_URL}/student-ai/canvas/upload`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: formData,
    credentials: Platform.OS === "web" ? "include" : undefined,
  });

  if (!uploadRes.ok) {
    let body: unknown;
    try {
      body = await uploadRes.json();
    } catch {
      body = { message: uploadRes.statusText };
    }
    throw new ApiError(uploadRes.status, body);
  }

  return (await uploadRes.json()) as { s3Key: string };
}

export default function CanvasScreen() {
  const { problemId } = useLocalSearchParams<{ problemId: string }>();
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const isTablet = width > 768;
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { data: problem } = useQuery({
    queryKey: ["problem", problemId],
    queryFn: () =>
      api.get<{ stemText: string; stemLatex: string; subject: string }>(
        `/problems/${problemId}/student-view`,
      ),
    enabled: !!problemId,
  });

  async function handleSubmit(imageBase64: string) {
    if (!imageBase64 || isSubmitting) return;

    setIsSubmitting(true);
    try {
      const uploadData = await uploadCanvasImage(imageBase64);
      const session = await api.post<{ id: string }>("/student-ai/tutor/sessions", { problemId });
      await streamTutorMessage({
        sessionId: session.id,
        content: "제 풀이를 확인해주세요",
        imageS3Key: uploadData.s3Key,
      });
      router.push(`/tutor/${session.id}`);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "풀이를 제출하지 못했어요. 다시 시도해 주세요.";
      Alert.alert("제출 실패", message);
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isTablet) {
    return (
      <View style={{ flex: 1, flexDirection: "row", backgroundColor: colors.bg }}>
        <Stack.Screen options={{ title: "펜슬 풀이", headerShown: true }} />

        {/* Left: Problem */}
        <View style={{ flex: 1, borderRightWidth: 1, borderRightColor: colors.border, padding: 20 }}>
          <Text style={{ fontSize: 13, color: colors.textMuted, marginBottom: 8 }}>문제</Text>
          <View style={{ backgroundColor: colors.card, borderRadius: 12, padding: 16, flex: 1, borderWidth: 1, borderColor: colors.border }}>
            <LatexText style={{ fontSize: 16, lineHeight: 26 }}>
              {problem?.stemLatex || problem?.stemText || "로딩 중..."}
            </LatexText>
          </View>
        </View>

        {/* Right: Canvas */}
        <View style={{ flex: 1 }}>
          <DrawingCanvas onCapture={handleSubmit} />
        </View>
      </View>
    );
  }

  // Phone: full-screen canvas
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen options={{ title: "펜슬 풀이", headerShown: true }} />
      <DrawingCanvas onCapture={handleSubmit} />
    </View>
  );
}
