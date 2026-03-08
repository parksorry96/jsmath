import { View, Text, ScrollView, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

interface UnitAccuracy {
  unit: string;
  accuracy: number;
}

interface ScoreTrend {
  date: string;
  score: number;
}

interface Weakness {
  unit: string;
  accuracy: number;
}

interface Submission {
  id: string;
  title: string;
  score: number;
  maxScore: number;
  submittedAt: string;
}

interface ChildAnalytics {
  childName: string;
  overallAccuracy: number;
  unitAccuracies: UnitAccuracy[];
  scoreTrends: ScoreTrend[];
  weaknesses: Weakness[];
  recentSubmissions: Submission[];
}

function AccuracyBar({ label, value }: { label: string; value: number }) {
  const color =
    value >= 80 ? "#4CAF50" : value >= 60 ? "#FF9800" : "#EF5350";
  return (
    <View className="mb-3">
      <View className="flex-row justify-between mb-1">
        <Text className="text-brand-beige text-sm">{label}</Text>
        <Text className="text-gray-400 text-sm">{value}%</Text>
      </View>
      <View className="bg-[#333] rounded-full h-3">
        <View
          style={{
            backgroundColor: color,
            width: `${Math.min(value, 100)}%`,
            height: "100%",
            borderRadius: 999,
          }}
        />
      </View>
    </View>
  );
}

export default function ChildReport() {
  const { id } = useLocalSearchParams<{ id: string }>();

  const { data, isLoading } = useQuery<ChildAnalytics>({
    queryKey: ["child-analytics", id],
    queryFn: () => api.get(`/analytics/student/${id}`),
  });

  if (isLoading) {
    return (
      <SafeAreaView className="flex-1 bg-brand-dark items-center justify-center">
        <ActivityIndicator size="large" color="#d4a574" />
      </SafeAreaView>
    );
  }

  if (!data) {
    return (
      <SafeAreaView className="flex-1 bg-brand-dark items-center justify-center">
        <Text className="text-gray-500">데이터를 불러올 수 없습니다</Text>
      </SafeAreaView>
    );
  }

  const accuracyColor =
    data.overallAccuracy >= 80
      ? "#4CAF50"
      : data.overallAccuracy >= 60
        ? "#FF9800"
        : "#EF5350";

  return (
    <SafeAreaView className="flex-1 bg-brand-dark" edges={["bottom"]}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        {/* Header */}
        <Text className="text-brand-beige text-2xl font-bold mb-6">
          {data.childName}
        </Text>

        {/* Overall accuracy */}
        <View className="bg-[#2a2a2a] rounded-xl p-5 mb-4 items-center">
          <Text className="text-gray-400 text-sm mb-2">전체 정답률</Text>
          <Text
            style={{ color: accuracyColor }}
            className="text-5xl font-bold"
          >
            {data.overallAccuracy}%
          </Text>
        </View>

        {/* Unit accuracies */}
        <View className="bg-[#2a2a2a] rounded-xl p-4 mb-4">
          <Text className="text-brand-beige text-lg font-bold mb-3">
            단원별 정답률
          </Text>
          {data.unitAccuracies.map((unit) => (
            <AccuracyBar key={unit.unit} label={unit.unit} value={unit.accuracy} />
          ))}
          {data.unitAccuracies.length === 0 && (
            <Text className="text-gray-500 text-sm">데이터가 없습니다</Text>
          )}
        </View>

        {/* Score trends */}
        <View className="bg-[#2a2a2a] rounded-xl p-4 mb-4">
          <Text className="text-brand-beige text-lg font-bold mb-3">
            성적 추이
          </Text>
          {data.scoreTrends.length > 0 ? (
            <View className="flex-row items-end gap-1" style={{ height: 80 }}>
              {data.scoreTrends.map((trend, i) => {
                const maxScore = Math.max(...data.scoreTrends.map((t) => t.score), 1);
                const height = (trend.score / maxScore) * 70 + 10;
                return (
                  <View key={i} className="flex-1 items-center">
                    <Text className="text-gray-500 text-[10px] mb-1">
                      {trend.score}
                    </Text>
                    <View
                      style={{
                        height,
                        backgroundColor: "#d4a574",
                        borderRadius: 4,
                        width: "80%",
                      }}
                    />
                  </View>
                );
              })}
            </View>
          ) : (
            <Text className="text-gray-500 text-sm">데이터가 없습니다</Text>
          )}
        </View>

        {/* Weaknesses */}
        <View className="bg-[#2a2a2a] rounded-xl p-4 mb-4">
          <Text className="text-brand-beige text-lg font-bold mb-3">
            취약 단원
          </Text>
          {data.weaknesses.length > 0 ? (
            data.weaknesses.map((w) => (
              <View
                key={w.unit}
                className="flex-row justify-between py-2 border-b border-[#333]"
              >
                <Text className="text-brand-beige text-sm">{w.unit}</Text>
                <Text className="text-[#EF5350] text-sm font-bold">
                  {w.accuracy}%
                </Text>
              </View>
            ))
          ) : (
            <Text className="text-gray-500 text-sm">취약 단원이 없습니다</Text>
          )}
        </View>

        {/* Recent submissions */}
        <View className="bg-[#2a2a2a] rounded-xl p-4">
          <Text className="text-brand-beige text-lg font-bold mb-3">
            최근 과제
          </Text>
          {data.recentSubmissions.length > 0 ? (
            data.recentSubmissions.map((sub) => (
              <View
                key={sub.id}
                className="flex-row justify-between items-center py-3 border-b border-[#333]"
              >
                <View className="flex-1 mr-3">
                  <Text className="text-brand-beige text-sm">{sub.title}</Text>
                  <Text className="text-gray-500 text-xs mt-1">
                    {new Date(sub.submittedAt).toLocaleDateString("ko-KR")}
                  </Text>
                </View>
                <Text className="text-brand-accent text-base font-bold">
                  {sub.score}/{sub.maxScore}
                </Text>
              </View>
            ))
          ) : (
            <Text className="text-gray-500 text-sm">제출 내역이 없습니다</Text>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
