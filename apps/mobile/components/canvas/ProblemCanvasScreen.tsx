import React, { useCallback, useRef, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Alert,
  useWindowDimensions,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { DrawingCanvas, DrawingCanvasRef } from "./DrawingCanvas";
import { CanvasToolbar } from "./CanvasToolbar";
import { useCanvasUpload } from "./useCanvasUpload";

export interface ProblemCanvasScreenProps {
  /** Problem stem text (LaTeX or plain text) */
  problemStem: string;
  /** Problem number for display */
  problemNumber?: number | string;
  /** Problem subject/unit for context */
  problemMeta?: string;
  /** Choices for multiple choice problems */
  choices?: string[];
  /** Called with the S3 key after successful upload */
  onSubmit?: (s3Key: string) => void;
  /** Called when user wants to go back */
  onBack?: () => void;
  /** Called when user taps camera button */
  onCamera?: () => void;
}

/**
 * Full-screen layout: problem on top, drawing canvas below.
 * Matches the tutor chat pattern (problem top, interaction bottom).
 */
export function ProblemCanvasScreen({
  problemStem,
  problemNumber,
  problemMeta,
  choices,
  onSubmit,
  onBack,
  onCamera,
}: ProblemCanvasScreenProps) {
  const { width: screenWidth } = useWindowDimensions();
  const canvasRef = useRef<DrawingCanvasRef>(null);

  const [isEraser, setIsEraser] = useState(false);
  const [thickness, setThickness] = useState(3);

  const { upload, isUploading } = useCanvasUpload();

  const canvasWidth = screenWidth - 32; // 16px padding each side
  const canvasHeight = canvasWidth * 0.75; // 4:3 aspect ratio

  const handleSend = useCallback(async () => {
    const base64 = canvasRef.current?.exportAsPng();
    if (!base64) {
      Alert.alert("풀이를 작성해주세요");
      return;
    }

    const s3Key = await upload(base64);
    if (s3Key) {
      onSubmit?.(s3Key);
      Alert.alert("전송 완료", "풀이가 전송되었습니다.");
      canvasRef.current?.clear();
    }
  }, [upload, onSubmit]);

  const handleCamera = useCallback(() => {
    onCamera?.();
  }, [onCamera]);

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: "#1a1a1a" }}
      edges={["left", "right", "bottom"]}
    >
      {/* Top: Problem display (scrollable if long) */}
      <View style={{ flex: 0, maxHeight: "40%" }}>
        <ScrollView
          style={{ backgroundColor: "#222" }}
          contentContainerStyle={{ padding: 16 }}
        >
          {/* Back button + problem number */}
          <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 12 }}>
            {onBack && (
              <Pressable onPress={onBack} style={{ marginRight: 12 }}>
                <Text style={{ color: "#d4a574", fontSize: 16 }}>← 뒤로</Text>
              </Pressable>
            )}
            {problemNumber && (
              <View
                style={{
                  backgroundColor: "rgba(212, 165, 116, 0.2)",
                  borderRadius: 14,
                  width: 28,
                  height: 28,
                  alignItems: "center",
                  justifyContent: "center",
                  marginRight: 8,
                }}
              >
                <Text style={{ color: "#d4a574", fontWeight: "bold", fontSize: 14 }}>
                  {problemNumber}
                </Text>
              </View>
            )}
            {problemMeta && (
              <Text style={{ color: "#888", fontSize: 12 }}>{problemMeta}</Text>
            )}
          </View>

          {/* Problem stem */}
          <Text style={{ color: "#e8dcc8", fontSize: 16, lineHeight: 24 }}>
            {problemStem}
          </Text>

          {/* Choices if multiple choice */}
          {choices && choices.length > 0 && (
            <View style={{ marginTop: 12 }}>
              {choices.map((choice, i) => (
                <View
                  key={i}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    paddingVertical: 6,
                  }}
                >
                  <Text style={{ color: "#888", marginRight: 8, fontSize: 14 }}>
                    {["①", "②", "③", "④", "⑤"][i] ?? `(${i + 1})`}
                  </Text>
                  <Text style={{ color: "#ccc", fontSize: 14 }}>{choice}</Text>
                </View>
              ))}
            </View>
          )}
        </ScrollView>

        {/* Divider */}
        <View style={{ height: 1, backgroundColor: "#333" }} />
      </View>

      {/* Bottom: Canvas + Toolbar */}
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", paddingHorizontal: 16 }}>
        <DrawingCanvas
          ref={canvasRef}
          width={canvasWidth}
          height={canvasHeight}
          strokeWidth={thickness}
          isEraser={isEraser}
        />
      </View>

      {/* Toolbar at bottom */}
      <View style={{ backgroundColor: "#222", borderTopWidth: 1, borderTopColor: "#333" }}>
        <CanvasToolbar
          isEraser={isEraser}
          thickness={thickness}
          onPenToggle={() => setIsEraser((v) => !v)}
          onThicknessChange={setThickness}
          onUndo={() => canvasRef.current?.undo()}
          onClear={() => canvasRef.current?.clear()}
          onSend={handleSend}
          onCamera={handleCamera}
        />

        {/* Upload progress */}
        {isUploading && (
          <View style={{ alignItems: "center", paddingBottom: 8 }}>
            <ActivityIndicator color="#d4a574" />
            <Text style={{ color: "#d4a574", fontSize: 12, marginTop: 4 }}>
              전송 중...
            </Text>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}
