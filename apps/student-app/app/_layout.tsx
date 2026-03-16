import "../global.css";
import { Stack, useRouter, useSegments } from "expo-router";
import { useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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

    if (!user && !inAuth) {
      router.replace("/(auth)/welcome");
    } else if (user && inAuth && !isNewUser) {
      router.replace("/(tabs)");
    } else if (user && isNewUser) {
      router.replace("/(auth)/onboarding");
    }
  }, [user, isLoading, isNewUser, segments]);

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="camera" options={{ headerShown: true, title: "문제 촬영", presentation: "modal" }} />
      <Stack.Screen name="problem/[id]" options={{ headerShown: true, title: "문제" }} />
      <Stack.Screen name="tutor/[sessionId]" options={{ headerShown: true, title: "AI 튜터" }} />
      <Stack.Screen name="canvas/[problemId]" options={{ headerShown: true, title: "펜슬 풀이" }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ThemeProvider>
          <RootNavigator />
        </ThemeProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
