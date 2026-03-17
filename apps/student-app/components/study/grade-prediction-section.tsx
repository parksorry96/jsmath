import { View, Text, ActivityIndicator } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useTheme } from "@/lib/theme";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";

interface SubjectPrediction {
  subject: string;
  predictedScore: number;
  predictedGrade: number;
  confidence: number;
  totalAnswered: number;
  totalCorrect: number;
}

interface GradePredictionResponse {
  studentId: string;
  predictions: SubjectPrediction[];
}

function gradeColor(grade: number): string {
  if (grade <= 2) return "#4ade80";
  if (grade <= 4) return "#60a5fa";
  if (grade <= 6) return "#fbbf24";
  return "#f87171";
}

export function GradePredictionSection() {
  const { colors } = useTheme();
  const { user } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ["grade-prediction"],
    queryFn: () => api.get<GradePredictionResponse>("/grade-prediction/me"),
    enabled: !!user,
  });

  if (isLoading) {
    return (
      <View style={{ paddingVertical: 48, alignItems: "center" }}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  const predictions = data?.predictions ?? [];

  if (predictions.length === 0) {
    return (
      <View style={{ alignItems: "center", paddingVertical: 48 }}>
        <Text style={{ color: colors.textMuted, fontSize: 14 }}>아직 예측 데이터가 없습니다</Text>
        <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 4 }}>문제를 더 풀면 예측이 가능합니다</Text>
      </View>
    );
  }

  return (
    <View style={{ padding: 16, gap: 12 }}>
      {predictions.map((pred) => {
        const gc = gradeColor(pred.predictedGrade);
        const confidencePct = Math.round(pred.confidence * 100);
        const accuracyPct =
          pred.totalAnswered > 0
            ? Math.round((pred.totalCorrect / pred.totalAnswered) * 100)
            : 0;
        return (
          <View
            key={pred.subject}
            style={{
              backgroundColor: colors.card,
              borderRadius: 16,
              borderWidth: 1,
              borderColor: colors.border,
              padding: 16,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              {/* Grade circle */}
              <View
                style={{
                  width: 56, height: 56, borderRadius: 28,
                  backgroundColor: gc + "22", alignItems: "center", justifyContent: "center",
                  marginRight: 14,
                }}
              >
                <Text style={{ color: gc, fontSize: 24, fontWeight: "800" }}>
                  {pred.predictedGrade}
                </Text>
                <Text style={{ color: gc, fontSize: 9, marginTop: -2 }}>등급</Text>
              </View>

              {/* Details */}
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.textPrimary, fontSize: 15, fontWeight: "700" }}>{pred.subject}</Text>
                <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 6 }}>
                  <Text style={{ color: colors.textMuted, fontSize: 12 }}>
                    예상 점수 {pred.predictedScore}점 · 정답률 {accuracyPct}%
                  </Text>
                  <Text style={{ color: colors.textMuted, fontSize: 12 }}>
                    신뢰도 {confidencePct}%
                  </Text>
                </View>
                <View style={{ height: 4, backgroundColor: colors.border, borderRadius: 2, marginTop: 8 }}>
                  <View style={{ height: 4, backgroundColor: gc, borderRadius: 2, width: `${confidencePct}%` }} />
                </View>
              </View>
            </View>
          </View>
        );
      })}
    </View>
  );
}
