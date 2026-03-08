import "../global.css";

import { useEffect } from "react";
import { Slot, useRouter, useSegments } from "expo-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider, useAuth } from "@/lib/auth";

const queryClient = new QueryClient();

function RootNavigator() {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    if (isLoading) return;

    const inAuth = segments[0] === "(auth)";

    if (!user && !inAuth) {
      router.replace("/(auth)/login");
    } else if (user && inAuth) {
      const roleRoute = getRoleRoute(user.role);
      router.replace(roleRoute);
    }
  }, [user, isLoading, segments]);

  return <Slot />;
}

function getRoleRoute(role: string): "/" {
  switch (role) {
    case "parent":
      return "/(parent)" as "/";
    case "teacher":
    case "admin":
      return "/(teacher)" as "/";
    default:
      return "/(student)" as "/";
  }
}

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RootNavigator />
      </AuthProvider>
    </QueryClientProvider>
  );
}
