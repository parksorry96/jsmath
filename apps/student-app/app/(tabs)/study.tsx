import { useCallback, useState } from "react";
import { View, Text, ScrollView, Pressable, RefreshControl } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { useTheme } from "@/lib/theme";
import { WrongAnswersSection } from "@/components/study/wrong-answers-section";
import { DailyReviewSection } from "@/components/study/daily-review-section";
import { MasterySection } from "@/components/study/mastery-section";
import { WeaknessSection } from "@/components/study/weakness-section";
import { GradePredictionSection } from "@/components/study/grade-prediction-section";

type StudySection = "wrong" | "review" | "mastery" | "weakness" | "prediction";

const SECTIONS: { key: StudySection; label: string }[] = [
  { key: "wrong", label: "오답노트" },
  { key: "review", label: "복습" },
  { key: "mastery", label: "마스터리" },
  { key: "weakness", label: "약점" },
  { key: "prediction", label: "성적예측" },
];

export default function StudyScreen() {
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const [activeSection, setActiveSection] = useState<StudySection>("wrong");
  const [isRefreshing, setIsRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await queryClient.invalidateQueries();
    setIsRefreshing(false);
  }, [queryClient]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} tintColor={colors.accent} />
        }
        stickyHeaderIndices={[0]}
      >
        {/* Segmented control */}
        <View style={{ backgroundColor: colors.bg, paddingVertical: 10 }}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}
          >
            {SECTIONS.map((section) => {
              const active = activeSection === section.key;
              return (
                <Pressable
                  key={section.key}
                  onPress={() => setActiveSection(section.key)}
                  style={{
                    backgroundColor: active ? colors.accent : colors.surface,
                    borderRadius: 20,
                    paddingHorizontal: 16,
                    paddingVertical: 8,
                  }}
                >
                  <Text
                    style={{
                      color: active ? "#fff" : colors.textMuted,
                      fontSize: 13,
                      fontWeight: "600",
                    }}
                  >
                    {section.label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        {/* Active section */}
        {activeSection === "wrong" && <WrongAnswersSection />}
        {activeSection === "review" && <DailyReviewSection />}
        {activeSection === "mastery" && <MasterySection />}
        {activeSection === "weakness" && <WeaknessSection />}
        {activeSection === "prediction" && <GradePredictionSection />}
      </ScrollView>
    </View>
  );
}
