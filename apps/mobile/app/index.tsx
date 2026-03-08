import { Redirect } from "expo-router";
import { useAuth } from "@/lib/auth";
import { ActivityIndicator, View } from "react-native";

export default function Index() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-brand-dark">
        <ActivityIndicator size="large" color="#d4a574" />
      </View>
    );
  }

  if (!user) return <Redirect href="/(auth)/login" />;

  switch (user.role) {
    case "parent":
      return <Redirect href="/(parent)" />;
    case "teacher":
    case "admin":
      return <Redirect href="/(teacher)" />;
    default:
      return <Redirect href="/(student)" />;
  }
}
