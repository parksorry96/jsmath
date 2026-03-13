import { useCallback, useState } from "react";
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

interface MasteryDashboard {
  progressPercent: number;
  mastered: number;
  practicing: number;
  learning: number;
  total: number;
}

interface Topic {
  id: string;
  name: string;
  state: "mastered" | "practicing" | "learning" | "not_started";
}

interface Unit {
  id: string;
  name: string;
  topics: Topic[];
}

interface Subject {
  id: string;
  name: string;
  units: Unit[];
}

const MASTERY_STATE: Record<
  string,
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

function stateConfig(state: string) {
  return MASTERY_STATE[state] ?? MASTERY_STATE.not_started;
}

const YEARS = [2015, 2022] as const;

export default function MasteryScreen() {
  const queryClient = useQueryClient();
  const [year, setYear] = useState<number>(2022);
  const [expandedSubjects, setExpandedSubjects] = useState<Set<string>>(
    new Set(),
  );
  const [expandedUnits, setExpandedUnits] = useState<Set<string>>(new Set());

  const dashboardQuery = useQuery({
    queryKey: ["mastery", "dashboard"],
    queryFn: () => api.get<MasteryDashboard>("/mastery/dashboard"),
  });

  const treeQuery = useQuery({
    queryKey: ["mastery", "tree", year],
    queryFn: () => api.get<Subject[]>(`/mastery/tree?year=${year}`),
  });

  const onRefresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["mastery"] });
  }, [queryClient]);

  const toggleSubject = useCallback((id: string) => {
    setExpandedSubjects((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleUnit = useCallback((id: string) => {
    setExpandedUnits((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const isLoading = dashboardQuery.isLoading || treeQuery.isLoading;
  const isRefreshing = dashboardQuery.isRefetching || treeQuery.isRefetching;
  const dashboard = dashboardQuery.data;
  const tree = treeQuery.data ?? [];

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
        {/* Dashboard summary */}
        {dashboard && (
          <View className="px-4 pt-4">
            {/* Progress ring */}
            <View className="bg-[#2a2a2a] rounded-2xl p-6 border border-[#333]/40 items-center mb-4">
              <Text className="text-gray-400 text-sm mb-2">전체 진도</Text>
              <View className="w-24 h-24 rounded-full border-4 border-[#3a3a3a] items-center justify-center">
                <Text className="text-brand-accent text-2xl font-bold">
                  {dashboard.progressPercent}%
                </Text>
              </View>
              <Text className="text-gray-500 text-xs mt-2">
                {dashboard.mastered + dashboard.practicing + dashboard.learning}
                /{dashboard.total} 주제
              </Text>
            </View>

            {/* State counts */}
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

        {/* Year toggle */}
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

        {/* Curriculum tree */}
        {tree.length === 0 ? (
          <View className="items-center py-12 px-4">
            <Text className="text-gray-400 text-center">
              교육과정 데이터가 없습니다
            </Text>
          </View>
        ) : (
          tree.map((subject) => {
            const subjectOpen = expandedSubjects.has(subject.id);
            return (
              <View key={subject.id} className="mx-4 mb-2">
                <Pressable
                  className="bg-[#2a2a2a] rounded-2xl px-4 py-3.5 flex-row items-center border border-[#333]/40"
                  onPress={() => toggleSubject(subject.id)}
                >
                  {subjectOpen ? (
                    <ChevronDown color="#d4a574" size={18} />
                  ) : (
                    <ChevronRight color="#666" size={18} />
                  )}
                  <Text className="text-brand-beige font-semibold ml-2 flex-1">
                    {subject.name}
                  </Text>
                </Pressable>

                {subjectOpen &&
                  subject.units.map((unit) => {
                    const unitOpen = expandedUnits.has(unit.id);
                    return (
                      <View key={unit.id} className="ml-4 mt-1">
                        <Pressable
                          className="bg-[#252525] rounded-xl px-4 py-3 flex-row items-center"
                          onPress={() => toggleUnit(unit.id)}
                        >
                          {unitOpen ? (
                            <ChevronDown color="#999" size={16} />
                          ) : (
                            <ChevronRight color="#555" size={16} />
                          )}
                          <Text className="text-brand-beige/80 font-medium ml-2 flex-1 text-sm">
                            {unit.name}
                          </Text>
                        </Pressable>

                        {unitOpen &&
                          unit.topics.map((topic) => {
                            const cfg = stateConfig(topic.state);
                            return (
                              <View
                                key={topic.id}
                                className="ml-6 mt-1 flex-row items-center bg-[#222] rounded-lg px-3 py-2.5"
                              >
                                <View
                                  className={`w-2.5 h-2.5 rounded-full ${cfg.dot} mr-2.5`}
                                />
                                <Text className="text-brand-beige/70 text-sm flex-1">
                                  {topic.name}
                                </Text>
                                <View
                                  className={`rounded-full px-2 py-0.5 ${cfg.bg}`}
                                >
                                  <Text className={`text-[10px] ${cfg.text}`}>
                                    {cfg.label}
                                  </Text>
                                </View>
                              </View>
                            );
                          })}
                      </View>
                    );
                  })}
              </View>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
