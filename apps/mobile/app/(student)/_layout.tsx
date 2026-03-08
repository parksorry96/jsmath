import { Tabs } from "expo-router";
import { Home, Calendar, ClipboardList, BarChart3 } from "lucide-react-native";

export default function StudentLayout() {
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
        name="assignments"
        options={{
          title: "과제",
          tabBarIcon: ({ color, size }) => <ClipboardList color={color} size={size ?? 22} />,
        }}
      />
      <Tabs.Screen
        name="report"
        options={{
          title: "성적",
          tabBarIcon: ({ color, size }) => <BarChart3 color={color} size={size ?? 22} />,
        }}
      />
      <Tabs.Screen
        name="assignment/[id]"
        options={{
          href: null,
          title: "과제 상세",
        }}
      />
    </Tabs>
  );
}
