import { View, Text } from "react-native";
import { Flame } from "lucide-react-native";
import { useTheme } from "@/lib/theme";

export function StreakCard({ streak }: { streak: number }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <Flame color={streak > 0 ? colors.accent : colors.textMuted} size={20} />
      <Text style={{ fontSize: 14, color: colors.textSecondary, fontWeight: "500" }}>
        {streak > 0 ? `${streak}일 연속 학습 중` : "오늘 첫 학습을 시작해보세요"}
      </Text>
    </View>
  );
}
