import { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  RefreshControl,
  ActivityIndicator,
  FlatList,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight } from "lucide-react-native";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type StudySection =
  | "wrong"
  | "review"
  | "mastery"
  | "weakness"
  | "prediction";

const SECTIONS: { key: StudySection; label: string }[] = [
  { key: "wrong", label: "오답노트" },
  { key: "review", label: "복습" },
  { key: "mastery", label: "진도" },
  { key: "weakness", label: "취약분석" },
  { key: "prediction", label: "등급예측" },
];

// -- Wrong Answers --
interface WrongAnswerStats {
  total: number;
  resolved: number;
  unresolved: number;
  byErrorType: Record<string, number>;
}

interface WrongAnswer {
  id: string;
  problemContent: string;
  solution: string;
  errorType: string;
  studentAnswer: string | null;
  createdAt: string;
  resolved: boolean;
  retryCount: number;
}

interface WrongAnswersResponse {
  items: WrongAnswer[];
  total: number;
}

// -- Daily Review --
interface ReviewStats {
  dueToday: number;
  completedToday: number;
}

interface ReviewProblem {
  reviewScheduleId: string;
  wrongAnswerId: string;
  errorType: string;
  interval: number;
  repetitions: number;
  lastReviewedAt: string | null;
  problem: {
    id: string;
    stemLatex: string;
    stemText: string;
    answerText: string | null;
    answerLatex: string | null;
    solutionText: string | null;
    choices: Array<{
      label: string;
      contentLatex: string;
      contentText: string;
      position: number;
    }>;
  } | null;
}

interface DailyReviewResponse {
  dueCount: number;
  problems: ReviewProblem[];
}

// -- Mastery --
type MasteryState = "mastered" | "practicing" | "learning" | "not_started";

interface MasteryDashboard {
  progressPercent: number;
  mastered: number;
  practicing: number;
  learning: number;
  total: number;
}

interface MasteryNode {
  id: string;
  label: string;
  children: MasteryNode[];
  mastery: {
    state: MasteryState;
    consecutiveCorrect: number;
    totalAttempts: number;
    totalCorrect: number;
  } | null;
}

// -- Weakness Analysis --
interface WeaknessTopic {
  topic: string;
  accuracy: number;
  totalAttempts: number;
  recentTrend: "improving" | "declining" | "stable";
}

interface WeaknessAnalysis {
  weakTopics: WeaknessTopic[];
  errorDistribution: Record<string, number>;
  recommendedFocus: string[];
}

