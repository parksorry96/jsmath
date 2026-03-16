import { useRef, useState, useCallback } from "react";
import { View, Pressable } from "react-native";
import { Canvas, Path, Skia, useCanvasRef } from "@shopify/react-native-skia";
import { Undo2, Redo2, Trash2, Eraser } from "lucide-react-native";
import { useTheme } from "@/lib/theme";

interface DrawingPath {
  path: string;
  color: string;
  strokeWidth: number;
}

interface DrawingCanvasProps {
  onCapture: (imageBase64: string) => void;
}

const PEN_COLORS = ["#333333", "#c87070", "#5da37e"];

export function DrawingCanvas({ onCapture }: DrawingCanvasProps) {
  const { colors } = useTheme();
  const canvasRef = useCanvasRef();
  const [paths, setPaths] = useState<DrawingPath[]>([]);
  const [undone, setUndone] = useState<DrawingPath[]>([]);
  const [currentColor, setCurrentColor] = useState(PEN_COLORS[0]);
  const [strokeWidth, setStrokeWidth] = useState(3);
  const [isEraser, setIsEraser] = useState(false);
  const currentPathRef = useRef<string>("");

  const handleTouchStart = useCallback((x: number, y: number) => {
    currentPathRef.current = `M ${x} ${y}`;
  }, []);

  const handleTouchMove = useCallback((x: number, y: number) => {
    currentPathRef.current += ` L ${x} ${y}`;
    setPaths((prev) => {
      const updated = [...prev];
      if (updated.length > 0 && updated[updated.length - 1].path.startsWith(currentPathRef.current.split(" L")[0])) {
        updated[updated.length - 1] = {
          path: currentPathRef.current,
          color: isEraser ? colors.bg : currentColor,
          strokeWidth: isEraser ? 20 : strokeWidth,
        };
      } else {
        updated.push({
          path: currentPathRef.current,
          color: isEraser ? colors.bg : currentColor,
          strokeWidth: isEraser ? 20 : strokeWidth,
        });
      }
      return updated;
    });
  }, [currentColor, strokeWidth, isEraser, colors.bg]);

  function undo() {
    setPaths((prev) => {
      if (prev.length === 0) return prev;
      setUndone((u) => [...u, prev[prev.length - 1]]);
      return prev.slice(0, -1);
    });
  }

  function redo() {
    setUndone((prev) => {
      if (prev.length === 0) return prev;
      setPaths((p) => [...p, prev[prev.length - 1]]);
      return prev.slice(0, -1);
    });
  }

  function clear() {
    setPaths([]);
    setUndone([]);
  }

  return (
    <View style={{ flex: 1 }}>
      {/* Toolbar */}
      <View style={{
        flexDirection: "row", justifyContent: "space-between", alignItems: "center",
        paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border,
      }}>
        <View style={{ flexDirection: "row", gap: 8 }}>
          {PEN_COLORS.map((c) => (
            <Pressable
              key={c}
              onPress={() => { setCurrentColor(c); setIsEraser(false); }}
              style={{
                width: 28, height: 28, borderRadius: 6, backgroundColor: c,
                borderWidth: currentColor === c && !isEraser ? 3 : 0, borderColor: colors.accent,
              }}
            />
          ))}
          <Pressable onPress={() => setIsEraser(!isEraser)} style={{ padding: 4 }}>
            <Eraser color={isEraser ? colors.accent : colors.textMuted} size={20} />
          </Pressable>
        </View>
        <View style={{ flexDirection: "row", gap: 12 }}>
          <Pressable onPress={undo}><Undo2 color={colors.textMuted} size={20} /></Pressable>
          <Pressable onPress={redo}><Redo2 color={colors.textMuted} size={20} /></Pressable>
          <Pressable onPress={clear}><Trash2 color={colors.destructive} size={20} /></Pressable>
        </View>
      </View>

      {/* Canvas */}
      <Canvas
        ref={canvasRef}
        style={{ flex: 1, backgroundColor: colors.bg }}
      >
        {paths.map((p, i) => {
          const skPath = Skia.Path.MakeFromSVGString(p.path);
          if (!skPath) return null;
          return (
            <Path
              key={i}
              path={skPath}
              color={p.color}
              style="stroke"
              strokeWidth={p.strokeWidth}
              strokeCap="round"
              strokeJoin="round"
            />
          );
        })}
      </Canvas>
    </View>
  );
}
