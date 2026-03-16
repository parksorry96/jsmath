import { View, Text, Pressable, Alert } from "react-native";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";

export default function LoginScreen() {
  const { socialLogin } = useAuth();
  const { colors } = useTheme();

  async function handleKakao() {
    try {
      // Kakao OAuth flow — token exchange via AuthSession
      // For now, placeholder that will be completed with actual Kakao app keys
      Alert.alert("준비 중", "카카오 로그인은 앱 등록 후 활성화됩니다.");
    } catch {
      Alert.alert("오류", "로그인에 실패했습니다.");
    }
  }

  async function handleApple() {
    try {
      Alert.alert("준비 중", "Apple 로그인은 앱 등록 후 활성화됩니다.");
    } catch {
      Alert.alert("오류", "로그인에 실패했습니다.");
    }
  }

  async function handleGoogle() {
    try {
      Alert.alert("준비 중", "Google 로그인은 앱 등록 후 활성화됩니다.");
    } catch {
      Alert.alert("오류", "로그인에 실패했습니다.");
    }
  }

  const btnStyle = {
    borderRadius: 16, paddingVertical: 16, paddingHorizontal: 24,
    marginBottom: 12, alignItems: "center" as const, flexDirection: "row" as const,
    justifyContent: "center" as const, gap: 8,
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: "center", padding: 32 }}>
      <Text style={{ fontSize: 24, fontWeight: "800", color: colors.textPrimary, textAlign: "center", marginBottom: 48 }}>
        로그인
      </Text>

      <Pressable onPress={handleKakao} style={{ ...btnStyle, backgroundColor: "#FEE500" }}>
        <Text style={{ fontSize: 16, fontWeight: "600", color: "#191919" }}>카카오로 시작하기</Text>
      </Pressable>

      <Pressable onPress={handleApple} style={{ ...btnStyle, backgroundColor: "#000" }}>
        <Text style={{ fontSize: 16, fontWeight: "600", color: "#fff" }}>Apple로 시작하기</Text>
      </Pressable>

      <Pressable onPress={handleGoogle} style={{ ...btnStyle, backgroundColor: "#fff", borderWidth: 1, borderColor: colors.border }}>
        <Text style={{ fontSize: 16, fontWeight: "600", color: colors.textPrimary }}>Google로 시작하기</Text>
      </Pressable>
    </View>
  );
}
