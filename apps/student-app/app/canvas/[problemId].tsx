import { useEffect, useRef, useState } from "react";
import { View, Text, useWindowDimensions, Alert, Platform, ScrollView, ActivityIndicator, Pressable } from "react-native";
import { useLocalSearchParams, Stack, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import * as FileSystem from "expo-file-system/legacy";
import { MotiView } from "moti";
import { api, API_URL, ApiError } from "@/lib/api";
import { useTheme } from "@/lib/theme";
import {
  DrawingCanvas,
  type DrawingCanvasRef,
} from "@/components/canvas/drawing-canvas";
import { getItemAsync } from "@/lib/storage";
import { LatexText } from "@/components/math/latex-text";
import { streamTutorMessage } from "@/lib/tutor-stream";
import {
  LiveTutorMessage,
  LiveTutorPanel,
} from "@/components/tutor/live-tutor-panel";
import { useCanvasActivity } from "@/hooks/useCanvasActivity";
import { useHintLevel } from "@/hooks/useHintLevel";
import { AiStatusIndicator } from "@/components/canvas/ai-status-indicator";
import { StepProgressBar } from "@/components/canvas/step-progress-bar";
import { normalizeTutorMessage } from "@/lib/parse-step-tag";

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
  const canvasRef = useRef<DrawingCanvasRef>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [tutorMessages, setTutorMessages] = useState<LiveTutorMessage[]>([]);
  const [tutorInput, setTutorInput] = useState("");
  const [isTutorStreaming, setIsTutorStreaming] = useState(false);
  const [showTutorPanel, setShowTutorPanel] = useState(false);
  const [hasUnreadTutorFeedback, setHasUnreadTutorFeedback] = useState(false);
  const [autoAnalyzeEnabled, setAutoAnalyzeEnabled] = useState(true);
  const abortRef = useRef<AbortController | null>(null);
  const sessionPromiseRef = useRef<Promise<string> | null>(null);
  const [localNudgeMessage, setLocalNudgeMessage] = useState<string | null>(null);
  const [stepProgress, setStepProgress] = useState<{ current: number; total: number } | null>(null);
  const showTutorPanelRef = useRef(showTutorPanel);

  useEffect(() => {
    showTutorPanelRef.current = showTutorPanel;
    if (showTutorPanel) {
      setHasUnreadTutorFeedback(false);
    }
  }, [showTutorPanel]);

  useEffect(() => {
    return () => { abortRef.current?.abort(); };
  }, []);

  const { data: problem, isLoading } = useQuery({
    queryKey: ["problem", problemId],
    queryFn: () =>
      api.get<{ stemText: string; stemLatex: string; subject: string }>(
        `/problems/${problemId}/student-view`,
      ),
    enabled: !!problemId,
  });

  const {
    level: hintLevel,
    reset: resetHintLevel,
    getAutoPrompt,
    escalateAndGetPrompt,
    isMaxLevel,
  } = useHintLevel(problemId!);

  const { activityState, handleStrokeEnd, handleEraserStrokeEnd, resetActivity } = useCanvasActivity({
    onAutoAnalyze: () => {
      if (!canvasRef.current?.hasContent()) return;
      setIsSubmitting(true);
      void analyzeCurrentCanvas({
        prompt: getAutoPrompt(),
        revealPanel: false,
        showStudentMessage: false,
      })
        .then(() => {
          resetActivity();
        })
        .catch(() => undefined)
        .finally(() => setIsSubmitting(false));
    },
    onNudge: (message) => {
      setLocalNudgeMessage(message);
    },
    enabled: autoAnalyzeEnabled && isTablet,
    isBusy: isSubmitting || isTutorStreaming,
  });

  useEffect(() => {
    if (activityState !== 'struggling') {
      setLocalNudgeMessage(null);
    }
  }, [activityState]);

  async function ensureSession() {
    if (sessionId) {
      return sessionId;
    }

    if (sessionPromiseRef.current) {
      return sessionPromiseRef.current;
    }

    sessionPromiseRef.current = api
      .post<{
        id: string;
        messages: Array<{ role: string; content: string }>;
      }>("/student-ai/tutor/sessions", { problemId })
      .then((session) => {
        setSessionId(session.id);
        setTutorMessages(
          session.messages.map((message, index) => {
            const normalized =
              message.role === 'tutor'
                ? normalizeTutorMessage(message.content)
                : { content: message.content };

            return {
              id: `init-${index}`,
              role: message.role as "student" | "tutor",
              content: normalized.content,
            };
          }),
        );
        return session.id;
      })
      .finally(() => {
        sessionPromiseRef.current = null;
      });

    return sessionPromiseRef.current;
  }

  async function sendTutorTurn(
    content: string,
    imageS3Key?: string,
    options?: {
      showStudentMessage?: boolean;
      revealPanel?: boolean;
    },
  ) {
    const activeSessionId = await ensureSession();
    const showStudentMessage = options?.showStudentMessage ?? true;
    const revealPanel = options?.revealPanel ?? false;
    const studentMessageId = `student-${Date.now()}`;
    const tutorMessageId = `tutor-${Date.now()}`;

    if (revealPanel) {
      setShowTutorPanel(true);
      setHasUnreadTutorFeedback(false);
    }

    setTutorMessages((prev) => {
      const next = [...prev];
      if (showStudentMessage) {
        next.push({ id: studentMessageId, role: "student", content });
      }
      next.push({ id: tutorMessageId, role: "tutor", content: "" });
      return next;
    });
    setIsTutorStreaming(true);

    try {
      abortRef.current?.abort();
      abortRef.current = new AbortController();

      const finalTutorContent = await streamTutorMessage({
        sessionId: activeSessionId,
        content,
        imageS3Key,
        signal: abortRef.current.signal,
        onChunk: (nextContent) => {
          setTutorMessages((prev) =>
            prev.map((message) =>
              message.id === tutorMessageId
                ? { ...message, content: nextContent }
                : message,
            ),
          );
        },
      });

      const normalized = normalizeTutorMessage(finalTutorContent);

      if (normalized.stepProgress) {
        setStepProgress(normalized.stepProgress);
      }

      setTutorMessages((prev) =>
        prev.map((message) =>
          message.id === tutorMessageId
            ? { ...message, content: normalized.content }
            : message,
        ),
      );
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        return;
      }

      const message =
        error instanceof Error
          ? error.message
          : "응답을 받지 못했어요. 다시 시도해주세요.";

      setTutorMessages((prev) =>
        prev.map((item) =>
          item.id === tutorMessageId
            ? { ...item, content: message }
            : item,
        ),
      );
      throw error;
    } finally {
      setIsTutorStreaming(false);
      abortRef.current = null;
      if (!showTutorPanelRef.current) {
        setHasUnreadTutorFeedback(true);
      }
    }
  }

  async function analyzeCurrentCanvas(options?: {
    prompt: string;
    revealPanel?: boolean;
    showStudentMessage?: boolean;
  }) {
    if (!canvasRef.current?.hasContent()) {
      return;
    }

    const base64 = canvasRef.current.capture();
    if (!base64) {
      return;
    }

    const uploadData = await uploadCanvasImage(base64);
    await sendTutorTurn(options?.prompt ?? getAutoPrompt(), uploadData.s3Key, {
      revealPanel: options?.revealPanel,
      showStudentMessage: options?.showStudentMessage,
    });
  }

  async function handleSubmit(imageBase64: string) {
    if (!imageBase64 || isSubmitting || isTutorStreaming) return;

    setIsSubmitting(true);
    try {
      const uploadData = await uploadCanvasImage(imageBase64);
      await sendTutorTurn("제 풀이를 확인해주세요", uploadData.s3Key, {
        revealPanel: true,
        showStudentMessage: false,
      });
      resetHintLevel();
      resetActivity();
      setLocalNudgeMessage(null);
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

  async function handleTutorSend() {
    const content = tutorInput.trim();
    if (!content || isTutorStreaming) {
      return;
    }

    setTutorInput("");
    resetHintLevel();
    setLocalNudgeMessage(null);

    try {
      await sendTutorTurn(content, undefined, {
        revealPanel: true,
        showStudentMessage: true,
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "메시지를 보내지 못했어요. 다시 시도해 주세요.";
      Alert.alert("전송 실패", message);
    }
  }

  async function handleOpenTutorOnly() {
    try {
      const activeSessionId = await ensureSession();
      router.replace(`/tutor/${activeSessionId}`);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "AI 튜터를 열지 못했어요. 다시 시도해 주세요.";
      Alert.alert("이동 실패", message);
    }
  }

  if (!isTablet) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <Stack.Screen options={{ title: "AI 튜터", headerShown: true }} />
        <View
          style={{
            flex: 1,
            justifyContent: "center",
            paddingHorizontal: 20,
            gap: 14,
          }}
        >
          <View
            style={{
              backgroundColor: colors.card,
              borderRadius: 18,
              borderWidth: 1,
              borderColor: colors.border,
              padding: 20,
              gap: 10,
            }}
          >
            <Text
              style={{
                fontSize: 18,
                fontWeight: "700",
                color: colors.textPrimary,
              }}
            >
              펜슬 풀이는 태블릿 전용입니다
            </Text>
            <Text
              style={{
                fontSize: 14,
                lineHeight: 22,
                color: colors.textMuted,
              }}
            >
              이 기기에서는 필기 캔버스 대신 AI 튜터 대화만 사용합니다. 문제를
              보면서 질문하고 힌트를 받는 흐름으로 이동할 수 있습니다.
            </Text>
          </View>

          <View style={{ gap: 10 }}>
            <Text
              style={{
                fontSize: 13,
                color: colors.textMuted,
                fontWeight: "600",
              }}
            >
              문제
            </Text>
            <View
              style={{
                backgroundColor: colors.card,
                borderRadius: 16,
                padding: 16,
                borderWidth: 1,
                borderColor: colors.border,
              }}
            >
              {isLoading ? (
                <ActivityIndicator color={colors.accent} />
              ) : (
                <LatexText style={{ fontSize: 16, lineHeight: 26 }}>
                  {problem?.stemLatex || problem?.stemText || "문제를 불러오지 못했어요."}
                </LatexText>
              )}
            </View>
          </View>

          <View style={{ gap: 10 }}>
            <Text
              style={{
                fontSize: 13,
                lineHeight: 20,
                color: colors.textMuted,
              }}
            >
              아이패드에서는 이 화면에서 바로 필기하고, 오른쪽 튜터 패널에서
              실시간 피드백을 함께 보게 할 예정입니다.
            </Text>
            <Text
              onPress={handleOpenTutorOnly}
              style={{
                backgroundColor: colors.accent,
                color: "#fff",
                fontSize: 16,
                fontWeight: "700",
                textAlign: "center",
                borderRadius: 16,
                paddingVertical: 16,
              }}
            >
              AI 튜터로 이동
            </Text>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen options={{ title: "펜슬 풀이", headerShown: true }} />
      <View
        style={{
          flex: 1,
          width: "100%",
          maxWidth: isTablet ? 960 : undefined,
          alignSelf: "center",
          paddingHorizontal: isTablet ? 24 : 16,
          paddingVertical: isTablet ? 20 : 16,
          gap: 12,
        }}
      >
        <View
          style={{
            backgroundColor: colors.card,
            borderRadius: 16,
            padding: 16,
            borderWidth: 1,
            borderColor: colors.border,
          }}
        >
          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
              marginBottom: 10,
            }}
          >
            <Text style={{ fontSize: 13, color: colors.textMuted, fontWeight: "600" }}>문제</Text>
            {problem?.subject ? (
              <Text style={{ fontSize: 12, color: colors.textMuted }}>{problem.subject}</Text>
            ) : null}
          </View>

          <ScrollView
            style={{ maxHeight: isTablet ? 240 : 180 }}
            contentContainerStyle={{ paddingBottom: 4 }}
            showsVerticalScrollIndicator={false}
          >
            {isLoading ? (
              <View style={{ paddingVertical: 12, alignItems: "center", justifyContent: "center" }}>
                <ActivityIndicator color={colors.accent} />
              </View>
            ) : (
              <LatexText style={{ fontSize: isTablet ? 18 : 16, lineHeight: isTablet ? 30 : 26 }}>
                {problem?.stemLatex || problem?.stemText || "문제를 불러오지 못했어요."}
              </LatexText>
            )}
          </ScrollView>
        </View>

        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <View style={{ gap: 4 }}>
            <Text style={{ fontSize: 13, fontWeight: "700", color: colors.textPrimary }}>
              자동 분석
            </Text>
            <Text style={{ fontSize: 12, color: colors.textMuted }}>
              짧은 멈춤에는 기다리고, 약 20초 이상 멈췄을 때만 현재 풀이를 자동 분석합니다.
            </Text>
          </View>

          <Pressable
            onPress={() => setAutoAnalyzeEnabled((prev) => !prev)}
            style={{
              paddingHorizontal: 12,
              paddingVertical: 10,
              borderRadius: 999,
              backgroundColor: autoAnalyzeEnabled ? colors.accent : colors.surface,
            }}
          >
            <Text
              style={{
                fontSize: 13,
                fontWeight: "700",
                color: autoAnalyzeEnabled ? "#fff" : colors.textPrimary,
              }}
            >
              {autoAnalyzeEnabled ? "켜짐" : "꺼짐"}
            </Text>
          </Pressable>
        </View>

        {stepProgress ? (
          <MotiView
            from={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ type: 'timing', duration: 300 }}
          >
            <StepProgressBar
              currentStep={stepProgress.current}
              totalSteps={stepProgress.total}
            />
          </MotiView>
        ) : null}

        <View
          style={{
            flex: 1,
            minHeight: 460,
          }}
        >
          <DrawingCanvas
            ref={canvasRef}
            onCapture={handleSubmit}
            toolbarPosition="bottom"
            onStrokeEnd={() => {
              setLocalNudgeMessage(null);
              handleStrokeEnd();
            }}
            onEraserStrokeEnd={() => {
              setLocalNudgeMessage(null);
              handleEraserStrokeEnd();
            }}
            onSolutionClear={() => {
              resetActivity();
              resetHintLevel();
              setLocalNudgeMessage(null);
              setStepProgress(null);
            }}
          />

          {!showTutorPanel ? (
            <View style={{ position: 'absolute', right: 16, top: 16 }}>
              <AiStatusIndicator
                activityState={activityState}
                isAnalyzing={isSubmitting}
                isStreaming={isTutorStreaming}
                hasUnread={hasUnreadTutorFeedback}
                nudgeMessage={localNudgeMessage}
                onPress={() => {
                  setShowTutorPanel(true);
                  setHasUnreadTutorFeedback(false);
                }}
              />
            </View>
          ) : null}

          {showTutorPanel ? (
            <View
              style={{
                position: "absolute",
                top: 12,
                right: 12,
                bottom: 12,
                width: Math.min(420, Math.max(340, width * 0.34)),
              }}
            >
              <LiveTutorPanel
                messages={tutorMessages}
                input={tutorInput}
                onInputChange={setTutorInput}
                onSend={handleTutorSend}
                isStreaming={isTutorStreaming}
                isTablet={isTablet}
                sessionReady={Boolean(sessionId)}
                onOpenFullScreen={
                  sessionId ? () => router.push(`/tutor/${sessionId}`) : undefined
                }
                onClose={() => setShowTutorPanel(false)}
                hintLevel={hintLevel}
                onEscalateHint={async () => {
                  if (isMaxLevel || !canvasRef.current?.hasContent()) return;
                  const prompt = escalateAndGetPrompt();
                  setLocalNudgeMessage(null);
                  setIsSubmitting(true);
                  try {
                    await analyzeCurrentCanvas({
                      prompt,
                      revealPanel: true,
                      showStudentMessage: false,
                    });
                    resetActivity();
                  } finally {
                    setIsSubmitting(false);
                  }
                }}
              />
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
}
