import { useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TextInput,
  Pressable,
  Alert,
  ActivityIndicator,
  FlatList,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

interface Class {
  id: string;
  name: string;
}

interface Problem {
  id: string;
  number: string;
  stem: string;
}

type AssignmentType = "problem_set" | "text_task";

export default function NewAssignmentScreen() {
  const { classId: preselectedClassId } = useLocalSearchParams<{
    classId?: string;
  }>();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [classId, setClassId] = useState(preselectedClassId ?? "");
  const [title, setTitle] = useState("");
  const [type, setType] = useState<AssignmentType>("problem_set");
  const [dueDate, setDueDate] = useState("");
  const [maxScore, setMaxScore] = useState("100");
  const [description, setDescription] = useState("");

  // Problem search
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedProblems, setSelectedProblems] = useState<Problem[]>([]);

  const classesQuery = useQuery({
    queryKey: ["classes"],
    queryFn: () => api.get<Class[]>("/classes"),
  });

  const problemsQuery = useQuery({
    queryKey: ["problems", "search", searchQuery],
    queryFn: () =>
      api.get<Problem[]>(
        `/problems?search=${encodeURIComponent(searchQuery)}&limit=20`
      ),
    enabled: type === "problem_set" && searchQuery.length >= 2,
  });

  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      api.post(`/classes/${classId}/assignments`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["assignments"] });
      Alert.alert("완료", "과제가 출제되었습니다", [
        { text: "확인", onPress: () => router.back() },
      ]);
    },
    onError: (err) => Alert.alert("오류", err.message),
  });

  const classes = classesQuery.data ?? [];
  const searchResults = problemsQuery.data ?? [];
  const selectedIds = new Set(selectedProblems.map((p) => p.id));

  function toggleProblem(problem: Problem) {
    if (selectedIds.has(problem.id)) {
      setSelectedProblems((prev) => prev.filter((p) => p.id !== problem.id));
    } else {
      setSelectedProblems((prev) => [...prev, problem]);
    }
  }

  function handleSubmit() {
    if (!classId) {
      Alert.alert("입력 오류", "반을 선택하세요");
      return;
    }
    if (!title.trim()) {
      Alert.alert("입력 오류", "제목을 입력하세요");
      return;
    }
    if (!dueDate.trim()) {
      Alert.alert("입력 오류", "마감일을 입력하세요 (YYYY-MM-DD)");
      return;
    }
    if (type === "problem_set" && selectedProblems.length === 0) {
      Alert.alert("입력 오류", "문제를 1개 이상 선택하세요");
      return;
    }

    const payload: Record<string, unknown> = {
      title: title.trim(),
      type,
      dueDate: new Date(dueDate).toISOString(),
      maxScore: parseInt(maxScore) || 100,
    };

    if (type === "problem_set") {
      payload.problemIds = selectedProblems.map((p) => p.id);
    } else {
      payload.description = description;
    }

    createMutation.mutate(payload);
  }

  return (
    <SafeAreaView edges={["bottom"]} className="flex-1 bg-brand-dark">
      <Stack.Screen options={{ title: "과제 출제" }} />
      <ScrollView
        className="flex-1 px-4 pt-2"
        keyboardShouldPersistTaps="handled"
      >
        {/* Class Selector */}
        {!preselectedClassId && (
          <>
            <Text className="text-[#aaa] text-sm mb-1">반 선택</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              className="mb-4"
            >
              <View className="flex-row gap-2">
                {classes.map((c) => (
                  <Pressable
                    key={c.id}
                    className={`px-4 py-2 rounded-lg ${
                      classId === c.id ? "bg-brand-accent" : "bg-[#2a2a2a]"
                    }`}
                    onPress={() => setClassId(c.id)}
                  >
                    <Text
                      className={
                        classId === c.id
                          ? "text-brand-dark font-bold"
                          : "text-brand-beige"
                      }
                    >
                      {c.name}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </ScrollView>
          </>
        )}

        {/* Title */}
        <Text className="text-[#aaa] text-sm mb-1">제목</Text>
        <TextInput
          className="bg-[#2a2a2a] text-brand-beige rounded-lg px-4 py-3 mb-4"
          placeholder="과제 제목"
          placeholderTextColor="#666"
          value={title}
          onChangeText={setTitle}
        />

        {/* Type Toggle */}
        <Text className="text-[#aaa] text-sm mb-1">유형</Text>
        <View className="flex-row gap-2 mb-4">
          {([
            ["problem_set", "문제풀이"],
            ["text_task", "일반과제"],
          ] as const).map(([val, label]) => (
            <Pressable
              key={val}
              className={`flex-1 py-3 rounded-lg items-center ${
                type === val ? "bg-brand-accent" : "bg-[#2a2a2a]"
              }`}
              onPress={() => setType(val)}
            >
              <Text
                className={`font-medium ${
                  type === val ? "text-brand-dark" : "text-brand-beige"
                }`}
              >
                {label}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* Due Date */}
        <Text className="text-[#aaa] text-sm mb-1">마감일</Text>
        <TextInput
          className="bg-[#2a2a2a] text-brand-beige rounded-lg px-4 py-3 mb-4"
          placeholder="YYYY-MM-DD"
          placeholderTextColor="#666"
          value={dueDate}
          onChangeText={setDueDate}
        />

        {/* Max Score */}
        <Text className="text-[#aaa] text-sm mb-1">배점</Text>
        <TextInput
          className="bg-[#2a2a2a] text-brand-beige rounded-lg px-4 py-3 mb-4"
          placeholder="100"
          placeholderTextColor="#666"
          keyboardType="numeric"
          value={maxScore}
          onChangeText={setMaxScore}
        />

        {/* Problem Set: Search & Select */}
        {type === "problem_set" && (
          <View className="mb-4">
            <Text className="text-[#aaa] text-sm mb-1">문제 검색</Text>
            <TextInput
              className="bg-[#2a2a2a] text-brand-beige rounded-lg px-4 py-3 mb-2"
              placeholder="키워드 검색 (2자 이상)"
              placeholderTextColor="#666"
              value={searchQuery}
              onChangeText={setSearchQuery}
            />

            {/* Search Results */}
            {problemsQuery.isLoading && (
              <ActivityIndicator color="#d4a574" className="my-2" />
            )}
            {searchResults
              .filter((p) => !selectedIds.has(p.id))
              .slice(0, 10)
              .map((problem) => (
                <Pressable
                  key={problem.id}
                  className="bg-[#2a2a2a] rounded-lg p-3 mb-1 flex-row items-center active:opacity-80"
                  onPress={() => toggleProblem(problem)}
                >
                  <View className="bg-[#3a3a3a] rounded-full w-6 h-6 items-center justify-center mr-3">
                    <Text className="text-brand-accent text-xs font-bold">
                      +
                    </Text>
                  </View>
                  <View className="flex-1">
                    <Text className="text-brand-beige text-sm font-medium">
                      {problem.number}
                    </Text>
                    <Text
                      className="text-[#888] text-xs mt-0.5"
                      numberOfLines={1}
                    >
                      {problem.stem}
                    </Text>
                  </View>
                </Pressable>
              ))}

            {/* Selected Problems */}
            {selectedProblems.length > 0 && (
              <View className="mt-3">
                <Text className="text-brand-beige font-bold text-sm mb-2">
                  선택된 문제 ({selectedProblems.length})
                </Text>
                {selectedProblems.map((problem) => (
                  <View
                    key={problem.id}
                    className="bg-brand-accent/10 border border-brand-accent/30 rounded-lg p-3 mb-1 flex-row items-center"
                  >
                    <View className="flex-1">
                      <Text className="text-brand-beige text-sm font-medium">
                        {problem.number}
                      </Text>
                      <Text
                        className="text-[#888] text-xs mt-0.5"
                        numberOfLines={1}
                      >
                        {problem.stem}
                      </Text>
                    </View>
                    <Pressable
                      className="ml-2 p-1"
                      onPress={() => toggleProblem(problem)}
                    >
                      <Text className="text-[#f87171] text-lg">✕</Text>
                    </Pressable>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}

        {/* Text Task: Description */}
        {type === "text_task" && (
          <>
            <Text className="text-[#aaa] text-sm mb-1">과제 설명</Text>
            <TextInput
              className="bg-[#2a2a2a] text-brand-beige rounded-lg px-4 py-3 mb-4"
              placeholder="과제 내용을 입력하세요"
              placeholderTextColor="#666"
              multiline
              numberOfLines={5}
              textAlignVertical="top"
              value={description}
              onChangeText={setDescription}
            />
          </>
        )}

        {/* Submit Button */}
        <Pressable
          className={`rounded-xl py-4 items-center mb-8 ${
            createMutation.isPending ? "bg-[#555]" : "bg-brand-accent"
          }`}
          onPress={handleSubmit}
          disabled={createMutation.isPending}
        >
          {createMutation.isPending ? (
            <ActivityIndicator color="#1a1a1a" />
          ) : (
            <Text className="text-brand-dark font-bold text-base">출제</Text>
          )}
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
