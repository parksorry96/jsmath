import { useState } from "react";
import { View, Text, Pressable, Image, ActivityIndicator, ScrollView, TextInput } from "react-native";
import { useRouter, Stack } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { Camera as CameraIcon, MessageCircle } from "lucide-react-native";
import { useTheme } from "@/lib/theme";
import { api } from "@/lib/api";

interface OcrResult {
  problem_text: string;
  confidence: number;
}

export default function CameraScreen() {
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [ocrResult, setOcrResult] = useState<OcrResult | null>(null);
  const [editedText, setEditedText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();
  const { colors } = useTheme();

  async function takePhoto() {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return;

    const result = await ImagePicker.launchCameraAsync({
      quality: 0.8,
      allowsEditing: true,
    });

    if (!result.canceled && result.assets[0]) {
      const uri = result.assets[0].uri;
      setImageUri(uri);
      await runOcr(uri);
    }
  }

  async function pickImage() {
    const result = await ImagePicker.launchImageLibraryAsync({
      quality: 0.8,
      allowsEditing: true,
    });

    if (!result.canceled && result.assets[0]) {
      const uri = result.assets[0].uri;
      setImageUri(uri);
      await runOcr(uri);
    }
  }

  async function runOcr(uri: string) {
    setIsLoading(true);
    try {
      const result = await api.uploadImage<OcrResult>("/ocr/single-problem", uri);
      setOcrResult(result);
      setEditedText(result.problem_text);
    } catch {
      setOcrResult(null);
      setEditedText("");
    } finally {
      setIsLoading(false);
    }
  }

  async function startTutor() {
    const search = editedText.replace(/\s+/g, " ").trim().slice(0, 120);
    if (!search) return;

    router.replace({
      pathname: "/(tabs)/explore",
      params: { search },
    });
  }

  // Pre-capture state
  if (!imageUri) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: "center", alignItems: "center", padding: 32 }}>
        <Stack.Screen options={{ title: "문제 촬영", headerShown: true }} />
        <CameraIcon color={colors.textMuted} size={64} strokeWidth={1} />
        <Text style={{ fontSize: 18, fontWeight: "700", color: colors.textPrimary, marginTop: 24 }}>
          수학 문제를 촬영해주세요
        </Text>
        <Text style={{ fontSize: 14, color: colors.textMuted, marginTop: 8, textAlign: "center" }}>
          교과서나 문제집의 문제를 찍으면{"\n"}AI가 인식해서 도와줄게요
        </Text>
        <View style={{ flexDirection: "row", gap: 12, marginTop: 40 }}>
          <Pressable
            onPress={takePhoto}
            style={{ backgroundColor: colors.accent, borderRadius: 28, paddingVertical: 16, paddingHorizontal: 32 }}
          >
            <Text style={{ color: "#fff", fontSize: 15, fontWeight: "700" }}>카메라</Text>
          </Pressable>
          <Pressable
            onPress={pickImage}
            style={{ backgroundColor: colors.surface, borderRadius: 28, paddingVertical: 16, paddingHorizontal: 32, borderWidth: 1, borderColor: colors.border }}
          >
            <Text style={{ color: colors.textPrimary, fontSize: 15, fontWeight: "600" }}>앨범</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // Post-capture: OCR result
  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 20 }}>
      <Stack.Screen options={{ title: "문제 확인", headerShown: true }} />

      <Image source={{ uri: imageUri }} style={{ width: "100%", height: 200, borderRadius: 12, marginBottom: 16 }} resizeMode="contain" />

      {isLoading ? (
        <View style={{ alignItems: "center", padding: 40 }}>
          <ActivityIndicator size="large" color={colors.accent} />
          <Text style={{ color: colors.textMuted, marginTop: 12 }}>문제를 인식하고 있어요...</Text>
        </View>
      ) : ocrResult ? (
        <View>
          <Text style={{ fontSize: 14, fontWeight: "600", color: colors.textSecondary, marginBottom: 8 }}>
            인식된 문제 (수정 가능)
          </Text>
          <TextInput
            value={editedText}
            onChangeText={setEditedText}
            multiline
            style={{
              backgroundColor: colors.surface, borderRadius: 12, padding: 16,
              color: colors.textPrimary, fontSize: 15, minHeight: 120, textAlignVertical: "top",
            }}
          />
          <Text style={{ fontSize: 12, color: colors.textMuted, marginTop: 8 }}>
            인식 정확도: {Math.round(ocrResult.confidence * 100)}%
          </Text>

          <Pressable
            onPress={startTutor}
            style={{
              backgroundColor: colors.accent, borderRadius: 28,
              paddingVertical: 16, alignItems: "center", marginTop: 24,
              flexDirection: "row", justifyContent: "center", gap: 8,
            }}
          >
            <MessageCircle color="#fff" size={20} />
            <Text style={{ color: "#fff", fontSize: 16, fontWeight: "700" }}>비슷한 문제 찾기</Text>
          </Pressable>
        </View>
      ) : (
        <View style={{ alignItems: "center", padding: 40 }}>
          <Text style={{ color: colors.destructive }}>인식에 실패했어요. 다시 촬영해주세요.</Text>
          <Pressable onPress={() => setImageUri(null)} style={{ marginTop: 16 }}>
            <Text style={{ color: colors.accent, fontWeight: "600" }}>다시 촬영</Text>
          </Pressable>
        </View>
      )}
    </ScrollView>
  );
}
