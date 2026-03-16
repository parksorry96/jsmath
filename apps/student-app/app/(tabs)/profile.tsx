import { View, Text, ScrollView, Pressable, Switch } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { LogOut, Moon, Flame, Trophy, Target } from "lucide-react-native";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";

export default function ProfileScreen() {
  const { user, logout } = useAuth();
  const { colors, isDark, mode, setMode } = useTheme();
  const router = useRouter();

  const { data: gamification } = useQuery({
    queryKey: ["gamification"],
    queryFn: () => api.get<{ level: number; xp: number; streak: number }>("/gamification/profile"),
  });

  const { data: achievements } = useQuery({
    queryKey: ["achievements"],
    queryFn: () => api.get<Array<{ id: string; title: string; earned: boolean }>>("/gamification/achievements"),
  });

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 20, gap: 20 }}>
      {/* Profile card */}
      <View style={{ backgroundColor: colors.card, borderRadius: 16, padding: 20, borderWidth: 1, borderColor: colors.border, alignItems: "center" }}>
        <View style={{
          width: 64, height: 64, borderRadius: 32, backgroundColor: colors.accent,
          alignItems: "center", justifyContent: "center",
        }}>
          <Text style={{ color: "#fff", fontSize: 24, fontWeight: "800" }}>
            {user?.email?.[0]?.toUpperCase() ?? "?"}
          </Text>
        </View>
        <Text style={{ fontSize: 18, fontWeight: "700", color: colors.textPrimary, marginTop: 12 }}>
          {user?.email}
        </Text>
        {gamification && (
          <View style={{ flexDirection: "row", gap: 16, marginTop: 12 }}>
            <View style={{ alignItems: "center" }}>
              <Target color={colors.accent} size={18} />
              <Text style={{ fontSize: 14, fontWeight: "700", color: colors.textPrimary }}>Lv.{gamification.level}</Text>
            </View>
            <View style={{ alignItems: "center" }}>
              <Trophy color={colors.accent} size={18} />
              <Text style={{ fontSize: 14, fontWeight: "700", color: colors.textPrimary }}>{gamification.xp} XP</Text>
            </View>
            <View style={{ alignItems: "center" }}>
              <Flame color={colors.accent} size={18} />
              <Text style={{ fontSize: 14, fontWeight: "700", color: colors.textPrimary }}>{gamification.streak}일</Text>
            </View>
          </View>
        )}
      </View>

      {/* Achievements */}
      {achievements && achievements.length > 0 && (
        <View>
          <Text style={{ fontSize: 16, fontWeight: "700", color: colors.textPrimary, marginBottom: 12 }}>업적</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {achievements.filter(a => a.earned).map((a) => (
              <View key={a.id} style={{ backgroundColor: colors.surface, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 }}>
                <Text style={{ fontSize: 13, color: colors.textPrimary, fontWeight: "500" }}>{a.title}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* Settings */}
      <View style={{ backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.border, overflow: "hidden" }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 16, borderBottomWidth: 1, borderBottomColor: colors.border }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Moon color={colors.textSecondary} size={18} />
            <Text style={{ fontSize: 15, color: colors.textPrimary }}>다크 모드</Text>
          </View>
          <Switch
            value={isDark}
            onValueChange={(v) => setMode(v ? "dark" : "light")}
            trackColor={{ true: colors.accent }}
          />
        </View>
        <Pressable
          onPress={() => router.push("/(auth)/onboarding")}
          style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 16, borderBottomWidth: 1, borderBottomColor: colors.border }}
        >
          <Text style={{ fontSize: 15, color: colors.textPrimary }}>학년 / 교육과정</Text>
          <Text style={{ fontSize: 14, color: colors.textMuted }}>변경</Text>
        </Pressable>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 16, borderBottomWidth: 1, borderBottomColor: colors.border }}>
          <Text style={{ fontSize: 15, color: colors.textPrimary }}>복습 알림</Text>
          <Switch value={true} trackColor={{ true: colors.accent }} />
        </View>
        <Pressable
          onPress={async () => { await logout(); router.replace("/(auth)/welcome"); }}
          style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 16 }}
        >
          <LogOut color={colors.destructive} size={18} />
          <Text style={{ fontSize: 15, color: colors.destructive }}>로그아웃</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}
