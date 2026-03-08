import { Tabs } from "expo-router";
import { Text } from "react-native";

export default function TeacherLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: "#1a1a1a" },
        headerTintColor: "#f5f0e8",
        tabBarStyle: { backgroundColor: "#1a1a1a", borderTopColor: "#333" },
        tabBarActiveTintColor: "#d4a574",
        tabBarInactiveTintColor: "#888",
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "홈",
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 20 }}>🏠</Text>,
        }}
      />
      <Tabs.Screen
        name="calendar"
        options={{
          title: "캘린더",
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 20 }}>📅</Text>,
        }}
      />
      <Tabs.Screen
        name="classes"
        options={{
          title: "반 관리",
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 20 }}>👥</Text>,
        }}
      />
      <Tabs.Screen
        name="grading"
        options={{
          title: "채점",
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 20 }}>✏️</Text>,
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
