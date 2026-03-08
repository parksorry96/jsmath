import { useState, useCallback } from "react";
import {
  View,
  Text,
  FlatList,
  Pressable,
  Modal,
  Alert,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

interface Student {
  id: string;
  name: string;
  email: string;
}

interface Enrollment {
  id: string;
  studentId: string;
  student: Student;
}

interface ClassDetail {
  id: string;
  name: string;
  description?: string;
  enrollments: Enrollment[];
}

interface Assignment {
  id: string;
  title: string;
  type: string;
  dueDate: string;
  maxScore: number;
  _count?: { submissions: number };
}

interface ClassAnalytics {
  averageScore: number;
  topPerformers: { studentId: string; name: string; avg: number }[];
  bottomPerformers: { studentId: string; name: string; avg: number }[];
}

type Tab = "students" | "assignments" | "stats";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("ko-KR", {
    month: "short",
    day: "numeric",
  });
}

export default function ClassDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<Tab>("students");
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [inviteStudentName, setInviteStudentName] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const classQuery = useQuery({
    queryKey: ["class", id],
    queryFn: () => api.get<ClassDetail>(`/classes/${id}`),
  });

  const assignmentsQuery = useQuery({
    queryKey: ["assignments", id],
    queryFn: () => api.get<Assignment[]>(`/classes/${id}/assignments`),
    enabled: activeTab === "assignments",
  });

  const analyticsQuery = useQuery({
    queryKey: ["analytics", "class", id],
    queryFn: () => api.get<ClassAnalytics>(`/analytics/class/${id}`),
    enabled: activeTab === "stats",
  });

  const inviteMutation = useMutation({
    mutationFn: (studentId: string) =>
      api.post<{ code: string }>("/parent-links/invite", {
        studentId,
        classId: id,
      }),
    onSuccess: (data) => setInviteCode(data.code),
    onError: (err) => Alert.alert("오류", err.message),
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await classQuery.refetch();
    if (activeTab === "assignments") await assignmentsQuery.refetch();
    if (activeTab === "stats") await analyticsQuery.refetch();
    setRefreshing(false);
  }, [classQuery, assignmentsQuery, analyticsQuery, activeTab]);

  const classData = classQuery.data;
  const assignments = assignmentsQuery.data ?? [];
  const analytics = analyticsQuery.data;

  if (classQuery.isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-brand-dark">
        <ActivityIndicator size="large" color="#d4a574" />
      </View>
    );
  }

  if (!classData) {
    return (
      <View className="flex-1 items-center justify-center bg-brand-dark">
        <Text className="text-[#888]">반 정보를 불러올 수 없습니다</Text>
      </View>
    );
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: "students", label: "학생" },
    { key: "assignments", label: "과제" },
    { key: "stats", label: "통계" },
  ];

  function handleInvite(student: Student) {
    setInviteStudentName(student.name);
    inviteMutation.mutate(student.id);
  }

  return (
    <SafeAreaView edges={["bottom"]} className="flex-1 bg-brand-dark">
      <Stack.Screen options={{ title: classData.name }} />

      <FlatList
        data={[]}
        renderItem={null}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#d4a574"
          />
        }
        ListHeaderComponent={
          <View className="px-4 pt-2 pb-8">
            {/* Class Info */}
            {classData.description && (
              <Text className="text-[#888] text-sm mb-4">
                {classData.description}
              </Text>
            )}

            {/* Tabs */}
            <View className="flex-row bg-[#2a2a2a] rounded-xl p-1 mb-4">
              {tabs.map((tab) => (
                <Pressable
                  key={tab.key}
                  className={`flex-1 py-2 rounded-lg items-center ${
                    activeTab === tab.key ? "bg-brand-accent" : ""
                  }`}
                  onPress={() => setActiveTab(tab.key)}
                >
                  <Text
                    className={`font-medium text-sm ${
                      activeTab === tab.key
                        ? "text-brand-dark"
                        : "text-[#888]"
                    }`}
                  >
                    {tab.label}
                  </Text>
                </Pressable>
              ))}
            </View>

            {/* Students Tab */}
            {activeTab === "students" && (
              <View>
                <Text className="text-[#aaa] text-sm mb-2">
                  {classData.enrollments.length}명
                </Text>
                {classData.enrollments.map((enrollment) => (
                  <View
                    key={enrollment.id}
                    className="bg-[#2a2a2a] rounded-xl p-4 mb-2 flex-row justify-between items-center"
                  >
                    <View>
                      <Text className="text-brand-beige font-medium">
                        {enrollment.student.name}
                      </Text>
                      <Text className="text-[#666] text-xs mt-0.5">
                        {enrollment.student.email}
                      </Text>
                    </View>
                    <Pressable
                      className="bg-[#3a3a3a] rounded-lg px-3 py-1.5"
                      onPress={() => handleInvite(enrollment.student)}
                    >
                      <Text className="text-brand-accent text-xs font-medium">
                        학부모 초대
                      </Text>
                    </Pressable>
                  </View>
                ))}
              </View>
            )}

            {/* Assignments Tab */}
            {activeTab === "assignments" && (
              <View>
                <Pressable
                  className="bg-brand-accent rounded-xl py-3 items-center mb-4"
                  onPress={() =>
                    router.push(
                      `/(teacher)/assignment/new?classId=${id}` as never
                    )
                  }
                >
                  <Text className="text-brand-dark font-bold text-base">
                    과제 출제
                  </Text>
                </Pressable>

                {assignmentsQuery.isLoading ? (
                  <ActivityIndicator color="#d4a574" />
                ) : assignments.length === 0 ? (
                  <View className="bg-[#2a2a2a] rounded-xl p-4">
                    <Text className="text-[#888] text-center">
                      출제된 과제가 없습니다
                    </Text>
                  </View>
                ) : (
                  assignments.map((a) => (
                    <View
                      key={a.id}
                      className="bg-[#2a2a2a] rounded-xl p-4 mb-2"
                    >
                      <View className="flex-row justify-between items-start">
                        <Text className="text-brand-beige font-bold flex-1">
                          {a.title}
                        </Text>
                        <View className="bg-[#3a3a3a] rounded-full px-2 py-0.5">
                          <Text className="text-[#aaa] text-xs">
                            {a._count?.submissions ?? 0}건 제출
                          </Text>
                        </View>
                      </View>
                      <View className="flex-row gap-3 mt-1">
                        <Text className="text-[#666] text-xs">
                          {a.type === "problem_set" ? "문제풀이" : "일반과제"}
                        </Text>
                        <Text className="text-[#666] text-xs">
                          마감: {formatDate(a.dueDate)}
                        </Text>
                        <Text className="text-[#666] text-xs">
                          {a.maxScore}점
                        </Text>
                      </View>
                    </View>
                  ))
                )}
              </View>
            )}

            {/* Stats Tab */}
            {activeTab === "stats" && (
              <View>
                {analyticsQuery.isLoading ? (
                  <ActivityIndicator color="#d4a574" />
                ) : !analytics ? (
                  <View className="bg-[#2a2a2a] rounded-xl p-4">
                    <Text className="text-[#888] text-center">
                      통계 데이터가 없습니다
                    </Text>
                  </View>
                ) : (
                  <>
                    {/* Average Score */}
                    <View className="bg-[#2a2a2a] rounded-xl p-5 mb-3 items-center">
                      <Text className="text-[#888] text-sm mb-1">반 평균</Text>
                      <Text className="text-brand-accent text-3xl font-bold">
                        {analytics.averageScore.toFixed(1)}
                      </Text>
                    </View>

                    {/* Top Performers */}
                    {analytics.topPerformers.length > 0 && (
                      <View className="mb-3">
                        <Text className="text-brand-beige font-bold mb-2">
                          상위 학생
                        </Text>
                        {analytics.topPerformers.map((s, i) => (
                          <View
                            key={s.studentId}
                            className="bg-[#2a2a2a] rounded-xl p-3 mb-1 flex-row justify-between"
                          >
                            <Text className="text-brand-beige">
                              {i + 1}. {s.name}
                            </Text>
                            <Text className="text-[#4ade80] font-medium">
                              {s.avg.toFixed(1)}
                            </Text>
                          </View>
                        ))}
                      </View>
                    )}

                    {/* Bottom Performers */}
                    {analytics.bottomPerformers.length > 0 && (
                      <View>
                        <Text className="text-brand-beige font-bold mb-2">
                          하위 학생
                        </Text>
                        {analytics.bottomPerformers.map((s, i) => (
                          <View
                            key={s.studentId}
                            className="bg-[#2a2a2a] rounded-xl p-3 mb-1 flex-row justify-between"
                          >
                            <Text className="text-brand-beige">
                              {i + 1}. {s.name}
                            </Text>
                            <Text className="text-[#f87171] font-medium">
                              {s.avg.toFixed(1)}
                            </Text>
                          </View>
                        ))}
                      </View>
                    )}
                  </>
                )}
              </View>
            )}
          </View>
        }
      />

      {/* Invite Code Modal */}
      <Modal
        visible={inviteCode !== null}
        animationType="fade"
        transparent
      >
        <View className="flex-1 justify-center items-center bg-black/60 px-8">
          <View className="bg-[#2a2a2a] rounded-2xl p-6 w-full items-center">
            <Text className="text-brand-beige text-lg font-bold mb-2">
              학부모 초대코드
            </Text>
            <Text className="text-[#888] text-sm mb-4">
              {inviteStudentName} 학생의 학부모에게 전달하세요
            </Text>
            <View className="bg-[#3a3a3a] rounded-xl px-8 py-4 mb-5">
              <Text className="text-brand-accent text-3xl font-bold tracking-widest">
                {inviteCode}
              </Text>
            </View>
            <Pressable
              className="bg-brand-accent rounded-xl px-8 py-3"
              onPress={() => setInviteCode(null)}
            >
              <Text className="text-brand-dark font-bold">확인</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
