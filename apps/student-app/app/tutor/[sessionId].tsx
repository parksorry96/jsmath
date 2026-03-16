import { useState, useRef } from "react";
import { View, Text, TextInput, Pressable, FlatList, KeyboardAvoidingView, Platform, ScrollView, useWindowDimensions, ActivityIndicator } from "react-native";
import { useLocalSearchParams, Stack } from "expo-router";
import { Send, Camera } from "lucide-react-native";
import { useTheme } from "@/lib/theme";
import { useTutorChat } from "@/hooks/useTutorChat";
import { ChatBubble } from "@/components/tutor/chat-bubble";
import { LatexText } from "@/components/math/latex-text";

export default function TutorChatScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const [input, setInput] = useState("");
  const { colors } = useTheme();
  const { messages, problem, isStreaming, isLoading, sendMessage } = useTutorChat(sessionId);
  const flatListRef = useRef<FlatList>(null);
  const { width } = useWindowDimensions();
  const isTablet = width > 768;

  function handleSend() {
    if (!input.trim() || isStreaming) return;
    sendMessage(input.trim());
    setInput("");
  }

  if (isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: "center", alignItems: "center" }}>
        <Stack.Screen options={{ title: "AI 튜터", headerShown: true }} />
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  const chatArea = (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.bg }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={90}
    >
      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={(m) => m.id}
        renderItem={({ item }) => <ChatBubble role={item.role} content={item.content} />}
        contentContainerStyle={{ paddingVertical: 16 }}
        onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
        ListEmptyComponent={
          <View style={{ padding: 40, alignItems: "center" }}>
            <Text style={{ color: colors.textMuted }}>메시지를 보내서 대화를 시작하세요</Text>
          </View>
        }
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
          blurOnSubmit={false}
          submitBehavior="submit"
          onSubmitEditing={handleSend}
          style={{
            flex: 1, backgroundColor: colors.surface, borderRadius: 20,
            paddingHorizontal: 16, paddingVertical: 10, color: colors.textPrimary,
            fontSize: 15, maxHeight: 100,
          }}
        />
        <Pressable onPress={handleSend} disabled={isStreaming || !input.trim()} style={{ padding: 8 }}>
          <Send color={input.trim() ? colors.accent : colors.textMuted} size={22} />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );

  // iPad: Top-bottom split — problem on top, chat on bottom
  if (isTablet && problem) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <Stack.Screen options={{ title: "AI 튜터", headerShown: true }} />

        {/* Top: Problem (collapsible) */}
        <ScrollView
          style={{
            maxHeight: 340, borderBottomWidth: 1, borderBottomColor: colors.border,
          }}
          contentContainerStyle={{
            padding: 20, maxWidth: 800, alignSelf: "center", width: "100%",
          }}
        >
          <View style={{ flexDirection: "row", gap: 6, marginBottom: 10 }}>
            {problem.subject && (
              <View style={{ backgroundColor: colors.surface, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 }}>
                <Text style={{ fontSize: 12, color: colors.textSecondary }}>{problem.subject}</Text>
              </View>
            )}
            {problem.unitMajor && (
              <View style={{ backgroundColor: colors.surface, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 }}>
                <Text style={{ fontSize: 12, color: colors.textSecondary }}>{problem.unitMajor}</Text>
              </View>
            )}
          </View>
          <View style={{ backgroundColor: colors.card, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: colors.border }}>
            <LatexText style={{ fontSize: 15, lineHeight: 26 }}>
              {problem.stemLatex || problem.stemText}
            </LatexText>
          </View>
        </ScrollView>

        {/* Bottom: Chat */}
        <View style={{ flex: 1 }}>
          {chatArea}
        </View>
      </View>
    );
  }

  // Phone: Full-screen chat
  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ title: "AI 튜터", headerShown: true }} />
      {/* Problem banner on phone */}
      {problem && (
        <Pressable
          style={{
            backgroundColor: colors.surface, padding: 12,
            borderBottomWidth: 1, borderBottomColor: colors.border,
          }}
        >
          <Text numberOfLines={2} style={{ fontSize: 13, color: colors.textSecondary, lineHeight: 18 }}>
            {problem.stemText?.slice(0, 100) || problem.stemLatex?.slice(0, 100)}...
          </Text>
        </Pressable>
      )}
      {chatArea}
    </View>
  );
}
