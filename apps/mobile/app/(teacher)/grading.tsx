import { useState, useCallback } from "react";
import {
  View,
  Text,
  FlatList,
  Pressable,
  TextInput,
  Alert,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

interface Assignment {
  id: string;
  title: string;
  type: string;
  maxScore: number;
  dueAt: string | null;
  class?: { id: string; title: string };
}

interface Submission {
  id: string;
  assignmentId: string;
  studentId: string;
  status: string;
  score: number | null;
  submittedAt: string;
  answers?: Array<{ problemId: string; answer?: string | null }>;
  student?: { id: string; name: string };
}

interface GradeInput {
  score: string;
  feedback: string;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function TeacherGrading() {
  const queryClient = useQueryClient();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [gradeInputs, setGradeInputs] = useState<Record<string, GradeInput>>({});
  const [refreshing, setRefreshing] = useState(false);

  const assignmentsQuery = useQuery({
    queryKey: ["assignments", "pending"],
    queryFn: () => api.get<Assignment[]>("/assignments/pending"),
  });

  const submissionsQuery = useQuery({
    queryKey: ["submissions", "expanded", expandedId],
    queryFn: () =>
      api.get<Submission[]>(
        `/submissions?assignmentId=${expandedId}&status=submitted`
      ),
    enabled: !!expandedId,
  });

  const gradeMutation = useMutation({
    mutationFn: ({
      id,
      score,
      feedback,
    }: {
      id: string;
      score: number;
      feedback?: string;
    }) => api.post(`/submissions/${id}/grade`, { score, feedback }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["submissions"] });
      queryClient.invalidateQueries({ queryKey: ["assignments"] });
    },
    onError: (err) => Alert.alert("오류", err.message),
  });


  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await assignmentsQuery.refetch();
    if (expandedId) await submissionsQuery.refetch();
    setRefreshing(false);
  }, [assignmentsQuery, submissionsQuery, expandedId]);

  const assignments = assignmentsQuery.data ?? [];
  const submissions = submissionsQuery.data ?? [];

  function getInput(subId: string): GradeInput {
    return gradeInputs[subId] ?? { score: "", feedback: "" };
  }

  function setInput(subId: string, field: keyof GradeInput, value: string) {
    setGradeInputs((prev) => ({
      ...prev,
      [subId]: { ...getInput(subId), [field]: value },
    }));
  }

  function handleGrade(sub: Submission, maxScore: number) {
    const input = getInput(sub.id);
    const score = parseFloat(input.score);
    if (isNaN(score) || score < 0 || score > maxScore) {
      Alert.alert("입력 오류", `0~${maxScore} 사이의 점수를 입력하세요`);
      return;
    }
    gradeMutation.mutate({
      id: sub.id,
      score,
      feedback: input.feedback || undefined,
    });
  }

  const returnAllMutation = useMutation({
    mutationFn: (assignmentId: string) =>
      api.post(`/assignments/${assignmentId}/return-all`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["submissions"] });
      queryClient.invalidateQueries({ queryKey: ["assignments"] });
    },
    onError: (err) => Alert.alert("오류", err.message),
  });

  function handleBulkReturn() {
    const graded = submissions.filter((s) => s.status === "graded");
    if (graded.length === 0) {
      Alert.alert("알림", "반환할 채점 완료 과제가 없습니다");
      return;
    }
    if (!expandedId) return;
    Alert.alert(
      "전체 반환",
      `채점 완료된 ${graded.length}건을 반환하시겠습니까?`,
      [
        { text: "취소", style: "cancel" },
        {
          text: "반환",
          onPress: () => returnAllMutation.mutate(expandedId),
        },
      ]
    );
  }

  if (assignmentsQuery.isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-brand-dark">
        <ActivityIndicator size="large" color="#d4a574" />
      </View>
    );
  }

  return (
    <SafeAreaView edges={["bottom"]} className="flex-1 bg-brand-dark">
      <FlatList
        data={assignments}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#d4a574"
          />
        }
        ListEmptyComponent={
          <View className="items-center justify-center py-20">
            <Text className="text-[#888] text-base">채점 대기 중인 과제가 없습니다</Text>
          </View>
        }
        renderItem={({ item: assignment }) => {
          const isExpanded = expandedId === assignment.id;
          return (
            <View className="mb-3">
              <Pressable
                className="bg-[#2a2a2a] rounded-xl p-4 active:opacity-80"
                onPress={() =>
                  setExpandedId(isExpanded ? null : assignment.id)
                }
              >
                <View className="flex-row justify-between items-start">
                  <View className="flex-1">
                    <Text className="text-brand-beige font-bold text-base">
                      {assignment.title}
                    </Text>
                    {assignment.class && (
                      <Text className="text-[#888] text-xs mt-0.5">
                        {assignment.class.title}
                      </Text>
                    )}
                  </View>
                  <View className="flex-row items-center gap-2">
                    <View className="bg-[#3a3a3a] rounded-full px-2 py-0.5">
                      <Text className="text-[#aaa] text-xs">
                        {assignment.maxScore}점
                      </Text>
                    </View>
                    <Text className="text-[#888]">
                      {isExpanded ? "▲" : "▼"}
                    </Text>
                  </View>
                </View>
                <Text className="text-[#666] text-xs mt-1">
                  {assignment.dueAt ? `마감: ${formatDate(assignment.dueAt)}` : "마감 미설정"}
                </Text>
              </Pressable>

              {/* Expanded: Submissions */}
              {isExpanded && (
                <View className="bg-[#222] rounded-b-xl px-3 py-2 -mt-1">
                  {submissionsQuery.isLoading ? (
                    <ActivityIndicator color="#d4a574" className="py-4" />
                  ) : submissions.length === 0 ? (
                    <Text className="text-[#666] text-center py-4">
                      제출된 과제가 없습니다
                    </Text>
                  ) : (
                    <>
                      {submissions.map((sub) => (
                        <View
                          key={sub.id}
                          className="bg-[#2a2a2a] rounded-lg p-3 my-1"
                        >
                          <View className="flex-row justify-between items-center mb-2">
                            <Text className="text-brand-beige font-medium">
                              {sub.student?.name ?? "학생"}
                            </Text>
                            <Text className="text-[#666] text-xs">
                              {formatDate(sub.submittedAt)}
                            </Text>
                          </View>

                          {/* Answer grid for online submissions */}
                          {sub.answers && sub.answers.length > 0 && (
                            <View className="flex-row flex-wrap gap-1 mb-2">
                              {sub.answers.map((answer) => (
                                  <View
                                    key={answer.problemId}
                                    className="bg-[#3a3a3a] rounded px-2 py-1"
                                  >
                                    <Text className="text-[#aaa] text-xs">
                                      {answer.problemId}: {answer.answer ?? "-"}
                                    </Text>
                                  </View>
                                ))}
                            </View>
                          )}

                          {sub.status === "graded" ? (
                            <View className="flex-row items-center justify-between">
                              <Text className="text-[#4ade80] text-sm">
                                ✓ 채점완료: {sub.score}/{assignment.maxScore}
                              </Text>
                            </View>
                          ) : (
                            <>
                              {/* Score Input */}
                              <View className="flex-row gap-2 items-end">
                                <View className="flex-1">
                                  <TextInput
                                    className="bg-[#3a3a3a] text-brand-beige rounded-lg px-3 py-2 text-sm"
                                    placeholder={`점수 (0-${assignment.maxScore})`}
                                    placeholderTextColor="#666"
                                    keyboardType="numeric"
                                    value={getInput(sub.id).score}
                                    onChangeText={(v) =>
                                      setInput(sub.id, "score", v)
                                    }
                                  />
                                </View>
                                <Pressable
                                  className="bg-brand-accent rounded-lg px-4 py-2"
                                  onPress={() =>
                                    handleGrade(sub, assignment.maxScore)
                                  }
                                  disabled={gradeMutation.isPending}
                                >
                                  <Text className="text-brand-dark font-bold text-sm">
                                    채점
                                  </Text>
                                </Pressable>
                              </View>
                              {/* Feedback */}
                              <TextInput
                                className="bg-[#3a3a3a] text-brand-beige rounded-lg px-3 py-2 mt-2 text-sm"
                                placeholder="피드백 (선택)"
                                placeholderTextColor="#666"
                                value={getInput(sub.id).feedback}
                                onChangeText={(v) =>
                                  setInput(sub.id, "feedback", v)
                                }
                              />
                            </>
                          )}
                        </View>
                      ))}

                      {/* Bulk Return */}
                      {submissions.some((s) => s.status === "graded") && (
                        <Pressable
                          className="bg-[#3a3a3a] rounded-lg py-3 mt-2 items-center"
                          onPress={handleBulkReturn}
                        >
                          <Text className="text-brand-accent font-bold text-sm">
                            채점 완료 전체 반환
                          </Text>
                        </Pressable>
                      )}
                    </>
                  )}
                </View>
              )}
            </View>
          );
        }}
      />
    </SafeAreaView>
  );
}
