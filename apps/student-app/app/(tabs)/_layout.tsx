import { Tabs } from "expo-router";
import { Home, Search, BookOpen, User } from "lucide-react-native";
import { useTheme } from "@/lib/theme";

export default function TabLayout() {
  const { colors } = useTheme();

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg, elevation: 0, shadowOpacity: 0 },
        headerTintColor: colors.textPrimary,
        headerTitleStyle: { fontWeight: "700", fontSize: 18 },
        tabBarStyle: {
          backgroundColor: colors.tabBarBg,
          borderTopColor: colors.tabBarBorder,
          borderTopWidth: 1,
          height: 85,
          paddingBottom: 28,
          paddingTop: 8,
        },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarLabelStyle: { fontSize: 11, fontWeight: "500" },
      }}
    >
      <Tabs.Screen name="index" options={{
        title: "홈",
        tabBarIcon: ({ color, size }) => <Home color={color} size={size ?? 22} />,
      }} />
      <Tabs.Screen name="explore" options={{
        title: "탐색",
        tabBarIcon: ({ color, size }) => <Search color={color} size={size ?? 22} />,
      }} />
      <Tabs.Screen name="study" options={{
        title: "학습",
        tabBarIcon: ({ color, size }) => <BookOpen color={color} size={size ?? 22} />,
      }} />
      <Tabs.Screen name="profile" options={{
        title: "내정보",
        tabBarIcon: ({ color, size }) => <User color={color} size={size ?? 22} />,
      }} />
    </Tabs>
  );
}
