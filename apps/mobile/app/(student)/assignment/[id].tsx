import { useState, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  TextInput,
  Pressable,
  ActivityIndicator,
  Alert,
  Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as ImagePicker from "expo-image-picker";
import { API_URL, api } from "@/lib/api";
import { getItemAsync } from "@/lib/storage";

interface Problem {
  id: string;
  number: number;
  stem: string;
  type: "multiple_choice" | "short_answer";
  choices?: string[];
  correctAnswer?: string;
}

interface AssignmentDetailResponse {
  id: string;
  title: string;
  type: "problem_set" | "text_task";
  description?: string;
  class?: { id: string; title: string };
  className: string;
  dueAt?: string | null;
  dueDate?: string | null;
  problems?: Array<{
    id: string;
    order: number;
    problem: {
      id: string;
      displayNumber?: string | null;
      problemNumber?: string | null;
      stemText: string;
      stemLatex: string;
      problemType: "multiple_choice" | "short_answer";
      choices?: Array<{
        label: string;
        contentText?: string;
        contentLatex?: string;
      }>;
      answerText?: string | null;
    };
  }>;
}

interface AssignmentDetail {
  id: string;
  title: string;
  type: "problem_set" | "text_task";
  description?: string;
  className: string;
  dueDate: string;
  problems?: Problem[];
}

interface SubmissionDetail {
  id: string;
  status: string;
  score?: number;
  maxScore?: number;
  answers?: SubmissionAnswer[];
  photos?: SubmissionPhoto[];
}

interface SubmissionAnswer {
  problemId: string;
  answer: string;
  isCorrect?: boolean;
  feedback?: string;
}

interface SubmissionPhoto {
  id: string;
  url: string;
  analysis?: {
    score?: number;
    steps?: string[];
    conceptHint?: string;
    overallFeedback?: string;
  };
}

const CHOICE_LABELS = ["①", "②", "③", "④", "⑤"];

export default function AssignmentDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [completed, setCompleted] = useState(false);

  const { data: assignment, isLoading: loadingAssignment } = useQuery({
    queryKey: ["assignment", id],
    queryFn: async () => {
      const res = await api.get<AssignmentDetailResponse>(`/assignments/${id}`);
      const problems: Problem[] = (res.problems ?? []).map((item, index) => {
        const raw = item.problem;
        const parsedNumber = parseInt(
          raw.displayNumber ?? raw.problemNumber ?? `${index + 1}`,
          10,
        );

        return {
          id: raw.id,
          number: Number.isFinite(parsedNumber) ? parsedNumber : index + 1,
          stem: raw.stemLatex || raw.stemText,
          type: raw.problemType,
          choices: raw.choices?.map(
            (choice) => choice.contentText || choice.contentLatex || choice.label,
          ),
          correctAnswer: raw.answerText ?? undefined,
        };
      });

      return {
        id: res.id,
        title: res.title,
        type: res.type,
        description: res.description,
        className: res.className || res.class?.title || "",
        dueDate: res.dueDate || res.dueAt || "",
        problems,
      };
    },
    enabled: !!id,
  });

  const { data: submission } = useQuery({
    queryKey: ["submission", id],
    queryFn: () =>
      api
        .get<SubmissionDetail[]>(`/submissions?assignmentId=${id}`)
        .then((res) => res[0] ?? null),
    enabled: !!id,
  });

  const submitMutation = useMutation({
    mutationFn: (payload: {
      assignmentId: string;
      type: string;
      answers?: Array<{ problemId: string; studentAnswer: string }>;
    }) =>
      api.post("/submissions", payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["submission", id] });
      queryClient.invalidateQueries({ queryKey: ["assignments"] });
      Alert.alert("제출 완료", "과제가 성공적으로 제출되었습니다.");
    },
    onError: (err: Error) => {
      Alert.alert("제출 실패", err.message);
    },
  });

  const handleSetAnswer = useCallback(
    (problemId: string, value: string) => {
      setAnswers((prev) => ({ ...prev, [problemId]: value }));
    },
    [],
  );

  const handleSubmit = useCallback(() => {
    if (!assignment) return;

    if (assignment.type === "problem_set") {
      const unanswered = (assignment.problems ?? []).filter(
        (p) => !answers[p.id],
      );
      if (unanswered.length > 0) {
        Alert.alert(
          "미완성",
          `${unanswered.length}개의 문제를 아직 풀지 않았습니다. 제출하시겠습니까?`,
          [
            { text: "취소", style: "cancel" },
            {
              text: "제출",
              onPress: () =>
                submitMutation.mutate({
                  assignmentId: id!,
                  type: assignment.type,
                  answers: Object.entries(answers).map(
                    ([problemId, studentAnswer]) => ({
                      problemId,
                      studentAnswer,
                    }),
                  ),
                }),
            },
          ],
        );
        return;
      }
    }

    submitMutation.mutate({
      assignmentId: id!,
      type: assignment.type,
      answers:
        assignment.type === "problem_set"
          ? Object.entries(answers).map(([problemId, studentAnswer]) => ({
              problemId,
              studentAnswer,
            }))
          : undefined,
    });
  }, [assignment, answers, id, submitMutation]);

  const handleToggleComplete = useCallback(() => {
    setCompleted((prev) => !prev);
  }, []);

  const handlePickPhoto = useCallback(async () => {
    if (!submission?.id) {
      Alert.alert("먼저 과제를 제출해주세요.");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.8,
    });

    if (result.canceled || !result.assets?.[0]) return;

    const asset = result.assets[0];
    setUploading(true);
    setUploadProgress(0);

    try {
      const token = await getItemAsync("auth_token");
      const formData = new FormData();
      formData.append("file", {
        uri: asset.uri,
        type: asset.mimeType ?? "image/jpeg",
        name: asset.fileName ?? "photo.jpg",
      } as unknown as Blob);

      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${API_URL}/submissions/${submission.id}/photos`);
      if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          setUploadProgress(Math.round((e.loaded / e.total) * 100));
        }
      };

      await new Promise<void>((resolve, reject) => {
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve();
          } else {
            reject(new Error(`Upload failed: ${xhr.status}`));
          }
        };
        xhr.onerror = () => reject(new Error("Network error"));
        xhr.send(formData);
      });

      queryClient.invalidateQueries({ queryKey: ["submission", id] });
      Alert.alert("업로드 완료", "사진이 업로드되었습니다.");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "알 수 없는 오류";
      Alert.alert("업로드 실패", msg);
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  }, [submission?.id, id, queryClient]);

  const handleTakePhoto = useCallback(async () => {
    if (!submission?.id) {
      Alert.alert("먼저 과제를 제출해주세요.");
      return;
    }

    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("카메라 권한이 필요합니다.");
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      quality: 0.8,
    });

    if (result.canceled || !result.assets?.[0]) return;

    // Reuse same upload logic
    const asset = result.assets[0];
    setUploading(true);
    setUploadProgress(0);

    try {
      const token = await getItemAsync("auth_token");
      const formData = new FormData();
      formData.append("file", {
        uri: asset.uri,
        type: asset.mimeType ?? "image/jpeg",
        name: asset.fileName ?? "photo.jpg",
      } as unknown as Blob);

      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${API_URL}/submissions/${submission.id}/photos`);
      if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          setUploadProgress(Math.round((e.loaded / e.total) * 100));
        }
      };

      await new Promise<void>((resolve, reject) => {
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else reject(new Error(`Upload failed: ${xhr.status}`));
        };
        xhr.onerror = () => reject(new Error("Network error"));
        xhr.send(formData);
      });

      queryClient.invalidateQueries({ queryKey: ["submission", id] });
      Alert.alert("업로드 완료", "사진이 업로드되었습니다.");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "알 수 없는 오류";
      Alert.alert("업로드 실패", msg);
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  }, [submission?.id, id, queryClient]);

  if (loadingAssignment) {
    return (
      <SafeAreaView className="flex-1 bg-brand-dark items-center justify-center">
        <ActivityIndicator color="#d4a574" size="large" />
      </SafeAreaView>
    );
  }

  if (!assignment) {
    return (
      <SafeAreaView className="flex-1 bg-brand-dark items-center justify-center">
        <Text className="text-gray-400">과제를 찾을 수 없습니다</Text>
        <Pressable className="mt-4" onPress={() => router.back()}>
          <Text className="text-brand-accent">뒤로 가기</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  const isGraded = submission?.status === "graded";
  const isSubmitted = submission?.status === "submitted" || isGraded;

  return (
    <SafeAreaView className="flex-1 bg-brand-dark" edges={["left", "right", "bottom"]}>
      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 100 }}>
        {/* Header */}
        <View className="px-4 pt-4 pb-3">
          <Text className="text-brand-beige text-xl font-bold">
            {assignment.title}
          </Text>
          <Text className="text-gray-400 text-sm mt-1">
            {assignment.className}
          </Text>
          {assignment.description && (
            <Text className="text-gray-300 text-sm mt-2">
              {assignment.description}
            </Text>
          )}
        </View>

        {/* Score banner if graded */}
        {isGraded && submission?.score != null && (
          <View className="mx-4 mb-3 bg-green-900/30 border border-green-900/50 rounded-xl p-4">
            <Text className="text-green-400 text-center text-sm">채점 완료</Text>
            <Text className="text-green-300 text-center text-3xl font-bold mt-1">
              {submission.score} / {submission.maxScore}
            </Text>
          </View>
        )}

        {/* Problem Set Type */}
        {assignment.type === "problem_set" && assignment.problems && (
          <View className="px-4">
            {assignment.problems.map((problem) => {
              const submittedAnswer = submission?.answers?.find(
                (a) => a.problemId === problem.id,
              );
              const currentAnswer = answers[problem.id] ?? "";

              return (
                <View
                  key={problem.id}
                  className="bg-[#2a2a2a] rounded-xl p-4 mb-3"
                >
                  {/* Problem number + stem */}
                  <View className="flex-row mb-2">
                    <View className="bg-brand-accent/20 rounded-full w-7 h-7 items-center justify-center mr-2">
                      <Text className="text-brand-accent font-bold text-sm">
                        {problem.number}
                      </Text>
                    </View>
                    <Text className="text-brand-beige flex-1 leading-5">
                      {problem.stem}
                    </Text>
                  </View>

                  {/* Graded feedback */}
                  {submittedAnswer && isGraded && (
                    <View
                      className={`rounded-lg p-2 mb-2 ${
                        submittedAnswer.isCorrect
                          ? "bg-green-900/30"
                          : "bg-red-900/30"
                      }`}
                    >
                      <Text
                        className={`text-xs ${
                          submittedAnswer.isCorrect
                            ? "text-green-400"
                            : "text-red-400"
                        }`}
                      >
                        {submittedAnswer.isCorrect ? "정답" : "오답"} —{" "}
                        제출: {submittedAnswer.answer}
                        {!submittedAnswer.isCorrect && problem.correctAnswer && (
                          <Text className="text-green-400">
                            {" "}
                            (정답: {problem.correctAnswer})
                          </Text>
                        )}
                      </Text>
                      {submittedAnswer.feedback && (
                        <Text className="text-gray-300 text-xs mt-1">
                          {submittedAnswer.feedback}
                        </Text>
                      )}
                    </View>
                  )}

                  {/* Multiple choice answers */}
                  {problem.type === "multiple_choice" &&
                    !isSubmitted &&
                    (problem.choices ?? CHOICE_LABELS).map((choice, i) => {
                      const label = CHOICE_LABELS[i] ?? `(${i + 1})`;
                      const value = String(i + 1);
                      const selected = currentAnswer === value;

                      return (
                        <Pressable
                          key={i}
                          className={`flex-row items-center p-2.5 rounded-lg mb-1.5 ${
                            selected
                              ? "bg-brand-accent/20 border border-brand-accent/40"
                              : "bg-[#333]"
                          }`}
                          onPress={() => handleSetAnswer(problem.id, value)}
                        >
                          <Text
                            className={`text-base mr-2 ${
                              selected ? "text-brand-accent" : "text-gray-400"
                            }`}
                          >
                            {label}
                          </Text>
                          <Text
                            className={`flex-1 ${
                              selected ? "text-brand-beige" : "text-gray-300"
                            }`}
                          >
                            {choice}
                          </Text>
                        </Pressable>
                      );
                    })}

                  {/* Submitted multiple choice (read-only) */}
                  {problem.type === "multiple_choice" &&
                    isSubmitted &&
                    !isGraded &&
                    submittedAnswer && (
                      <View className="bg-blue-900/20 rounded-lg p-2">
                        <Text className="text-blue-400 text-xs">
                          제출한 답: {submittedAnswer.answer}
                        </Text>
                      </View>
                    )}

                  {/* Short answer input */}
                  {problem.type === "short_answer" && !isSubmitted && (
                    <TextInput
                      className="bg-[#333] text-brand-beige rounded-lg px-3 py-2.5 mt-1"
                      placeholder="답을 입력하세요"
                      placeholderTextColor="#666"
                      value={currentAnswer}
                      onChangeText={(text) => handleSetAnswer(problem.id, text)}
                    />
                  )}

                  {/* Submitted short answer (read-only) */}
                  {problem.type === "short_answer" &&
                    isSubmitted &&
                    !isGraded &&
                    submittedAnswer && (
                      <View className="bg-blue-900/20 rounded-lg p-2">
                        <Text className="text-blue-400 text-xs">
                          제출한 답: {submittedAnswer.answer}
                        </Text>
                      </View>
                    )}
                </View>
              );
            })}
          </View>
        )}

        {/* Text Task Type */}
        {assignment.type === "text_task" && (
          <View className="px-4">
            {!isSubmitted && (
              <>
                <Pressable
                  className="flex-row items-center bg-[#2a2a2a] rounded-xl p-4 mb-3"
                  onPress={handleToggleComplete}
                >
                  <View
                    className={`w-6 h-6 rounded border-2 mr-3 items-center justify-center ${
                      completed
                        ? "bg-brand-accent border-brand-accent"
                        : "border-gray-500"
                    }`}
                  >
                    {completed && (
                      <Text className="text-brand-dark text-xs font-bold">
                        ✓
                      </Text>
                    )}
                  </View>
                  <Text className="text-brand-beige">과제 완료</Text>
                </Pressable>
              </>
            )}

            {/* Photo upload section */}
            {isSubmitted && (
              <View className="mb-3">
                <Text className="text-brand-beige font-semibold mb-2">
                  풀이 사진
                </Text>

                {/* Existing photos */}
                {submission?.photos?.map((photo) => (
                  <View key={photo.id} className="bg-[#2a2a2a] rounded-xl mb-2 overflow-hidden">
                    <Image
                      source={{ uri: photo.url }}
                      className="w-full h-48"
                      resizeMode="cover"
                    />
                    {photo.analysis && (
                      <View className="p-3">
                        {photo.analysis.score != null && (
                          <View className="flex-row items-center mb-2">
                            <Text className="text-gray-400 text-xs mr-2">
                              점수:
                            </Text>
                            <Text className="text-brand-accent font-bold">
                              {photo.analysis.score}
                            </Text>
                          </View>
                        )}
                        {photo.analysis.steps &&
                          photo.analysis.steps.length > 0 && (
                            <View className="mb-2">
                              <Text className="text-gray-400 text-xs mb-1">
                                풀이 단계:
                              </Text>
                              {photo.analysis.steps.map((step, i) => (
                                <Text
                                  key={i}
                                  className="text-gray-300 text-xs ml-2"
                                >
                                  {i + 1}. {step}
                                </Text>
                              ))}
                            </View>
                          )}
                        {photo.analysis.conceptHint && (
                          <View className="bg-blue-900/20 rounded-lg p-2 mb-1">
                            <Text className="text-blue-400 text-xs">
                              힌트: {photo.analysis.conceptHint}
                            </Text>
                          </View>
                        )}
                        {photo.analysis.overallFeedback && (
                          <Text className="text-gray-300 text-xs mt-1">
                            {photo.analysis.overallFeedback}
                          </Text>
                        )}
                      </View>
                    )}
                  </View>
                ))}

                {/* Upload buttons */}
                {uploading ? (
                  <View className="bg-[#2a2a2a] rounded-xl p-4 items-center">
                    <ActivityIndicator color="#d4a574" />
                    <Text className="text-brand-accent text-sm mt-2">
                      업로드 중... {uploadProgress}%
                    </Text>
                    <View className="w-full h-1.5 bg-[#333] rounded-full mt-2 overflow-hidden">
                      <View
                        className="h-full bg-brand-accent rounded-full"
                        style={{ width: `${uploadProgress}%` }}
                      />
                    </View>
                  </View>
                ) : (
                  <View className="flex-row gap-2">
                    <Pressable
                      className="flex-1 bg-brand-accent rounded-xl p-3 items-center"
                      onPress={handleTakePhoto}
                    >
                      <Text className="text-brand-dark font-semibold">
                        카메라로 촬영
                      </Text>
                    </Pressable>
                    <Pressable
                      className="flex-1 bg-[#2a2a2a] border border-brand-accent/40 rounded-xl p-3 items-center"
                      onPress={handlePickPhoto}
                    >
                      <Text className="text-brand-accent font-semibold">
                        갤러리에서 선택
                      </Text>
                    </Pressable>
                  </View>
                )}
              </View>
            )}
          </View>
        )}
      </ScrollView>

      {/* Submit button (fixed at bottom) */}
      {!isSubmitted && (
        <View className="absolute bottom-0 left-0 right-0 bg-brand-dark border-t border-[#333] px-4 py-3">
          <Pressable
            className={`rounded-xl p-4 items-center ${
              submitMutation.isPending ? "bg-gray-600" : "bg-brand-accent"
            }`}
            onPress={handleSubmit}
            disabled={submitMutation.isPending}
          >
            {submitMutation.isPending ? (
              <ActivityIndicator color="#1a1a1a" />
            ) : (
              <Text className="text-brand-dark font-bold text-base">제출</Text>
            )}
          </Pressable>
        </View>
      )}
    </SafeAreaView>
  );
}
