import { View, Text, ActivityIndicator } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useTheme } from "@/lib/theme";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";

type MasteryState = "mastered" | "practicing" | "learning" | "not_started";

interface MasteryNode {
  id: string;
  label: string;
  level: number;
  children: MasteryNode[];
  mastery: {
    state: MasteryState;
    totalAttempts: number;
    totalCorrect: number;
  } | null;
}

interface MasteryGroup {
  subject: string;
  units: Array<{
    unitMajor: string;
    state: MasteryState;
    accuracy: number;
    attempts: number;
  }>;
}

type MasteryTreeResponse = MasteryNode[];

const STATE_CONFIG: Record<MasteryState, { label: string; color: string }> = {
  mastered: { label: "완성", color: "#4ade80" },
  practicing: { label: "연습", color: "#60a5fa" },
  learning: { label: "학습", color: "#fbbf24" },
  not_started: { label: "미시작", color: "#666666" },
};

export function MasterySection() {
  const { colors } = useTheme();
  const { user } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ["mastery", "tree"],
    queryFn: () => api.get<MasteryTreeResponse>("/student-ai/mastery/tree"),
    enabled: !!user,
  });

  if (isLoading) {
    return (
      <View style={{ paddingVertical: 48, alignItems: "center" }}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  const groups: MasteryGroup[] = (data ?? [])
    .filter((node) => node.level === 1)
    .map((subjectNode) => ({
      subject: subjectNode.label,
      units: subjectNode.children
        .filter((child) => child.level === 2)
        .map((unitNode) => {
          const attempts = unitNode.mastery?.totalAttempts ?? 0;
          const totalCorrect = unitNode.mastery?.totalCorrect ?? 0;
          return {
            unitMajor: unitNode.label,
            state: unitNode.mastery?.state ?? "not_started",
            accuracy: attempts > 0 ? totalCorrect / attempts : 0,
            attempts,
          };
        }),
    }))
    .filter((group) => group.units.length > 0);

  if (groups.length === 0) {
    return (
      <View style={{ alignItems: "center", paddingVertical: 48 }}>
        <Text style={{ color: colors.textMuted, fontSize: 14 }}>학습 데이터가 없습니다</Text>
      </View>
    );
  }

  return (
    <View style={{ padding: 16, gap: 16 }}>
      {groups.map((group) => (
        <View key={group.subject}>
          <Text style={{ color: colors.textPrimary, fontSize: 16, fontWeight: "700", marginBottom: 10 }}>
            {group.subject}
          </Text>
          <View style={{ gap: 8 }}>
            {group.units.map((unit) => {
              const config = STATE_CONFIG[unit.state];
              const pct = Math.round(unit.accuracy * 100);
              return (
                <View
                  key={unit.unitMajor}
                  style={{
                    backgroundColor: colors.card,
                    borderRadius: 14,
                    borderWidth: 1,
                    borderColor: colors.border,
                    borderLeftWidth: 4,
                    borderLeftColor: config.color,
                    padding: 14,
                  }}
                >
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                    <Text style={{ color: colors.textPrimary, fontSize: 14, fontWeight: "600", flex: 1, marginRight: 8 }}>
                      {unit.unitMajor}
                    </Text>
                    <View style={{ backgroundColor: config.color + "22", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 }}>
                      <Text style={{ color: config.color, fontSize: 11, fontWeight: "600" }}>{config.label}</Text>
                    </View>
                  </View>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 8 }}>
                    <Text style={{ color: colors.textMuted, fontSize: 12 }}>
                      정답률 {pct}%
                    </Text>
                    <Text style={{ color: colors.textMuted, fontSize: 12 }}>
                      {unit.attempts}문제 풀이
                    </Text>
                  </View>
                  <View style={{ height: 4, backgroundColor: colors.border, borderRadius: 2, marginTop: 8 }}>
                    <View style={{ height: 4, backgroundColor: config.color, borderRadius: 2, width: `${pct}%` }} />
                  </View>
                </View>
              );
            })}
          </View>
        </View>
      ))}
    </View>
  );
}
