import { View, Text } from "react-native";
import { useTheme } from "@/lib/theme";

interface DrawingCanvasProps {
  onCapture: (imageBase64: string) => Promise<void> | void;
}

export function DrawingCanvas({ onCapture: _onCapture }: DrawingCanvasProps) {
  const { colors } = useTheme();

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.card,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: colors.border,
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <Text style={{ color: colors.textPrimary, fontSize: 16, fontWeight: "700" }}>
        웹에서는 펜슬 풀이를 지원하지 않습니다
      </Text>
      <Text style={{ color: colors.textMuted, fontSize: 13, marginTop: 8, textAlign: "center" }}>
        iOS 또는 Android 앱에서 다시 시도해 주세요
      </Text>
    </View>
  );
}
