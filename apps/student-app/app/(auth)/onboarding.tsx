import { useState } from "react";
import { View, Text, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { api } from "@/lib/api";
import { useTheme } from "@/lib/theme";

const GRADES = ["중1", "중2", "중3", "고1", "고2", "고3"];

export default function OnboardingScreen() {
  const [grade, setGrade] = useState<string | null>(null);
  const [curriculum, setCurriculum] = useState<number | null>(null);
  const [step, setStep] = useState(0);
  const router = useRouter();
  const { colors } = useTheme();

  async function finish() {
    if (!grade || !curriculum) return;
    await api.patch("/auth/me/preferences", { gradeLevel: grade, curriculumYear: curriculum });
    router.replace("/(tabs)");
  }

  if (step === 0) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, padding: 32, justifyContent: "center" }}>
        <Text style={{ fontSize: 22, fontWeight: "800", color: colors.textPrimary, marginBottom: 8 }}>
          학년을 선택해주세요
        </Text>
        <Text style={{ fontSize: 14, color: colors.textMuted, marginBottom: 32 }}>
          맞춤형 문제 추천을 위해 필요해요
        </Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
          {GRADES.map((g) => (
            <Pressable
              key={g}
              onPress={() => { setGrade(g); setStep(1); }}
              style={{
                backgroundColor: grade === g ? colors.accent : colors.surface,
                borderRadius: 12, paddingVertical: 16, paddingHorizontal: 24,
                minWidth: 80, alignItems: "center",
              }}
            >
              <Text style={{ fontSize: 16, fontWeight: "600", color: grade === g ? "#fff" : colors.textPrimary }}>
                {g}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, padding: 32, justifyContent: "center" }}>
      <Text style={{ fontSize: 22, fontWeight: "800", color: colors.textPrimary, marginBottom: 8 }}>
        교육과정을 확인해주세요
      </Text>
      <Text style={{ fontSize: 14, color: colors.textMuted, marginBottom: 32 }}>
        {grade}학년 기준 교육과정이에요
      </Text>
      {[2022, 2015].map((y) => (
        <Pressable
          key={y}
          onPress={() => setCurriculum(y)}
          style={{
            backgroundColor: curriculum === y ? colors.accent : colors.surface,
            borderRadius: 12, padding: 20, marginBottom: 12,
          }}
        >
          <Text style={{ fontSize: 16, fontWeight: "600", color: curriculum === y ? "#fff" : colors.textPrimary }}>
            {y}개정 교육과정
          </Text>
        </Pressable>
      ))}
      <Pressable
        onPress={finish}
        disabled={!curriculum}
        style={{
          backgroundColor: curriculum ? colors.accent : colors.border,
          borderRadius: 28, paddingVertical: 16, alignItems: "center", marginTop: 24,
        }}
      >
        <Text style={{ color: "#fff", fontSize: 16, fontWeight: "700" }}>시작하기</Text>
      </Pressable>
    </View>
  );
}
