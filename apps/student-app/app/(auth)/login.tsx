import { useState } from "react";
import { View, Text, TextInput, Pressable, Alert } from "react-native";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";

export default function LoginScreen() {
  const { login } = useAuth();
  const { colors } = useTheme();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleLogin() {
    const normalizedEmail = email.trim();
    if (!normalizedEmail || !password) return;
    setLoading(true);
    try {
      await login(normalizedEmail, password);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "이메일 또는 비밀번호를 확인해주세요.";
      Alert.alert("로그인 실패", message);
    } finally {
      setLoading(false);
    }
  }

  const btnStyle = {
    borderRadius: 16, paddingVertical: 16, paddingHorizontal: 24,
    marginBottom: 12, alignItems: "center" as const, flexDirection: "row" as const,
    justifyContent: "center" as const, gap: 8,
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: "center", padding: 32 }}>
      <Text style={{ fontSize: 24, fontWeight: "800", color: colors.textPrimary, textAlign: "center", marginBottom: 32 }}>
        로그인
      </Text>

      {/* Email/Password login */}
      <TextInput
        value={email}
        onChangeText={setEmail}
        placeholder="이메일"
        placeholderTextColor={colors.textMuted}
        autoCapitalize="none"
        keyboardType="email-address"
        style={{
          backgroundColor: colors.surface, borderRadius: 12, padding: 16,
          color: colors.textPrimary, fontSize: 15, marginBottom: 10,
        }}
      />
      <TextInput
        value={password}
        onChangeText={setPassword}
        placeholder="비밀번호"
        placeholderTextColor={colors.textMuted}
        secureTextEntry
        style={{
          backgroundColor: colors.surface, borderRadius: 12, padding: 16,
          color: colors.textPrimary, fontSize: 15, marginBottom: 16,
        }}
      />
      <Pressable
        onPress={handleLogin}
        disabled={loading}
        style={{
          backgroundColor: colors.accent, borderRadius: 16,
          paddingVertical: 16, alignItems: "center", marginBottom: 32,
          opacity: loading ? 0.6 : 1,
        }}
      >
        <Text style={{ fontSize: 16, fontWeight: "700", color: "#fff" }}>
          {loading ? "로그인 중..." : "로그인"}
        </Text>
      </Pressable>

      {/* Divider */}
      <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 24 }}>
        <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
        <Text style={{ marginHorizontal: 12, color: colors.textMuted, fontSize: 13 }}>또는</Text>
        <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
      </View>

      {/* Social login */}
      <Pressable onPress={() => Alert.alert("준비 중", "카카오 로그인은 앱 등록 후 활성화됩니다.")} style={{ ...btnStyle, backgroundColor: "#FEE500" }}>
        <Text style={{ fontSize: 16, fontWeight: "600", color: "#191919" }}>카카오로 시작하기</Text>
      </Pressable>

      <Pressable onPress={() => Alert.alert("준비 중", "Apple 로그인은 앱 등록 후 활성화됩니다.")} style={{ ...btnStyle, backgroundColor: "#000" }}>
        <Text style={{ fontSize: 16, fontWeight: "600", color: "#fff" }}>Apple로 시작하기</Text>
      </Pressable>

      <Pressable onPress={() => Alert.alert("준비 중", "Google 로그인은 앱 등록 후 활성화됩니다.")} style={{ ...btnStyle, backgroundColor: "#fff", borderWidth: 1, borderColor: colors.border }}>
        <Text style={{ fontSize: 16, fontWeight: "600", color: colors.textPrimary }}>Google로 시작하기</Text>
      </Pressable>
    </View>
  );
}
