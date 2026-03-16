import { View, Text } from "react-native";
import { useTheme } from "@/lib/theme";

export default function ProfileScreen() {
  const { colors } = useTheme();

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: "center", alignItems: "center" }}>
      <Text style={{ fontSize: 16, color: colors.textMuted }}>내정보 탭 (준비 중)</Text>
    </View>
  );
}
