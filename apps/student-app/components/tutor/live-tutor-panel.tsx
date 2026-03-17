import { useMemo, useRef } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { Expand, Send, X } from "lucide-react-native";
import { useTheme } from "@/lib/theme";
import { ChatBubble } from "@/components/tutor/chat-bubble";

export interface LiveTutorMessage {
  id: string;
  role: "student" | "tutor";
  content: string;
}

interface LiveTutorPanelProps {
  messages: LiveTutorMessage[];
  input: string;
  onInputChange: (value: string) => void;
  onSend: () => void;
  isStreaming: boolean;
  isTablet: boolean;
  sessionReady: boolean;
  onOpenFullScreen?: () => void;
  onClose?: () => void;
  hintLevel?: 0 | 1 | 2 | 3;
  onEscalateHint?: () => void;
}

export function LiveTutorPanel({
  messages,
  input,
  onInputChange,
  onSend,
  isStreaming,
  isTablet,
  sessionReady,
  onOpenFullScreen,
  onClose,
  hintLevel,
  onEscalateHint,
}: LiveTutorPanelProps) {
  const { colors } = useTheme();
  const flatListRef = useRef<FlatList>(null);

  const helperText = useMemo(() => {
    if (isStreaming) {
      return "AI가 현재 풀이를 읽고 있습니다.";
    }
    if (sessionReady) {
      return "같은 화면에서 질문과 풀이 제출을 이어갈 수 있습니다.";
    }
    return "풀이를 제출하거나 질문을 보내면 여기서 바로 피드백이 이어집니다.";
  }, [isStreaming, sessionReady]);

  return (
    <View
      style={{
        flex: 1,
        minHeight: isTablet ? undefined : 260,
        backgroundColor: colors.card,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: colors.border,
        overflow: "hidden",
      }}
    >
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          paddingHorizontal: 14,
          paddingVertical: 12,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
        }}
      >
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ fontSize: 14, fontWeight: "700", color: colors.textPrimary }}>
            AI 피드백
          </Text>
          <Text style={{ fontSize: 12, color: colors.textMuted }}>
            {helperText}
          </Text>
        </View>

        {sessionReady && onEscalateHint ? (
          <Pressable
            onPress={onEscalateHint}
            disabled={hintLevel === 3 || isStreaming}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: 999,
              paddingHorizontal: 10,
              paddingVertical: 8,
              opacity: hintLevel === 3 || isStreaming ? 0.4 : 1,
            }}
          >
            <View style={{ flexDirection: 'row', gap: 3 }}>
              {[0, 1, 2, 3].map((i) => (
                <View
                  key={i}
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: 3,
                    backgroundColor: i <= (hintLevel ?? 0) ? colors.accent : colors.border,
                  }}
                />
              ))}
            </View>
            <Text style={{ fontSize: 12, fontWeight: '600', color: colors.textPrimary }}>
              더 자세한 힌트
            </Text>
          </Pressable>
        ) : null}

        {sessionReady && onOpenFullScreen ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Pressable
              onPress={onOpenFullScreen}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: 999,
                paddingHorizontal: 10,
                paddingVertical: 8,
              }}
            >
              <Expand color={colors.textMuted} size={14} />
              <Text style={{ fontSize: 12, fontWeight: "600", color: colors.textPrimary }}>
                전체 보기
              </Text>
            </Pressable>

            {onClose ? (
              <Pressable
                onPress={onClose}
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 17,
                  alignItems: "center",
                  justifyContent: "center",
                  borderWidth: 1,
                  borderColor: colors.border,
                }}
              >
                <X color={colors.textMuted} size={16} />
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={isTablet ? 72 : 92}
      >
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <ChatBubble role={item.role} content={item.content} />
          )}
          contentContainerStyle={{ paddingVertical: 16 }}
          onContentSizeChange={() =>
            flatListRef.current?.scrollToEnd({ animated: true })
          }
          ListEmptyComponent={
            <View style={{ padding: 24, gap: 8 }}>
              <Text style={{ fontSize: 14, fontWeight: "600", color: colors.textPrimary }}>
                아직 피드백이 없습니다
              </Text>
              <Text style={{ fontSize: 13, lineHeight: 20, color: colors.textMuted }}>
                현재 풀이를 제출하면 AI가 어느 줄에서 막혔는지, 계산 실수 가능성이
                있는지 같은 화면에서 바로 짚어줍니다.
              </Text>
            </View>
          }
        />

        <View
          style={{
            flexDirection: "row",
            alignItems: "flex-end",
            gap: 8,
            padding: 12,
            borderTopWidth: 1,
            borderTopColor: colors.border,
            backgroundColor: colors.card,
          }}
        >
          <TextInput
            value={input}
            onChangeText={onInputChange}
            placeholder="질문을 입력하세요..."
            placeholderTextColor={colors.textMuted}
            multiline
            maxLength={2000}
            editable={!isStreaming}
            style={{
              flex: 1,
              minHeight: 42,
              maxHeight: 100,
              backgroundColor: colors.surface,
              borderRadius: 20,
              paddingHorizontal: 16,
              paddingVertical: 10,
              color: colors.textPrimary,
              fontSize: 15,
            }}
          />

          <Pressable
            onPress={onSend}
            disabled={isStreaming || !input.trim()}
            style={{
              width: 42,
              height: 42,
              borderRadius: 21,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor:
                isStreaming || !input.trim() ? colors.surface : colors.accent,
            }}
          >
            {isStreaming ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Send
                color={
                  input.trim() ? "#fff" : colors.textMuted
                }
                size={18}
              />
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}
