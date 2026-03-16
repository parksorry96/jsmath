import { useState } from "react";
import { View, Text, Pressable, ActivityIndicator } from "react-native";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTheme } from "@/lib/theme";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { LatexText } from "@/components/math/latex-text";

interface ReviewProblem {
  id: string;
  wrongAnswerId: string;
  problem: {
    stemText: string;
    stemLatex: string;
    answerText: string | null;
    answerLatex: string | null;
    solutionText: string | null;
    choices: Array<{ label: string; contentText: string; position: number }>;
  } | null;
}

interface DailyReviewResponse {
  dueCount: number;
  problems: ReviewProblem[];
}

const QUALITY_BUTTONS = [
  { value: 0, label: "모르겠음", color: "#f87171" },
  { value: 1, label: "어려움", color: "#fb923c" },
  { value: 2, label: "헷갈림", color: "#fbbf24" },
  { value: 3, label: "보통", color: "#a3e635" },
  { value: 4, label: "쉬움", color: "#4ade80" },
  { value: 5, label: "완벽함", color: "#34d399" },
] as const;

export function DailyReviewSection() {
  const { colors } = useTheme();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showSolution, setShowSolution] = useState(false);
  const [completedCount, setCompletedCount] = useState(0);

  const { data, isLoading } = useQuery({
    queryKey: ["reviews", "daily"],
    queryFn: () => api.get<DailyReviewResponse>("/student-ai/reviews/daily"),
    enabled: !!user,
  });

  const gradeMutation = useMutation({
    mutationFn: ({ id, quality }: { id: string; quality: number }) =>
      api.post(`/student-ai/reviews/${id}/grade`, { quality }),
    onSuccess: () => {
      setShowSolution(false);
      setCompletedCount((c) => c + 1);
      const items = data?.problems ?? [];
      if (currentIndex < items.length - 1) {
        setCurrentIndex((i) => i + 1);
      } else {
        queryClient.invalidateQueries({ queryKey: ["reviews"] });
        setCurrentIndex(0);
      }
    },
  });

  if (isLoading) {
    return (
      <View style={{ paddingVertical: 48, alignItems: "center" }}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  const items = data?.problems ?? [];
  const totalItems = items.length;
  const current = items[currentIndex];

  if (totalItems === 0) {
    return (
      <View style={{ alignItems: "center", paddingVertical: 48, paddingHorizontal: 16 }}>
        <Text style={{ color: colors.textPrimary, fontSize: 18, fontWeight: "700", marginBottom: 8 }}>
          복습 완료!
        </Text>
        <Text style={{ color: colors.textMuted, fontSize: 14, textAlign: "center" }}>
          오늘의 복습을 모두 마쳤습니다.
        </Text>
      </View>
    );
  }

  const progress = totalItems > 0 ? (currentIndex + 1) / totalItems : 0;

  return (
    <View style={{ padding: 16 }}>
      {/* Progress */}
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 6 }}>
        <Text style={{ color: colors.textMuted, fontSize: 12 }}>
          완료 {completedCount}문제
        </Text>
        <Text style={{ color: colors.textMuted, fontSize: 12 }}>
          {currentIndex + 1}/{totalItems}
        </Text>
      </View>
      <View style={{ height: 4, backgroundColor: colors.border, borderRadius: 2, marginBottom: 16 }}>
        <View style={{ height: 4, backgroundColor: colors.accent, borderRadius: 2, width: `${progress * 100}%` }} />
      </View>

      {/* Problem card */}
      {current?.problem && (
        <View style={{ backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.border, overflow: "hidden" }}>
          <View style={{ padding: 20 }}>
            <Text style={{ color: colors.textMuted, fontSize: 12, marginBottom: 8 }}>문제</Text>
            <LatexText style={{ fontSize: 15, lineHeight: 22 }}>
              {current.problem.stemText || current.problem.stemLatex}
            </LatexText>
            {current.problem.choices.length > 0 && (
              <View style={{ marginTop: 12, gap: 6 }}>
                {current.problem.choices.map((c) => (
                  <Text key={c.position} style={{ color: colors.textSecondary, fontSize: 14, lineHeight: 20 }}>
                    {c.label}. {c.contentText}
                  </Text>
                ))}
              </View>
            )}
          </View>

          {!showSolution ? (
            <Pressable
              onPress={() => setShowSolution(true)}
              style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingVertical: 14, alignItems: "center" }}
            >
              <Text style={{ color: colors.accent, fontWeight: "700", fontSize: 14 }}>풀이 확인</Text>
            </Pressable>
          ) : (
            <View style={{ borderTopWidth: 1, borderTopColor: colors.border, padding: 20 }}>
              <Text style={{ color: colors.textMuted, fontSize: 12, marginBottom: 4 }}>정답</Text>
              <Text style={{ color: colors.success, fontSize: 14, lineHeight: 20, marginBottom: 12 }}>
                {current.problem.answerText || current.problem.answerLatex || "등록된 정답 없음"}
              </Text>
              <Text style={{ color: colors.textMuted, fontSize: 12, marginBottom: 4 }}>풀이</Text>
              <Text style={{ color: colors.textPrimary, fontSize: 14, lineHeight: 20 }}>
                {current.problem.solutionText || "등록된 풀이 없음"}
              </Text>
            </View>
          )}
        </View>
      )}

      {/* Quality rating */}
      {showSolution && current && (
        <View style={{ marginTop: 16 }}>
          <Text style={{ color: colors.textMuted, fontSize: 12, textAlign: "center", marginBottom: 12 }}>
            얼마나 잘 기억했나요?
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {QUALITY_BUTTONS.map((btn) => (
              <Pressable
                key={btn.value}
                onPress={() => gradeMutation.mutate({ id: current.id, quality: btn.value })}
                disabled={gradeMutation.isPending}
                style={{
                  flex: 1, minWidth: "30%", backgroundColor: btn.color + "22",
                  borderRadius: 12, paddingVertical: 12, alignItems: "center",
                }}
              >
                <Text style={{ color: btn.color, fontSize: 18, fontWeight: "800" }}>{btn.value}</Text>
                <Text style={{ color: btn.color, fontSize: 11, marginTop: 2 }}>{btn.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}
    </View>
  );
}
