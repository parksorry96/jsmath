import { Tabs } from "expo-router";
import { Home, Calendar, Users, PenLine } from "lucide-react-native";

export default function TeacherLayout() {
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
        name="classes"
        options={{
          title: "반 관리",
          tabBarIcon: ({ color, size }) => <Users color={color} size={size ?? 22} />,
        }}
      />
      <Tabs.Screen
        name="grading"
        options={{
          title: "채점",
          tabBarIcon: ({ color, size }) => <PenLine color={color} size={size ?? 22} />,
        }}
      />
      <Tabs.Screen
        name="class/[id]"
        options={{ href: null, title: "반 상세" }}
      />
      <Tabs.Screen
        name="assignment/new"
        options={{ href: null, title: "과제 출제" }}
      />
    </Tabs>
  );
}
