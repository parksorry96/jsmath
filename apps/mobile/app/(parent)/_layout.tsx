import { Tabs } from "expo-router";
import { Home, Calendar, Bell, BarChart3 } from "lucide-react-native";

export default function ParentLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: "#1a1a1a", elevation: 0, shadowOpacity: 0 },
        headerTintColor: "#f5f0e8",
        headerTitleStyle: { fontWeight: "600", fontSize: 17 },
        tabBarStyle: {
          backgroundColor: "#1a1a1a",
          borderTopColor: "#2a2a2a",
          borderTopWidth: 1,
          height: 85,
          paddingBottom: 28,
          paddingTop: 8,
        },
        tabBarActiveTintColor: "#d4a574",
        tabBarInactiveTintColor: "#666",
        tabBarLabelStyle: { fontSize: 11, fontWeight: "500" },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "홈",
          tabBarIcon: ({ color, size }) => <Home color={color} size={size ?? 22} />,
        }}
      />
      <Tabs.Screen
        name="calendar"
        options={{
          title: "캘린더",
          tabBarIcon: ({ color, size }) => <Calendar color={color} size={size ?? 22} />,
        }}
      />
      <Tabs.Screen
        name="dashboard"
        options={{
          title: "리포트",
          tabBarIcon: ({ color, size }) => <BarChart3 color={color} size={size ?? 22} />,
        }}
      />
      <Tabs.Screen
        name="notifications"
        options={{
          title: "알림",
          tabBarIcon: ({ color, size }) => <Bell color={color} size={size ?? 22} />,
        }}
      />
      <Tabs.Screen
        name="children/[id]"
        options={{ href: null }}
      />
    </Tabs>
  );
}
