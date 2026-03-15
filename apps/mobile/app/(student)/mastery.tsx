import { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  RefreshControl,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight } from "lucide-react-native";
import { api } from "@/lib/api";

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

const MASTERY_STATE: Record<
  MasteryState,
  { label: string; dot: string; bg: string; text: string }
> = {
  mastered: {
    label: "완성",
    dot: "bg-green-400",
    bg: "bg-green-900/30",
    text: "text-green-400",
  },
  practicing: {
    label: "연습",
    dot: "bg-yellow-400",
    bg: "bg-yellow-900/30",
    text: "text-yellow-400",
  },
  learning: {
    label: "학습",
    dot: "bg-blue-400",
    bg: "bg-blue-900/30",
    text: "text-blue-400",
  },
  not_started: {
    label: "미시작",
    dot: "bg-gray-500",
    bg: "bg-[#333]",
    text: "text-gray-400",
  },
};

const YEARS = [2015, 2022] as const;

function countLeafProgress(node: MasteryNode): { mastered: number; total: number } {
  if (node.children.length === 0) {
    return {
      mastered: node.mastery?.state === "mastered" ? 1 : 0,
      total: 1,
    };
  }

  return node.children.reduce(
    (acc, child) => {
      const childProgress = countLeafProgress(child);
      return {
        mastered: acc.mastered + childProgress.mastered,
        total: acc.total + childProgress.total,
      };
    },
    { mastered: 0, total: 0 },
  );
}

function stateConfig(state: MasteryState) {
  return MASTERY_STATE[state] ?? MASTERY_STATE.not_started;
}

export default function MasteryScreen() {
  const queryClient = useQueryClient();
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
      setExpandedNodes(new Set(treeQuery.data.map((node) => node.id)));
    }
  }, [treeQuery.data]);

  const onRefresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["mastery"] });
  }, [queryClient]);

  const toggleNode = useCallback((id: string) => {
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const isLoading = dashboardQuery.isLoading || treeQuery.isLoading;
  const isRefreshing = dashboardQuery.isRefetching || treeQuery.isRefetching;
  const dashboard = dashboardQuery.data;
  const tree = treeQuery.data ?? [];

  const renderNode = useCallback(
    (node: MasteryNode, depth: number) => {
      const hasChildren = node.children.length > 0;
      const isOpen = expandedNodes.has(node.id);
      const state = node.mastery?.state ?? "not_started";
      const config = stateConfig(state);
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

            <Text className="text-brand-beige font-medium ml-2 flex-1 text-sm">
              {node.label}
            </Text>

            {hasChildren && progress ? (
              <Text className="text-gray-500 text-xs">
                {progress.mastered}/{progress.total}
              </Text>
            ) : (
              <View className={`rounded-full px-2 py-0.5 ${config.bg}`}>
                <Text className={`text-[10px] ${config.text}`}>
                  {config.label}
                </Text>
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
            <View className="mt-1">
              {node.children.map((child) => renderNode(child, depth + 1))}
            </View>
          )}
        </View>
      );
    },
    [expandedNodes, toggleNode],
  );

  const totalActive = useMemo(() => {
    if (!dashboard) {
      return 0;
    }
    return dashboard.mastered + dashboard.practicing + dashboard.learning;
  }, [dashboard]);

  if (isLoading) {
    return (
      <SafeAreaView
        className="flex-1 bg-brand-dark items-center justify-center"
        edges={["left", "right"]}
      >
        <ActivityIndicator color="#d4a574" size="large" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-brand-dark" edges={["left", "right"]}>
      <ScrollView
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={onRefresh}
            tintColor="#d4a574"
          />
        }
        contentContainerStyle={{ paddingBottom: 24 }}
      >
        {dashboard && (
          <View className="px-4 pt-4">
            <View className="bg-[#2a2a2a] rounded-2xl p-6 border border-[#333]/40 items-center mb-4">
              <Text className="text-gray-400 text-sm mb-2">전체 진도</Text>
              <View className="w-24 h-24 rounded-full border-4 border-[#3a3a3a] items-center justify-center">
                <Text className="text-brand-accent text-2xl font-bold">
                  {dashboard.progressPercent}%
                </Text>
              </View>
              <Text className="text-gray-500 text-xs mt-2">
                {totalActive}/{dashboard.total} 주제
              </Text>
            </View>

            <View className="flex-row gap-3 mb-6">
              <View className="flex-1 bg-green-900/20 rounded-xl p-3 items-center border border-green-900/30">
                <Text className="text-green-400 text-xl font-bold">
                  {dashboard.mastered}
                </Text>
                <Text className="text-green-400/70 text-xs mt-0.5">완성</Text>
              </View>
              <View className="flex-1 bg-yellow-900/20 rounded-xl p-3 items-center border border-yellow-900/30">
                <Text className="text-yellow-400 text-xl font-bold">
                  {dashboard.practicing}
                </Text>
                <Text className="text-yellow-400/70 text-xs mt-0.5">연습</Text>
              </View>
              <View className="flex-1 bg-blue-900/20 rounded-xl p-3 items-center border border-blue-900/30">
                <Text className="text-blue-400 text-xl font-bold">
                  {dashboard.learning}
                </Text>
                <Text className="text-blue-400/70 text-xs mt-0.5">학습</Text>
              </View>
            </View>
          </View>
        )}

        <View className="flex-row mx-4 mb-4 bg-[#2a2a2a] rounded-xl p-1 border border-[#333]/40">
          {YEARS.map((y) => (
            <Pressable
              key={y}
              className={`flex-1 rounded-lg py-2.5 items-center ${
                year === y ? "bg-brand-accent" : ""
              }`}
              onPress={() => setYear(y)}
            >
              <Text
                className={`text-sm font-medium ${
                  year === y ? "text-brand-dark" : "text-gray-400"
                }`}
              >
                {y} 교육과정
              </Text>
            </Pressable>
          ))}
        </View>

        {tree.length === 0 ? (
          <View className="items-center py-12 px-4">
            <Text className="text-gray-400 text-center">
              교육과정 데이터가 없습니다
            </Text>
          </View>
        ) : (
          <View className="mx-4 gap-2">
            {tree.map((node) => renderNode(node, 0))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