// -- Grade Prediction --
interface GradePrediction {
  predictedGrade: number;
  confidence: number;
  predictedScore: number;
  maxScore: number;
  strengths: string[];
  weaknesses: string[];
  improvementPotential: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ERROR_TYPE_LABELS: Record<string, string> = {
  calculation_error: "계산 실수",
  concept_gap: "개념 부족",
  pattern_gap: "유형 미숙",
  careless_mistake: "부주의",
};

const ERROR_TYPE_COLORS: Record<string, { bg: string; text: string }> = {
  calculation_error: { bg: "bg-red-900/40", text: "text-red-400" },
  concept_gap: { bg: "bg-purple-900/40", text: "text-purple-400" },
  pattern_gap: { bg: "bg-blue-900/40", text: "text-blue-400" },
  careless_mistake: { bg: "bg-yellow-900/40", text: "text-yellow-400" },
};

const MASTERY_STATE_CONFIG: Record<
  MasteryState,
  { label: string; dot: string; bg: string; text: string }
> = {
  mastered: { label: "완성", dot: "bg-green-400", bg: "bg-green-900/30", text: "text-green-400" },
  practicing: { label: "연습", dot: "bg-yellow-400", bg: "bg-yellow-900/30", text: "text-yellow-400" },
  learning: { label: "학습", dot: "bg-blue-400", bg: "bg-blue-900/30", text: "text-blue-400" },
  not_started: { label: "미시작", dot: "bg-gray-500", bg: "bg-[#333]", text: "text-gray-400" },
};

const QUALITY_BUTTONS = [
  { value: 0, label: "모름", bg: "bg-red-900/40", text: "text-red-400" },
  { value: 1, label: "어려움", bg: "bg-red-900/30", text: "text-red-300" },
  { value: 2, label: "헷갈림", bg: "bg-orange-900/30", text: "text-orange-400" },
  { value: 3, label: "힘듦", bg: "bg-yellow-900/30", text: "text-yellow-400" },
  { value: 4, label: "쉬움", bg: "bg-green-900/30", text: "text-green-400" },
  { value: 5, label: "완벽", bg: "bg-green-900/40", text: "text-green-300" },
] as const;

const TREND_LABELS: Record<string, { label: string; color: string }> = {
  improving: { label: "향상 중", color: "text-green-400" },
  declining: { label: "하락 중", color: "text-red-400" },
  stable: { label: "유지", color: "text-gray-400" },
};

function errorLabel(type: string) {
  return ERROR_TYPE_LABELS[type] ?? type;
}

function errorColor(type: string) {
  return ERROR_TYPE_COLORS[type] ?? ERROR_TYPE_COLORS.careless_mistake;
}

function countLeafProgress(node: MasteryNode): { mastered: number; total: number } {
  if (node.children.length === 0) {
    return { mastered: node.mastery?.state === "mastered" ? 1 : 0, total: 1 };
  }
  return node.children.reduce(
    (acc, child) => {
      const p = countLeafProgress(child);
      return { mastered: acc.mastered + p.mastered, total: acc.total + p.total };
    },
    { mastered: 0, total: 0 },
  );
}

// ---------------------------------------------------------------------------
// Section: Wrong Answers
// ---------------------------------------------------------------------------

function WrongAnswersSection() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const statsQuery = useQuery({
    queryKey: ["wrong-answers", "stats"],
    queryFn: () => api.get<WrongAnswerStats>("/wrong-answers/stats"),
  });

  const listQuery = useQuery({
    queryKey: ["wrong-answers", filter],
    queryFn: () => {
      const params = filter ? `?errorType=${filter}` : "";
      return api.get<WrongAnswersResponse>(`/wrong-answers${params}`);
    },
  });

