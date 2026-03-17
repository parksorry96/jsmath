import { useRef, useState } from "react";
import { View, Pressable, Text, ActivityIndicator } from "react-native";
import { Canvas, Path, Skia, ImageFormat, useCanvasRef } from "@shopify/react-native-skia";
import { Undo2, Redo2, Trash2, Eraser, Send } from "lucide-react-native";
import { useTheme } from "@/lib/theme";

interface DrawingPath {
  path: string;
  color: string;
  strokeWidth: number;
}

interface DrawingCanvasProps {
  onCapture: (imageBase64: string) => Promise<void> | void;
}

const PEN_COLORS = ["#333333", "#c87070", "#5da37e"];

export function DrawingCanvas({ onCapture }: DrawingCanvasProps) {
  const { colors } = useTheme();
  const canvasRef = useCanvasRef();
  const [paths, setPaths] = useState<DrawingPath[]>([]);
  const [undone, setUndone] = useState<DrawingPath[]>([]);
  const [currentColor, setCurrentColor] = useState(PEN_COLORS[0]);
  const [strokeWidth] = useState(3);
  const [isEraser, setIsEraser] = useState(false);
  const [currentPath, setCurrentPath] = useState<DrawingPath | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const currentPathRef = useRef<string>("");

  function buildPath(path: string) {
    const skPath = Skia.Path.MakeFromSVGString(path);
    return skPath ?? null;
  }

  function handleTouchStart(x: number, y: number) {
    currentPathRef.current = `M ${x} ${y}`;
    setCurrentPath({
      path: currentPathRef.current,
      color: isEraser ? colors.bg : currentColor,
      strokeWidth: isEraser ? 20 : strokeWidth,
    });
    setUndone([]);
  }

  function handleTouchMove(x: number, y: number) {
    if (!currentPathRef.current) return;

    currentPathRef.current += ` L ${x} ${y}`;
    setCurrentPath({
      path: currentPathRef.current,
      color: isEraser ? colors.bg : currentColor,
      strokeWidth: isEraser ? 20 : strokeWidth,
    });
  }

  function handleTouchEnd() {
    if (!currentPath) {
      currentPathRef.current = "";
      return;
    }

    setPaths((prev) => [...prev, currentPath]);
    setCurrentPath(null);
    currentPathRef.current = "";
  }

  function undo() {
    setPaths((prev) => {
      if (prev.length === 0) return prev;
      setUndone((stack) => [...stack, prev[prev.length - 1]]);
      return prev.slice(0, -1);
    });
  }

  function redo() {
    setUndone((prev) => {
      if (prev.length === 0) return prev;
      const next = prev[prev.length - 1];
      setPaths((stack) => [...stack, next]);
      return prev.slice(0, -1);
    });
  }

  function clear() {
    setPaths([]);
    setUndone([]);
    setCurrentPath(null);
    currentPathRef.current = "";
  }

  async function capture() {
    if (isSubmitting) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    setIsSubmitting(true);
    try {
      const image = canvas.makeImageSnapshot();
      const base64 = image.encodeToBase64(ImageFormat.PNG, 100);
      image.dispose?.();
      await onCapture(base64);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <View style={{ flex: 1 }}>
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
          paddingHorizontal: 12,
          paddingVertical: 8,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
          backgroundColor: colors.card,
          gap: 12,
        }}
      >
        <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
          {PEN_COLORS.map((color) => (
            <Pressable
              key={color}
              onPress={() => {
                setCurrentColor(color);
                setIsEraser(false);
              }}
              style={{
                width: 28,
                height: 28,
                borderRadius: 8,
                backgroundColor: color,
                borderWidth: currentColor === color && !isEraser ? 3 : 0,
                borderColor: colors.accent,
              }}
            />
          ))}
          <Pressable onPress={() => setIsEraser((value) => !value)} style={{ padding: 4 }}>
            <Eraser color={isEraser ? colors.accent : colors.textMuted} size={20} />
          </Pressable>
        </View>

        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <Pressable onPress={undo}>
            <Undo2 color={colors.textMuted} size={20} />
          </Pressable>
          <Pressable onPress={redo}>
            <Redo2 color={colors.textMuted} size={20} />
          </Pressable>
          <Pressable onPress={clear}>
            <Trash2 color={colors.destructive} size={20} />
          </Pressable>
          <Pressable
            onPress={capture}
            disabled={isSubmitting}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              backgroundColor: colors.accent,
              borderRadius: 18,
              paddingHorizontal: 14,
              paddingVertical: 10,
              opacity: isSubmitting ? 0.7 : 1,
            }}
          >
            {isSubmitting ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Send color="#fff" size={16} />
            )}
            <Text style={{ color: "#fff", fontWeight: "700" }}>
              {isSubmitting ? "제출 중..." : "풀이 제출"}
            </Text>
          </Pressable>
        </View>
      </View>

      <View
        style={{ flex: 1, backgroundColor: colors.bg }}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={(event) => {
          handleTouchStart(
            event.nativeEvent.locationX,
            event.nativeEvent.locationY,
          );
        }}
        onResponderMove={(event) => {
          handleTouchMove(
            event.nativeEvent.locationX,
            event.nativeEvent.locationY,
          );
        }}
        onResponderRelease={handleTouchEnd}
        onResponderTerminate={handleTouchEnd}
      >
        <Canvas ref={canvasRef} style={{ flex: 1, backgroundColor: colors.bg }}>
          {paths.map((path, index) => {
            const skPath = buildPath(path.path);
            if (!skPath) return null;

            return (
              <Path
                key={index}
                path={skPath}
                color={path.color}
                style="stroke"
                strokeWidth={path.strokeWidth}
                strokeCap="round"
                strokeJoin="round"
              />
            );
          })}
          {currentPath && (() => {
            const skPath = buildPath(currentPath.path);
            if (!skPath) return null;

            return (
              <Path
                path={skPath}
                color={currentPath.color}
                style="stroke"
                strokeWidth={currentPath.strokeWidth}
                strokeCap="round"
                strokeJoin="round"
              />
            );
          })()}
        </Canvas>
      </View>
    </View>
  );
}
