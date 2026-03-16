import { View, Text, Pressable, ActivityIndicator } from "react-native";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTheme } from "@/lib/theme";
import { api } from "@/lib/api";

interface UnitAccuracy {
  unitMajor: string;
  accuracy: number;
  attempts: number;
}

interface WeaknessResponse {
  summary: string;
  unitAccuracies: UnitAccuracy[];
}

export function WeaknessSection() {
  const { colors } = useTheme();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["weakness"],
    queryFn: () => api.get<WeaknessResponse>("/student-ai/weakness"),
  });

  const generateMutation = useMutation({
    mutationFn: () => api.post("/student-ai/recommendations/generate"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["weakness"] }),
  });

  if (isLoading) {
    return (
      <View style={{ paddingVertical: 48, alignItems: "center" }}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (!data) {
    return (
      <View style={{ alignItems: "center", paddingVertical: 48 }}>
        <Text style={{ color: colors.textMuted, fontSize: 14 }}>분석 데이터가 없습니다</Text>
      </View>
    );
  }

  return (
    <View style={{ padding: 16, gap: 16 }}>
      {/* AI Summary */}
      <View style={{ backgroundColor: colors.surface, borderRadius: 16, padding: 16 }}>
        <Text style={{ color: colors.textMuted, fontSize: 12, fontWeight: "600", marginBottom: 8 }}>AI 분석 요약</Text>
        <Text style={{ color: colors.textPrimary, fontSize: 14, lineHeight: 22 }}>{data.summary}</Text>
      </View>

      {/* Unit accuracy list */}
      {data.unitAccuracies.length > 0 && (
        <View>
          <Text style={{ color: colors.textPrimary, fontSize: 16, fontWeight: "700", marginBottom: 10 }}>
            단원별 정답률
          </Text>
          <View style={{ gap: 8 }}>
            {data.unitAccuracies.map((unit) => {
              const pct = Math.round(unit.accuracy * 100);
              const barColor = pct >= 70 ? colors.success : pct >= 50 ? "#fbbf24" : colors.destructive;
              return (
                <View
                  key={unit.unitMajor}
                  style={{
                    backgroundColor: colors.card,
                    borderRadius: 14,
                    borderWidth: 1,
                    borderColor: colors.border,
                    padding: 14,
                  }}
                >
                  <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 6 }}>
                    <Text style={{ color: colors.textPrimary, fontSize: 14, fontWeight: "500", flex: 1, marginRight: 8 }}>
                      {unit.unitMajor}
                    </Text>
                    <Text style={{ color: barColor, fontSize: 14, fontWeight: "700" }}>{pct}%</Text>
                  </View>
                  <View style={{ height: 4, backgroundColor: colors.border, borderRadius: 2 }}>
                    <View style={{ height: 4, backgroundColor: barColor, borderRadius: 2, width: `${pct}%` }} />
                  </View>
                  <Text style={{ color: colors.textMuted, fontSize: 11, marginTop: 6 }}>
                    {unit.attempts}문제 풀이
                  </Text>
                </View>
              );
            })}
          </View>
        </View>
      )}

      {/* Generate recommendations */}
      <Pressable
        onPress={() => generateMutation.mutate()}
        disabled={generateMutation.isPending}
        style={{
          backgroundColor: colors.accent,
          borderRadius: 14,
          paddingVertical: 16,
          alignItems: "center",
          opacity: generateMutation.isPending ? 0.6 : 1,
        }}
      >
        <Text style={{ color: "#fff", fontSize: 15, fontWeight: "700" }}>
          {generateMutation.isPending ? "생성 중..." : "추천 문제 생성"}
        </Text>
      </Pressable>
    </View>
  );
}
