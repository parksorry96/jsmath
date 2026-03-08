import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { Link } from "expo-router";
import { useAuth } from "@/lib/auth";

export default function LoginScreen() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleLogin() {
    setError("");
    if (!email.trim() || !password) {
      setError("이메일과 비밀번호를 입력해주세요.");
      return;
    }

    setLoading(true);
    try {
      await login(email.trim(), password);
    } catch (e) {
      setError(e instanceof Error ? e.message : "로그인에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-brand-dark"
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <View className="flex-1 justify-center px-8">
        {/* Logo / Branding */}
        <View className="items-center mb-12">
          <Text className="text-brand-accent text-4xl font-bold">JSMath</Text>
          <Text className="text-brand-beige/60 text-base mt-2">
            수학 문제은행 플랫폼
          </Text>
        </View>

        {/* Error */}
        {error ? (
          <View className="bg-red-900/30 border border-red-500/50 rounded-lg px-4 py-3 mb-4">
            <Text className="text-red-400 text-sm text-center">{error}</Text>
          </View>
        ) : null}

        {/* Email */}
        <Text className="text-brand-beige/80 text-sm mb-2 ml-1">이메일</Text>
        <TextInput
          className="bg-white/10 text-brand-beige rounded-lg px-4 py-3.5 mb-4 text-base"
          placeholder="email@example.com"
          placeholderTextColor="#888"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          editable={!loading}
        />

        {/* Password */}
        <Text className="text-brand-beige/80 text-sm mb-2 ml-1">비밀번호</Text>
        <TextInput
          className="bg-white/10 text-brand-beige rounded-lg px-4 py-3.5 mb-6 text-base"
          placeholder="비밀번호"
          placeholderTextColor="#888"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="password"
          editable={!loading}
          onSubmitEditing={handleLogin}
        />

        {/* Login Button */}
        <TouchableOpacity
          className={`rounded-lg py-4 items-center ${loading ? "bg-brand-accent/50" : "bg-brand-accent"}`}
          onPress={handleLogin}
          disabled={loading}
          activeOpacity={0.8}
        >
          {loading ? (
            <ActivityIndicator color="#1a1a1a" />
          ) : (
            <Text className="text-brand-dark font-bold text-base">로그인</Text>
          )}
        </TouchableOpacity>

        {/* Register Link */}
        <View className="flex-row justify-center mt-6">
          <Text className="text-brand-beige/60">계정이 없으신가요? </Text>
          <Link href="/(auth)/register" asChild>
            <TouchableOpacity>
              <Text className="text-brand-accent font-semibold">회원가입</Text>
            </TouchableOpacity>
          </Link>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
