import { View, Text, Pressable } from "react-native";
import { RotateCcw } from "lucide-react-native";
import { useRouter } from "expo-router";
import { useTheme } from "@/lib/theme";

interface ReviewCardProps {
  dueCount: number;
  completedCount: number;
}

export function ReviewCard({ dueCount, completedCount }: ReviewCardProps) {
  const router = useRouter();
  const { colors } = useTheme();
  const total = dueCount + completedCount;
  const progress = total > 0 ? completedCount / total : 0;

  if (total === 0) return null;

  return (
    <Pressable
      onPress={() => router.push("/(tabs)/study?section=review")}
      style={{ backgroundColor: colors.surface, borderRadius: 16, padding: 16 }}
    >
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <RotateCcw color={colors.accent} size={16} />
            <Text style={{ fontSize: 13, color: colors.textMuted }}>오늘의 복습</Text>
          </View>
          <Text style={{ fontSize: 20, fontWeight: "800", color: colors.textPrimary, marginTop: 4 }}>
            {dueCount}문제
          </Text>
        </View>
        <View style={{ backgroundColor: colors.accent, borderRadius: 20, paddingVertical: 8, paddingHorizontal: 20 }}>
          <Text style={{ color: "#fff", fontSize: 13, fontWeight: "700" }}>시작하기</Text>
        </View>
      </View>
      <View style={{ backgroundColor: colors.border, height: 4, borderRadius: 2, marginTop: 12 }}>
        <View style={{ backgroundColor: colors.accent, height: 4, borderRadius: 2, width: `${progress * 100}%` }} />
      </View>
    </Pressable>
  );
}
