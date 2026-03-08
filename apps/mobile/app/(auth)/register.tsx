import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from "react-native";
import { Link } from "expo-router";
import { useAuth } from "@/lib/auth";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function RegisterScreen() {
  const { register } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"student" | "parent">("student");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function validate(): string | null {
    if (!name.trim()) return "이름을 입력해주세요.";
    if (!email.trim()) return "이메일을 입력해주세요.";
    if (!EMAIL_REGEX.test(email.trim())) return "올바른 이메일 형식이 아닙니다.";
    if (password.length < 8) return "비밀번호는 8자 이상이어야 합니다.";
    return null;
  }

  async function handleRegister() {
    setError("");
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setLoading(true);
    try {
      await register({
        name: name.trim(),
        email: email.trim(),
        password,
        role,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "회원가입에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-brand-dark"
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        contentContainerClassName="flex-grow justify-center px-8 py-12"
        keyboardShouldPersistTaps="handled"
      >
        {/* Logo / Branding */}
        <View className="items-center mb-10">
          <Text className="text-brand-accent text-4xl font-bold">JSMath</Text>
          <Text className="text-brand-beige/60 text-base mt-2">회원가입</Text>
        </View>

        {/* Error */}
        {error ? (
          <View className="bg-red-900/30 border border-red-500/50 rounded-lg px-4 py-3 mb-4">
            <Text className="text-red-400 text-sm text-center">{error}</Text>
          </View>
        ) : null}

        {/* Name */}
        <Text className="text-brand-beige/80 text-sm mb-2 ml-1">이름</Text>
        <TextInput
          className="bg-white/10 text-brand-beige rounded-lg px-4 py-3.5 mb-4 text-base"
          placeholder="홍길동"
          placeholderTextColor="#888"
          value={name}
          onChangeText={setName}
          autoCapitalize="words"
          autoComplete="name"
          editable={!loading}
        />

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
        <Text className="text-brand-beige/80 text-sm mb-2 ml-1">
          비밀번호 (8자 이상)
        </Text>
        <TextInput
          className="bg-white/10 text-brand-beige rounded-lg px-4 py-3.5 mb-6 text-base"
          placeholder="비밀번호"
          placeholderTextColor="#888"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="new-password"
          editable={!loading}
        />

        {/* Role Selector */}
        <Text className="text-brand-beige/80 text-sm mb-3 ml-1">역할</Text>
        <View className="flex-row mb-6 gap-3">
          <TouchableOpacity
            className={`flex-1 rounded-lg py-3 items-center border ${
              role === "student"
                ? "bg-brand-accent border-brand-accent"
                : "bg-white/5 border-white/20"
            }`}
            onPress={() => setRole("student")}
            disabled={loading}
            activeOpacity={0.8}
          >
            <Text
              className={`font-semibold ${
                role === "student" ? "text-brand-dark" : "text-brand-beige/70"
              }`}
            >
              학생
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            className={`flex-1 rounded-lg py-3 items-center border ${
              role === "parent"
                ? "bg-brand-accent border-brand-accent"
                : "bg-white/5 border-white/20"
            }`}
            onPress={() => setRole("parent")}
            disabled={loading}
            activeOpacity={0.8}
          >
            <Text
              className={`font-semibold ${
                role === "parent" ? "text-brand-dark" : "text-brand-beige/70"
              }`}
            >
              학부모
            </Text>
          </TouchableOpacity>
        </View>

        {/* Register Button */}
        <TouchableOpacity
          className={`rounded-lg py-4 items-center ${loading ? "bg-brand-accent/50" : "bg-brand-accent"}`}
          onPress={handleRegister}
          disabled={loading}
          activeOpacity={0.8}
        >
          {loading ? (
            <ActivityIndicator color="#1a1a1a" />
          ) : (
            <Text className="text-brand-dark font-bold text-base">
              회원가입
            </Text>
          )}
        </TouchableOpacity>

        {/* Login Link */}
        <View className="flex-row justify-center mt-6">
          <Text className="text-brand-beige/60">이미 계정이 있으신가요? </Text>
          <Link href="/(auth)/login" asChild>
            <TouchableOpacity>
              <Text className="text-brand-accent font-semibold">로그인</Text>
            </TouchableOpacity>
          </Link>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
