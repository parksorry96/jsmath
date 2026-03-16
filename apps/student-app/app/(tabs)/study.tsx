import { View, Text } from "react-native";
import { useTheme } from "@/lib/theme";

export default function StudyScreen() {
  const { colors } = useTheme();

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: "center", alignItems: "center" }}>
      <Text style={{ fontSize: 16, color: colors.textMuted }}>학습 탭 (준비 중)</Text>
    </View>
  );
}
