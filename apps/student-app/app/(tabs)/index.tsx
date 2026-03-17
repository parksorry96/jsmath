import { ScrollView, View, Text, useWindowDimensions } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";
import { StreakCard } from "@/components/home/streak-card";
import { ReviewCard } from "@/components/home/review-card";
import { QuickActions } from "@/components/home/quick-actions";

export default function HomeScreen() {
  const { colors } = useTheme();
  const { user } = useAuth();
  const { width } = useWindowDimensions();
  const isTablet = width > 768;
  const padding = isTablet ? 32 : 20;

  const { data: gamification } = useQuery({
    queryKey: ["gamification"],
    queryFn: () => api.get<{ level: number; xp: number; streak: number }>("/gamification/profile"),
    enabled: !!user,
  });

  const { data: reviewStats } = useQuery({
    queryKey: ["review-stats"],
    queryFn: () => api.get<{ todayDue: number; todayCompleted: number }>("/student-ai/reviews/stats"),
    enabled: !!user,
  });

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding, gap: 20, ...(isTablet && { maxWidth: 800, alignSelf: "center", width: "100%" }) }}>
      <View>
        <Text style={{ fontSize: 22, fontWeight: "800", color: colors.textPrimary }}>
          오늘도 같이 풀어볼까?
        </Text>
        <View style={{ marginTop: 8 }}>
          <StreakCard streak={gamification?.streak ?? 0} />
        </View>
      </View>

      <ReviewCard
        dueCount={reviewStats?.todayDue ?? 0}
        completedCount={reviewStats?.todayCompleted ?? 0}
      />

      <View>
        <Text style={{ fontSize: 16, fontWeight: "700", color: colors.textPrimary, marginBottom: 12 }}>
          바로 시작
        </Text>
        <QuickActions />
      </View>

      {/* Level progress */}
      {gamification && (
        <View style={{ backgroundColor: colors.surface, borderRadius: 12, padding: 14 }}>
          <Text style={{ fontSize: 12, color: colors.textMuted }}>
            Lv.{gamification.level} · {gamification.xp} XP
          </Text>
          <View style={{ backgroundColor: colors.border, height: 4, borderRadius: 2, marginTop: 8 }}>
            <View style={{
              backgroundColor: colors.accent, height: 4, borderRadius: 2,
              width: `${(gamification.xp % 100)}%`,
            }} />
          </View>
        </View>
      )}
    </ScrollView>
  );
}
