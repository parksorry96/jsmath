import { useState, useRef } from "react";
import { View, TextInput, Pressable, FlatList, KeyboardAvoidingView, Platform } from "react-native";
import { useLocalSearchParams, Stack } from "expo-router";
import { Send, Camera } from "lucide-react-native";
import { useTheme } from "@/lib/theme";
import { useTutorChat } from "@/hooks/useTutorChat";
import { ChatBubble } from "@/components/tutor/chat-bubble";

export default function TutorChatScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const [input, setInput] = useState("");
  const { colors } = useTheme();
  const { messages, isStreaming, sendMessage } = useTutorChat(sessionId);
  const flatListRef = useRef<FlatList>(null);

  function handleSend() {
    if (!input.trim() || isStreaming) return;
    sendMessage(input.trim());
    setInput("");
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.bg }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={90}
    >
      <Stack.Screen options={{ title: "AI 튜터", headerShown: true }} />

      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={(m) => m.id}
        renderItem={({ item }) => <ChatBubble role={item.role} content={item.content} />}
        contentContainerStyle={{ paddingVertical: 16 }}
        onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
      />

      {/* Input bar */}
      <View style={{
        flexDirection: "row", alignItems: "center", gap: 8,
        padding: 12, borderTopWidth: 1, borderTopColor: colors.border,
        backgroundColor: colors.card,
      }}>
        <Pressable style={{ padding: 8 }}>
          <Camera color={colors.textMuted} size={22} />
        </Pressable>
        <TextInput
          value={input}
          onChangeText={setInput}
          placeholder="메시지를 입력하세요..."
          placeholderTextColor={colors.textMuted}
          multiline
          maxLength={2000}
          style={{
            flex: 1, backgroundColor: colors.surface, borderRadius: 20,
            paddingHorizontal: 16, paddingVertical: 10, color: colors.textPrimary,
            fontSize: 15, maxHeight: 100,
          }}
          onSubmitEditing={handleSend}
        />
        <Pressable onPress={handleSend} disabled={isStreaming || !input.trim()} style={{ padding: 8 }}>
          <Send color={input.trim() ? colors.accent : colors.textMuted} size={22} />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}
