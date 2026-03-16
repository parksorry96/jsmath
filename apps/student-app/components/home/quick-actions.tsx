import { View, Text, Pressable, useWindowDimensions } from "react-native";
import { Camera, Search, FileText, Activity, MessageCircle } from "lucide-react-native";
import { useRouter } from "expo-router";
import { useTheme } from "@/lib/theme";

const actions = [
  { icon: Camera, label: "문제 찍기", route: "/camera" },
  { icon: Search, label: "문제 검색", route: "/(tabs)/explore" },
  { icon: MessageCircle, label: "대화 기록", route: "/tutor" },
  { icon: FileText, label: "오답노트", route: "/(tabs)/study?section=wrong" },
  { icon: Activity, label: "내 약점", route: "/(tabs)/study?section=weakness" },
] as const;

export function QuickActions() {
  const router = useRouter();
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const isTablet = width > 768;

  return (
    <View style={{
      flexDirection: "row", flexWrap: "wrap",
      gap: 10,
    }}>
      {actions.map(({ icon: Icon, label, route }) => (
        <Pressable
          key={label}
          onPress={() => router.push(route as never)}
          style={{
            backgroundColor: colors.surfaceLight,
            borderRadius: 14, padding: 16, alignItems: "center",
            width: isTablet ? "30%" : "48%", flexGrow: isTablet ? 0 : 1,
          }}
        >
          <Icon color={colors.textMuted} size={24} />
          <Text style={{ fontSize: 13, color: colors.textSecondary, marginTop: 8, fontWeight: "500" }}>
            {label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}