  const retryMutation = useMutation({
    mutationFn: ({ id, isCorrect }: { id: string; isCorrect: boolean }) =>
      api.post(`/wrong-answers/${id}/retry`, { isCorrect }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["wrong-answers"] });
    },
  });

  const stats = statsQuery.data;
  const items = listQuery.data?.items ?? [];
  const errorTypes = stats
    ? Object.entries(stats.byErrorType).sort(([, a], [, b]) => b - a)
    : [];

  if (statsQuery.isLoading || listQuery.isLoading) {
    return <ActivityIndicator color="#d4a574" className="py-12" />;
  }

  return (
    <View>
      {stats && (
        <View className="flex-row mx-4 mt-4 mb-3 gap-3">
          <View className="flex-1 bg-[#2a2a2a] rounded-2xl p-4 border border-[#333]/40 items-center">
            <Text className="text-brand-accent text-2xl font-bold">{stats.total}</Text>
            <Text className="text-gray-400 text-xs mt-1">전체</Text>
          </View>
          <View className="flex-1 bg-[#2a2a2a] rounded-2xl p-4 border border-[#333]/40 items-center">
            <Text className="text-orange-400 text-2xl font-bold">{stats.unresolved}</Text>
            <Text className="text-gray-400 text-xs mt-1">미해결</Text>
          </View>
          <View className="flex-1 bg-[#2a2a2a] rounded-2xl p-4 border border-[#333]/40 items-center">
            <Text className="text-green-400 text-2xl font-bold">{stats.resolved}</Text>
            <Text className="text-gray-400 text-xs mt-1">해결</Text>
          </View>
        </View>
      )}

      {errorTypes.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}
          className="mb-4"
        >
          <Pressable
            className={`rounded-full px-4 py-2 ${filter === null ? "bg-brand-accent" : "bg-[#2a2a2a] border border-[#333]"}`}
            onPress={() => setFilter(null)}
          >
            <Text className={`text-sm font-medium ${filter === null ? "text-brand-dark" : "text-gray-400"}`}>
              전체
            </Text>
          </Pressable>
          {errorTypes.map(([type, count]) => {
            const active = filter === type;
            return (
              <Pressable
                key={type}
                className={`rounded-full px-4 py-2 ${active ? "bg-brand-accent" : "bg-[#2a2a2a] border border-[#333]"}`}
                onPress={() => setFilter(active ? null : type)}
              >
                <Text className={`text-sm font-medium ${active ? "text-brand-dark" : "text-gray-400"}`}>
                  {errorLabel(type)} ({count})
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      )}

      {items.length === 0 ? (
        <View className="items-center py-12 px-4">
          <Text className="text-gray-400 text-center">
            {filter ? "해당 유형의 오답이 없습니다" : "오답 기록이 없습니다"}
          </Text>
        </View>
      ) : (
        items.map((item) => {
          const isExpanded = expandedId === item.id;
          const color = errorColor(item.errorType);
          return (
            <Pressable
              key={item.id}
              className="bg-[#2a2a2a] rounded-2xl mx-4 mb-3 border border-[#333]/40 overflow-hidden"
              onPress={() => setExpandedId(isExpanded ? null : item.id)}
            >
              <View className="p-4">
                <View className="flex-row items-center justify-between mb-1">
                  <Text className="text-brand-beige font-medium flex-1 mr-2" numberOfLines={isExpanded ? undefined : 2}>
                    {item.problemContent}
                  </Text>
                  <View className={`rounded-full px-2.5 py-1 ${color.bg}`}>
                    <Text className={`text-xs ${color.text}`}>{errorLabel(item.errorType)}</Text>
                  </View>
                </View>
                <View className="flex-row items-center justify-between mt-1">
                  <Text className="text-gray-500 text-xs">
                    {new Date(item.createdAt).toLocaleDateString("ko-KR")}
                  </Text>
                  <Text className={`text-xs ${item.resolved ? "text-green-400" : "text-orange-400"}`}>
                    {item.resolved ? "해결됨" : "미해결"}
                  </Text>
                </View>
              </View>

              {isExpanded && (
                <View className="border-t border-[#333] px-4 py-3">
                  <Text className="text-gray-400 text-xs mb-1">내 답안</Text>
                  <Text className="text-red-400 text-sm mb-3">{item.studentAnswer ?? "기록 없음"}</Text>
                  <Text className="text-gray-400 text-xs mb-1">풀이</Text>
                  <Text className="text-brand-beige text-sm mb-4">{item.solution || "등록된 풀이가 없습니다"}</Text>
                  <View className="flex-row gap-2">
                    <Pressable
                      className="flex-1 bg-green-900/20 rounded-xl py-3 items-center border border-green-900/30"
                      onPress={() => retryMutation.mutate({ id: item.id, isCorrect: true })}
                      disabled={retryMutation.isPending}
                    >
                      <Text className="text-green-400 font-semibold text-sm">맞았어요</Text>
                    </Pressable>
                    <Pressable
                      className="flex-1 bg-brand-accent/20 rounded-xl py-3 items-center"
                      onPress={() => retryMutation.mutate({ id: item.id, isCorrect: false })}
                      disabled={retryMutation.isPending}
                    >
                      <Text className="text-brand-accent font-semibold text-sm">아직 어려워요</Text>
                    </Pressable>
                  </View>
                </View>
              )}
            </Pressable>
          );
        })
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Section: Daily Review (SM-2)
// ---------------------------------------------------------------------------

function DailyReviewSection() {
  const queryClient = useQueryClient();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showSolution, setShowSolution] = useState(false);
  const [completedCount, setCompletedCount] = useState(0);

  const statsQuery = useQuery({
    queryKey: ["reviews", "stats"],
    queryFn: () => api.get<ReviewStats>("/reviews/stats"),
  });

  const reviewsQuery = useQuery({
    queryKey: ["reviews", "daily"],
    queryFn: () => api.get<DailyReviewResponse>("/reviews/daily"),
  });

  const gradeMutation = useMutation({
    mutationFn: ({ id, quality }: { id: string; quality: number }) =>
      api.post(`/reviews/${id}/grade`, { quality }),
    onSuccess: () => {
      setShowSolution(false);
      setCompletedCount((c) => c + 1);
      const items = reviewsQuery.data?.problems ?? [];
      if (currentIndex < items.length - 1) {
        setCurrentIndex((i) => i + 1);
      } else {
        queryClient.invalidateQueries({ queryKey: ["reviews"] });
        setCurrentIndex(0);
      }
    },
  });

  const stats = statsQuery.data;
  const items = reviewsQuery.data?.problems ?? [];
  const currentItem = items[currentIndex];
  const totalItems = items.length;

  if (statsQuery.isLoading || reviewsQuery.isLoading) {
    return <ActivityIndicator color="#d4a574" className="py-12" />;
  }

  if (totalItems === 0) {
    return (
      <View className="items-center py-12 px-4">
        {stats && (
          <View className="flex-row gap-4 mb-8 w-full">
            <View className="flex-1 bg-[#2a2a2a] rounded-2xl p-5 border border-[#333]/40 items-center">
              <Text className="text-brand-accent text-2xl font-bold">{stats.dueToday}</Text>
              <Text className="text-gray-400 text-xs mt-1">오늘 예정</Text>
            </View>
            <View className="flex-1 bg-[#2a2a2a] rounded-2xl p-5 border border-[#333]/40 items-center">
              <Text className="text-green-400 text-2xl font-bold">{stats.completedToday}</Text>
              <Text className="text-gray-400 text-xs mt-1">완료</Text>
            </View>
          </View>
        )}
        <Text className="text-brand-beige text-lg font-semibold mb-2">복습 완료!</Text>
        <Text className="text-gray-400 text-center text-sm">
          오늘의 복습을 모두 마쳤습니다.{"\n"}내일 다시 확인해 주세요.
        </Text>
      </View>
    );
  }

  return (
    <View className="px-4 pt-4">
      {stats && (
        <View className="flex-row gap-3 mb-4">
          <View className="flex-1 bg-[#2a2a2a] rounded-2xl p-4 border border-[#333]/40 items-center">
            <Text className="text-brand-accent text-xl font-bold">{stats.dueToday}</Text>
            <Text className="text-gray-400 text-xs mt-1">오늘 예정</Text>
          </View>
          <View className="flex-1 bg-[#2a2a2a] rounded-2xl p-4 border border-[#333]/40 items-center">
            <Text className="text-green-400 text-xl font-bold">{stats.completedToday + completedCount}</Text>
            <Text className="text-gray-400 text-xs mt-1">완료</Text>
          </View>
        </View>
      )}

      <View className="mb-4">
        <View className="flex-row items-center justify-between mb-1.5">
          <Text className="text-gray-400 text-xs">진행도</Text>
          <Text className="text-gray-400 text-xs">{currentIndex + 1}/{totalItems}</Text>
        </View>
        <View className="h-2 bg-[#333] rounded-full overflow-hidden">
          <View
            className="h-full bg-brand-accent rounded-full"
            style={{ width: `${((currentIndex + 1) / totalItems) * 100}%` }}
          />
        </View>
      </View>

      {currentItem?.problem && (
        <View>
          <View className="bg-[#2a2a2a] rounded-2xl border border-[#333]/40 overflow-hidden">
            <View className="p-5">
              <Text className="text-gray-400 text-xs mb-2">문제</Text>
              <Text className="text-brand-beige text-base leading-6">
                {currentItem.problem.stemLatex || currentItem.problem.stemText}
              </Text>
              {currentItem.problem.choices.length > 0 && (
                <View className="mt-4 gap-2">
                  {currentItem.problem.choices.map((choice) => (
                    <Text
                      key={`${currentItem.reviewScheduleId}-${choice.position}`}
                      className="text-brand-beige/80 text-sm leading-6"
                    >
                      {choice.label}. {choice.contentLatex || choice.contentText}
                    </Text>
                  ))}
                </View>
              )}
            </View>

            {!showSolution ? (
              <Pressable
                className="border-t border-[#333] py-4 items-center"
                onPress={() => setShowSolution(true)}
              >
                <Text className="text-brand-accent font-semibold text-sm">정답 보기</Text>
              </Pressable>
            ) : (
              <View className="border-t border-[#333] p-5">
                <Text className="text-gray-400 text-xs mb-2">정답</Text>
                <Text className="text-green-400 text-sm leading-6 mb-4">
                  {currentItem.problem.answerLatex || currentItem.problem.answerText || "등록된 정답이 없습니다"}
                </Text>
                <Text className="text-gray-400 text-xs mb-2">풀이</Text>
                <Text className="text-brand-beige text-base leading-6">
                  {currentItem.problem.solutionText || "등록된 풀이가 없습니다"}
                </Text>
              </View>
            )}
          </View>

          {showSolution && (
            <View className="mt-4">
              <Text className="text-gray-400 text-xs mb-3 text-center">얼마나 잘 기억했나요?</Text>
              <View className="flex-row flex-wrap gap-2">
                {QUALITY_BUTTONS.map((button) => (
                  <Pressable
                    key={button.value}
                    className={`flex-1 min-w-[30%] rounded-xl py-3 items-center ${button.bg}`}
                    onPress={() =>
                      gradeMutation.mutate({ id: currentItem.reviewScheduleId, quality: button.value })
                    }
                    disabled={gradeMutation.isPending}
                  >
                    <Text className={`text-lg font-bold ${button.text}`}>{button.value}</Text>
                    <Text className={`text-xs mt-0.5 ${button.text}`}>{button.label}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Section: Mastery Tree
// ---------------------------------------------------------------------------

function MasterySection() {
  const [year, setYear] = useState<number>(2022);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());

  const dashboardQuery = useQuery({
    queryKey: ["mastery", "dashboard"],
    queryFn: () => api.get<MasteryDashboard>("/mastery/dashboard"),
  });

  const treeQuery = useQuery({
    queryKey: ["mastery", "tree", year],
    queryFn: () => api.get<MasteryNode[]>(`/mastery/tree?year=${year}`),
  });

  useEffect(() => {
    if (treeQuery.data) {
      setExpandedNodes(new Set(treeQuery.data.map((n) => n.id)));
    }
  }, [treeQuery.data]);

  const toggleNode = useCallback((id: string) => {
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const dashboard = dashboardQuery.data;
  const tree = treeQuery.data ?? [];
  const totalActive = useMemo(
    () => (dashboard ? dashboard.mastered + dashboard.practicing + dashboard.learning : 0),
    [dashboard],
  );

  const renderNode = useCallback(
    (node: MasteryNode, depth: number) => {
      const hasChildren = node.children.length > 0;
      const isOpen = expandedNodes.has(node.id);
      const state = node.mastery?.state ?? "not_started";
      const config = MASTERY_STATE_CONFIG[state];
      const progress = hasChildren ? countLeafProgress(node) : null;

      return (
        <View key={node.id} style={{ marginLeft: depth * 16 }}>
          <Pressable
            className={`rounded-xl px-4 py-3 flex-row items-center ${
              depth === 0 ? "bg-[#2a2a2a] border border-[#333]/40" : "bg-[#252525] mt-1"
            }`}
            onPress={() => hasChildren && toggleNode(node.id)}
          >
            {hasChildren ? (
              isOpen ? (
                <ChevronDown color={depth === 0 ? "#d4a574" : "#999"} size={16} />
              ) : (
                <ChevronRight color="#666" size={16} />
              )
            ) : (
              <View className={`w-2.5 h-2.5 rounded-full mr-2 ${config.dot}`} />
            )}
            <Text className="text-brand-beige font-medium ml-2 flex-1 text-sm">{node.label}</Text>
            {hasChildren && progress ? (
              <Text className="text-gray-500 text-xs">{progress.mastered}/{progress.total}</Text>
            ) : (
              <View className={`rounded-full px-2 py-0.5 ${config.bg}`}>
                <Text className={`text-[10px] ${config.text}`}>{config.label}</Text>
              </View>
            )}
          </Pressable>
          {!hasChildren && node.mastery && (
            <View className="ml-6 mt-1 mb-1">
              <Text className="text-gray-500 text-xs">
                {node.mastery.consecutiveCorrect}연속 / {node.mastery.totalAttempts}회
              </Text>
            </View>
          )}
          {hasChildren && isOpen && (
            <View className="mt-1">{node.children.map((child) => renderNode(child, depth + 1))}</View>
          )}
        </View>
      );
    },
    [expandedNodes, toggleNode],
  );

  if (dashboardQuery.isLoading || treeQuery.isLoading) {
    return <ActivityIndicator color="#d4a574" className="py-12" />;
  }

  return (
    <View>
      {dashboard && (
        <View className="px-4 pt-4">
          <View className="bg-[#2a2a2a] rounded-2xl p-6 border border-[#333]/40 items-center mb-4">
            <Text className="text-gray-400 text-sm mb-2">전체 진도</Text>
            <View className="w-24 h-24 rounded-full border-4 border-[#3a3a3a] items-center justify-center">
              <Text className="text-brand-accent text-2xl font-bold">{dashboard.progressPercent}%</Text>
            </View>
            <Text className="text-gray-500 text-xs mt-2">{totalActive}/{dashboard.total} 주제</Text>
          </View>
          <View className="flex-row gap-3 mb-4">
            <View className="flex-1 bg-green-900/20 rounded-xl p-3 items-center border border-green-900/30">
              <Text className="text-green-400 text-xl font-bold">{dashboard.mastered}</Text>
              <Text className="text-green-400/70 text-xs mt-0.5">완성</Text>
            </View>
            <View className="flex-1 bg-yellow-900/20 rounded-xl p-3 items-center border border-yellow-900/30">
              <Text className="text-yellow-400 text-xl font-bold">{dashboard.practicing}</Text>
              <Text className="text-yellow-400/70 text-xs mt-0.5">연습</Text>
            </View>
            <View className="flex-1 bg-blue-900/20 rounded-xl p-3 items-center border border-blue-900/30">
              <Text className="text-blue-400 text-xl font-bold">{dashboard.learning}</Text>
              <Text className="text-blue-400/70 text-xs mt-0.5">학습</Text>
            </View>
          </View>
        </View>
      )}

      <View className="flex-row mx-4 mb-4 bg-[#2a2a2a] rounded-xl p-1 border border-[#333]/40">
        {([2015, 2022] as const).map((y) => (
          <Pressable
            key={y}
            className={`flex-1 rounded-lg py-2.5 items-center ${year === y ? "bg-brand-accent" : ""}`}
            onPress={() => setYear(y)}
          >
            <Text className={`text-sm font-medium ${year === y ? "text-brand-dark" : "text-gray-400"}`}>
              {y} 교육과정
            </Text>
          </Pressable>
        ))}
      </View>

      {tree.length === 0 ? (
        <View className="items-center py-12 px-4">
          <Text className="text-gray-400 text-center">교육과정 데이터가 없습니다</Text>
        </View>
      ) : (
        <View className="mx-4 gap-2">{tree.map((node) => renderNode(node, 0))}</View>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Section: Weakness Analysis
// ---------------------------------------------------------------------------

function WeaknessSection() {
  const { user } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ["weakness", user?.id],
    queryFn: () => api.get<WeaknessAnalysis>(`/analytics/student/${user!.id}/weakness`),
    enabled: !!user?.id,
  });

  if (isLoading || !data) {
    return <ActivityIndicator color="#d4a574" className="py-12" />;
  }

  const errorEntries = Object.entries(data.errorDistribution).sort(([, a], [, b]) => b - a);
  const totalErrors = errorEntries.reduce((sum, [, count]) => sum + count, 0);

  return (
    <View className="px-4 pt-4">
      {data.weakTopics.length === 0 ? (
        <View className="bg-[#2a2a2a] rounded-2xl p-8 border border-[#333]/40 items-center">
          <Text className="text-green-400 text-lg font-bold mb-2">취약 단원이 없습니다</Text>
          <Text className="text-gray-400 text-sm text-center">모든 단원에서 고르게 학습하고 있어요!</Text>
        </View>
      ) : (
        <>
          <Text className="text-brand-beige text-base font-bold mb-3">취약 단원</Text>
          {data.weakTopics.map((topic) => {
            const pct = Math.round(topic.accuracy * 100);
            const barColor = pct >= 60 ? "bg-yellow-500" : "bg-red-500";
            const trend = TREND_LABELS[topic.recentTrend] ?? TREND_LABELS.stable;
            return (
              <View
                key={topic.topic}
                className="bg-[#2a2a2a] rounded-2xl p-4 mb-3 border border-[#333]/40"
              >
                <View className="flex-row items-center justify-between mb-2">
                  <Text className="text-brand-beige font-medium flex-1 mr-2">{topic.topic}</Text>
                  <Text className={`text-xs font-medium ${trend.color}`}>{trend.label}</Text>
                </View>
                <View className="flex-row items-center justify-between mb-1">
                  <Text className="text-gray-400 text-xs">정답률</Text>
                  <Text className="text-gray-400 text-xs">{pct}%</Text>
                </View>
                <View className="h-2 bg-[#333] rounded-full overflow-hidden">
                  <View className={`h-full rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
                </View>
                <Text className="text-gray-500 text-xs mt-1.5">
                  {topic.totalAttempts}문제 풀이
                </Text>
              </View>
            );
          })}
        </>
      )}

      {errorEntries.length > 0 && (
        <View className="mt-4">
          <Text className="text-brand-beige text-base font-bold mb-3">오류 유형 분포</Text>
          <View className="bg-[#2a2a2a] rounded-2xl p-4 border border-[#333]/40">
            {errorEntries.map(([type, count]) => {
              const pct = totalErrors > 0 ? Math.round((count / totalErrors) * 100) : 0;
              const color = errorColor(type);
              return (
                <View key={type} className="flex-row items-center mb-3 last:mb-0">
                  <View className={`rounded-full px-2.5 py-1 mr-3 ${color.bg}`}>
                    <Text className={`text-xs ${color.text}`}>{errorLabel(type)}</Text>
                  </View>
                  <View className="flex-1 h-2 bg-[#333] rounded-full overflow-hidden mr-3">
                    <View className="h-full rounded-full bg-brand-accent" style={{ width: `${pct}%` }} />
                  </View>
                  <Text className="text-gray-400 text-xs w-10 text-right">{pct}%</Text>
                </View>
              );
            })}
          </View>
        </View>
      )}

      {data.recommendedFocus.length > 0 && (
        <View className="mt-4">
          <Text className="text-brand-beige text-base font-bold mb-3">추천 학습</Text>
          {data.recommendedFocus.map((topic, i) => (
            <View
              key={i}
              className="bg-brand-accent/10 rounded-2xl p-4 mb-2 border border-brand-accent/20 flex-row items-center"
            >
              <View className="bg-brand-accent/20 rounded-full w-7 h-7 items-center justify-center mr-3">
                <Text className="text-brand-accent font-bold text-xs">{i + 1}</Text>
              </View>
              <Text className="text-brand-beige text-sm flex-1">{topic}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Section: Grade Prediction
// ---------------------------------------------------------------------------

function GradePredictionSection() {
  const { user } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ["prediction", user?.id],
    queryFn: () => api.get<GradePrediction>(`/analytics/student/${user!.id}/grade-prediction`),
    enabled: !!user?.id,
  });

  if (isLoading || !data) {
    return <ActivityIndicator color="#d4a574" className="py-12" />;
  }

  const scorePct = data.maxScore > 0 ? Math.round((data.predictedScore / data.maxScore) * 100) : 0;
  const gradeColor =
    data.predictedGrade <= 2
      ? "text-green-400"
      : data.predictedGrade <= 4
        ? "text-yellow-400"
        : "text-red-400";

  return (
    <View className="px-4 pt-4">
      <View className="bg-[#2a2a2a] rounded-2xl p-6 border border-[#333]/40 items-center mb-4">
        <Text className="text-gray-400 text-sm mb-2">예측 등급</Text>
        <View className="w-28 h-28 rounded-full border-4 border-[#3a3a3a] items-center justify-center">
          <Text className={`text-4xl font-bold ${gradeColor}`}>{data.predictedGrade}</Text>
          <Text className="text-gray-400 text-xs">등급</Text>
        </View>
        <Text className="text-gray-500 text-xs mt-3">
          신뢰도 {Math.round(data.confidence * 100)}%
        </Text>
      </View>

      <View className="flex-row gap-3 mb-4">
        <View className="flex-1 bg-[#2a2a2a] rounded-2xl p-4 border border-[#333]/40 items-center">
          <Text className="text-brand-accent text-xl font-bold">{data.predictedScore}</Text>
          <Text className="text-gray-400 text-xs mt-1">예상 점수</Text>
        </View>
        <View className="flex-1 bg-[#2a2a2a] rounded-2xl p-4 border border-[#333]/40 items-center">
          <Text className="text-brand-accent text-xl font-bold">{scorePct}%</Text>
          <Text className="text-gray-400 text-xs mt-1">예상 백분위</Text>
        </View>
      </View>

      <View className="bg-brand-accent/10 rounded-2xl p-4 border border-brand-accent/20 mb-4">
        <View className="flex-row items-center justify-between mb-2">
          <Text className="text-brand-accent font-bold text-sm">향상 가능성</Text>
          <Text className="text-brand-accent font-bold">{Math.round(data.improvementPotential * 100)}%</Text>
        </View>
        <View className="h-2.5 bg-[#333] rounded-full overflow-hidden">
          <View
            className="h-full rounded-full bg-brand-accent"
            style={{ width: `${data.improvementPotential * 100}%` }}
          />
        </View>
      </View>

      {data.strengths.length > 0 && (
        <View className="mb-4">
          <Text className="text-brand-beige text-base font-bold mb-3">강점</Text>
          {data.strengths.map((s, i) => (
            <View
              key={i}
              className="bg-green-900/20 rounded-xl p-3 mb-2 border border-green-900/30 flex-row items-center"
            >
              <Text className="text-green-400 mr-2">+</Text>
              <Text className="text-brand-beige text-sm flex-1">{s}</Text>
            </View>
          ))}
        </View>
      )}

      {data.weaknesses.length > 0 && (
        <View>
          <Text className="text-brand-beige text-base font-bold mb-3">보완 필요</Text>
          {data.weaknesses.map((w, i) => (
            <View
              key={i}
              className="bg-red-900/20 rounded-xl p-3 mb-2 border border-red-900/30 flex-row items-center"
            >
              <Text className="text-red-400 mr-2">-</Text>
              <Text className="text-brand-beige text-sm flex-1">{w}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Main: Study Tab
// ---------------------------------------------------------------------------

export default function StudyScreen() {
  const queryClient = useQueryClient();
  const [activeSection, setActiveSection] = useState<StudySection>("wrong");

  const onRefresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["wrong-answers"] });
    queryClient.invalidateQueries({ queryKey: ["reviews"] });
    queryClient.invalidateQueries({ queryKey: ["mastery"] });
    queryClient.invalidateQueries({ queryKey: ["weakness"] });
    queryClient.invalidateQueries({ queryKey: ["prediction"] });
  }, [queryClient]);

  const isRefreshing = false;

  return (
    <SafeAreaView className="flex-1 bg-brand-dark" edges={["left", "right"]}>
      <ScrollView
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} tintColor="#d4a574" />
        }
        contentContainerStyle={{ paddingBottom: 24 }}
        stickyHeaderIndices={[0]}
      >
        <View className="bg-brand-dark pb-2 pt-2">
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 16, gap: 6 }}
          >
            {SECTIONS.map((section) => {
              const active = activeSection === section.key;
              return (
                <Pressable
                  key={section.key}
                  className={`rounded-full px-4 py-2 ${
                    active ? "bg-brand-accent" : "bg-[#2a2a2a] border border-[#333]"
                  }`}
                  onPress={() => setActiveSection(section.key)}
                >
                  <Text
                    className={`text-sm font-medium ${
                      active ? "text-brand-dark" : "text-gray-400"
                    }`}
                  >
                    {section.label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        {activeSection === "wrong" && <WrongAnswersSection />}
        {activeSection === "review" && <DailyReviewSection />}
        {activeSection === "mastery" && <MasterySection />}
        {activeSection === "weakness" && <WeaknessSection />}
        {activeSection === "prediction" && <GradePredictionSection />}
      </ScrollView>
    </SafeAreaView>
  );
}
