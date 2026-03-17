import { View, Text, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { BookOpen } from "lucide-react-native";
import { useTheme } from "@/lib/theme";

export default function WelcomeScreen() {
  const router = useRouter();
  const { colors } = useTheme();

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: "center", alignItems: "center", padding: 32 }}>
      <BookOpen color={colors.accent} size={64} strokeWidth={1.5} />
      <Text style={{ fontSize: 28, fontWeight: "800", color: colors.textPrimary, marginTop: 24 }}>
        JSMath
      </Text>
      <Text style={{ fontSize: 16, color: colors.textSecondary, marginTop: 8, textAlign: "center" }}>
        수학 문제 찍고, 물어보고, 약점 잡기
      </Text>
      <Pressable
        onPress={() => router.push("/(auth)/login")}
        style={{
          backgroundColor: colors.accent, borderRadius: 28,
          paddingVertical: 16, paddingHorizontal: 48, marginTop: 48,
        }}
      >
        <Text style={{ color: "#fff", fontSize: 16, fontWeight: "700" }}>시작하기</Text>
      </Pressable>
    </View>
  );
}
