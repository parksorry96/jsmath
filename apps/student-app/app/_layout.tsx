import "../global.css";
import { Stack, useRouter, useSegments } from "expo-router";
import { useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { AuthProvider, useAuth } from "@/lib/auth";
import { ThemeProvider } from "@/lib/theme";

const queryClient = new QueryClient();

function RootNavigator() {
  const { user, isLoading, isNewUser } = useAuth();
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    if (isLoading) return;
    const inAuth = segments[0] === "(auth)";
    const authScreen = (segments as string[])[1];
    const isOnboardingScreen = inAuth && authScreen === "onboarding";

    if (!user && !inAuth) {
      router.replace("/(auth)/welcome");
    } else if (!user && isOnboardingScreen) {
      router.replace("/(auth)/welcome");
    } else if (user && isNewUser && !isOnboardingScreen) {
      router.replace("/(auth)/onboarding");
    } else if (user && inAuth && !isOnboardingScreen) {
      router.replace("/(tabs)");
    }
  }, [isLoading, isNewUser, router, segments, user]);

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="camera" options={{ headerShown: true, title: "문제 촬영", presentation: "modal" }} />
      <Stack.Screen name="problem/[id]" options={{ headerShown: true, title: "문제" }} />
      <Stack.Screen name="tutor/index" options={{ headerShown: true, title: "대화 기록" }} />
      <Stack.Screen name="tutor/[sessionId]" options={{ headerShown: true, title: "AI 튜터" }} />
      <Stack.Screen name="canvas/[problemId]" options={{ headerShown: true, title: "펜슬 풀이" }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <ThemeProvider>
            <RootNavigator />
          </ThemeProvider>
        </AuthProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}
