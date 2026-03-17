import React, {
  ForwardedRef,
  useCallback,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { View, Pressable, Text, ActivityIndicator, StyleSheet } from "react-native";
import {
  Canvas,
  Path,
  Skia,
  ImageFormat,
  useCanvasRef,
  Rect,
} from "@shopify/react-native-skia";
import {
  Gesture,
  GestureDetector,
  PointerType,
} from "react-native-gesture-handler";
import {
  Undo2,
  Redo2,
  Trash2,
  Eraser,
  Send,
  Pen,
} from "lucide-react-native";
import { useTheme } from "@/lib/theme";
import {
  PEN_COLORS,
  STROKE_WIDTHS,
  ERASER_WIDTHS,
  SCRATCH_BG,
} from "@/constants/canvas";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DrawingPath {
  path: string;
  color: string;
  strokeWidth: number;
  isEraser: boolean;
}

export type CanvasMode = "solution" | "scratch";

export interface DrawingCanvasRef {
  capture: () => string | null;
  clear: () => void;
  undo: () => void;
  redo: () => void;
  hasContent: () => boolean;
  getMode: () => CanvasMode;
  setMode: (mode: CanvasMode) => void;
}

interface DrawingCanvasProps {
  onCapture: (imageBase64: string) => Promise<void> | void;
  toolbarPosition?: "top" | "bottom";
  onCanvasChange?: () => void;
  onStrokeEnd?: () => void;
  onEraserStrokeEnd?: () => void;
  onSolutionClear?: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function DrawingCanvasImpl(
  {
    onCapture,
    toolbarPosition = "top",
    onCanvasChange,
    onStrokeEnd,
    onEraserStrokeEnd,
    onSolutionClear,
  }: DrawingCanvasProps,
  ref: ForwardedRef<DrawingCanvasRef>,
) {
  const { colors, isDark } = useTheme();

  // Canvas refs
  const canvasRef = useCanvasRef();
  const exportCanvasRef = useCanvasRef();

  // Mode state
  const [mode, setMode] = useState<CanvasMode>("solution");

  // Dual-layer paths
  const [solutionPaths, setSolutionPaths] = useState<DrawingPath[]>([]);
  const [scratchPaths, setScratchPaths] = useState<DrawingPath[]>([]);
  const [solutionUndone, setSolutionUndone] = useState<DrawingPath[]>([]);
  const [scratchUndone, setScratchUndone] = useState<DrawingPath[]>([]);

  // Drawing state
  const [currentColor, setCurrentColor] = useState<string>(PEN_COLORS[0]);
  const [strokeWidthIndex, setStrokeWidthIndex] = useState(1); // default 3
  const [eraserWidthIndex, setEraserWidthIndex] = useState(1); // default 20
  const [isEraser, setIsEraser] = useState(false);
  const [currentPath, setCurrentPath] = useState<DrawingPath | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Refs for gesture callbacks
  const currentPathRef = useRef<string>("");
  const shouldDrawRef = useRef(false);
  const pencilDetectedRef = useRef(false);

  // Computed
  const activePaths = mode === "solution" ? solutionPaths : scratchPaths;
  const setActivePaths = mode === "solution" ? setSolutionPaths : setScratchPaths;
  const setActiveUndone = mode === "solution" ? setSolutionUndone : setScratchUndone;

  const canvasBg = mode === "scratch"
    ? (isDark ? SCRATCH_BG.dark : SCRATCH_BG.light)
    : colors.bg;

  const currentStrokeWidth = isEraser
    ? ERASER_WIDTHS[eraserWidthIndex]
    : STROKE_WIDTHS[strokeWidthIndex];

  // ------- Path helpers -------

  function buildPath(svgPath: string) {
    return Skia.Path.MakeFromSVGString(svgPath) ?? null;
  }

  // ------- Touch handlers -------

  function handleTouchStart(x: number, y: number) {
    currentPathRef.current = `M ${x} ${y}`;
    setCurrentPath({
      path: currentPathRef.current,
      color: isEraser ? canvasBg : currentColor,
      strokeWidth: currentStrokeWidth,
      isEraser,
    });
    setActiveUndone([]);
  }

  function handleTouchMove(x: number, y: number) {
    if (!currentPathRef.current) return;
    currentPathRef.current += ` L ${x} ${y}`;
    setCurrentPath({
      path: currentPathRef.current,
      color: isEraser ? canvasBg : currentColor,
      strokeWidth: currentStrokeWidth,
      isEraser,
    });
  }

  function handleTouchEnd() {
    if (!currentPath) {
      currentPathRef.current = "";
      return;
    }

    setActivePaths((prev) => [...prev, currentPath]);
    setCurrentPath(null);
    currentPathRef.current = "";
    onCanvasChange?.();

    // Callbacks only in solution mode
    if (mode === "solution") {
      if (currentPath.isEraser) {
        onEraserStrokeEnd?.();
      } else {
        onStrokeEnd?.();
      }
    }
  }

  // ------- Gesture -------

  const panGesture = Gesture.Pan()
    .runOnJS(true)
    .minDistance(0)
    .onBegin((e) => {
      // Palm rejection: if a stylus is detected during the session,
      // ignore subsequent touch events.
      if (e.pointerType === PointerType.STYLUS) {
        pencilDetectedRef.current = true;
      }
      if (pencilDetectedRef.current && e.pointerType !== PointerType.STYLUS) {
        shouldDrawRef.current = false;
        return;
      }
      shouldDrawRef.current = true;
      handleTouchStart(e.x, e.y);
    })
    .onUpdate((e) => {
      if (!shouldDrawRef.current) return;
      handleTouchMove(e.x, e.y);
    })
    .onEnd(() => {
      if (!shouldDrawRef.current) return;
      handleTouchEnd();
    })
    .onFinalize(() => {
      shouldDrawRef.current = false;
    });

  // ------- Actions -------

  const undo = useCallback(() => {
    const setPaths = mode === "solution" ? setSolutionPaths : setScratchPaths;
    const setUndone = mode === "solution" ? setSolutionUndone : setScratchUndone;
    setPaths((prev) => {
      if (prev.length === 0) return prev;
      setUndone((stack) => [...stack, prev[prev.length - 1]]);
      return prev.slice(0, -1);
    });
    onCanvasChange?.();
  }, [mode, onCanvasChange]);

  const redo = useCallback(() => {
    const setPaths = mode === "solution" ? setSolutionPaths : setScratchPaths;
    const setUndone = mode === "solution" ? setSolutionUndone : setScratchUndone;
    setUndone((prev) => {
      if (prev.length === 0) return prev;
      const next = prev[prev.length - 1];
      setPaths((stack) => [...stack, next]);
      return prev.slice(0, -1);
    });
    onCanvasChange?.();
  }, [mode, onCanvasChange]);

  const clear = useCallback(() => {
    if (mode === "solution") {
      setSolutionPaths([]);
      setSolutionUndone([]);
      onSolutionClear?.();
    } else {
      setScratchPaths([]);
      setScratchUndone([]);
    }
    setCurrentPath(null);
    currentPathRef.current = "";
    onCanvasChange?.();
  }, [mode, onCanvasChange, onSolutionClear]);

  const captureSnapshot = useCallback(() => {
    const canvas = exportCanvasRef.current;
    if (!canvas) return null;

    const image = canvas.makeImageSnapshot();
    const base64 = image.encodeToBase64(ImageFormat.PNG, 100);
    image.dispose?.();
    return base64;
  }, [exportCanvasRef]);

  async function submitCapture() {
    if (isSubmitting || mode !== "solution") return;

    const base64 = captureSnapshot();
    if (!base64) return;

    setIsSubmitting(true);
    try {
      await onCapture(base64);
    } finally {
      setIsSubmitting(false);
    }
  }

  // ------- Imperative handle -------

  useImperativeHandle(
    ref,
    () => ({
      capture: captureSnapshot,
      clear,
      undo,
      redo,
      hasContent: () =>
        solutionPaths.length > 0 || Boolean(currentPathRef.current),
      getMode: () => mode,
      setMode,
    }),
    [captureSnapshot, clear, undo, redo, solutionPaths.length, mode],
  );

  // ------- Toolbar -------

  const toolbarBorderStyle =
    toolbarPosition === "top"
      ? { borderBottomWidth: 1, borderBottomColor: colors.border }
      : { borderTopWidth: 1, borderTopColor: colors.border };

  const toolbar = (
    <View
      style={[
        toolbarBorderStyle as object,
        {
          paddingHorizontal: 12,
          paddingVertical: 8,
          backgroundColor: colors.card,
          gap: 8,
        },
      ]}
    >
      {/* Row 1: Mode tabs */}
      <View style={styles.row}>
        {(["solution", "scratch"] as const).map((m) => (
          <Pressable
            key={m}
            onPress={() => setMode(m)}
            style={[
              styles.modeTab,
              {
                backgroundColor: mode === m ? colors.accent : "transparent",
                borderColor: colors.border,
                borderWidth: mode === m ? 0 : 1,
              },
            ]}
          >
            <Text
              style={{
                color: mode === m ? "#fff" : colors.textMuted,
                fontSize: 12,
                fontWeight: "700",
              }}
            >
              {m === "solution" ? "풀이" : "연습장"}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Row 2: Tools */}
      <View style={[styles.row, { justifyContent: "space-between" }]}>
        {/* Left: pen colors + width + eraser */}
        <View style={styles.row}>
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

          {/* Stroke width selector */}
          {!isEraser
            ? STROKE_WIDTHS.map((w, i) => (
                <Pressable
                  key={`sw-${w}`}
                  onPress={() => setStrokeWidthIndex(i)}
                  style={[
                    styles.widthBtn,
                    {
                      borderColor:
                        strokeWidthIndex === i ? colors.accent : colors.border,
                      borderWidth: strokeWidthIndex === i ? 2 : 1,
                    },
                  ]}
                >
                  <View
                    style={{
                      width: w + 4,
                      height: w + 4,
                      borderRadius: (w + 4) / 2,
                      backgroundColor: colors.textPrimary,
                    }}
                  />
                </Pressable>
              ))
            : ERASER_WIDTHS.map((w, i) => (
                <Pressable
                  key={`ew-${w}`}
                  onPress={() => setEraserWidthIndex(i)}
                  style={[
                    styles.widthBtn,
                    {
                      borderColor:
                        eraserWidthIndex === i ? colors.accent : colors.border,
                      borderWidth: eraserWidthIndex === i ? 2 : 1,
                    },
                  ]}
                >
                  <View
                    style={{
                      width: Math.min(w / 2, 16),
                      height: Math.min(w / 2, 16),
                      borderRadius: Math.min(w / 2, 16) / 2,
                      backgroundColor: colors.textMuted,
                    }}
                  />
                </Pressable>
              ))}

          {/* Eraser toggle */}
          <Pressable
            onPress={() => setIsEraser((v) => !v)}
            style={{ padding: 4 }}
          >
            <Eraser
              color={isEraser ? colors.accent : colors.textMuted}
              size={20}
            />
          </Pressable>
        </View>

        {/* Right: undo/redo/clear/submit */}
        <View style={styles.row}>
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
            onPress={submitCapture}
            disabled={isSubmitting || mode !== "solution"}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              backgroundColor:
                mode !== "solution" ? colors.textMuted : colors.accent,
              borderRadius: 18,
              paddingHorizontal: 14,
              paddingVertical: 10,
              opacity: isSubmitting || mode !== "solution" ? 0.5 : 1,
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
    </View>
  );

  // ------- Render -------

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.card,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: colors.border,
        overflow: "hidden",
      }}
    >
      {toolbarPosition === "top" ? toolbar : null}

      {/* Hidden export canvas — white bg, solution paths only */}
      <View style={styles.exportCanvasContainer}>
        <Canvas ref={exportCanvasRef} style={styles.exportCanvas}>
          <Rect x={0} y={0} width={9999} height={9999} color="#ffffff" />
          {solutionPaths.map((p, i) => {
            const sk = buildPath(p.path);
            if (!sk) return null;
            return (
              <Path
                key={`exp-${i}`}
                path={sk}
                color={p.isEraser ? "#ffffff" : p.color}
                style="stroke"
                strokeWidth={p.strokeWidth}
                strokeCap="round"
                strokeJoin="round"
              />
            );
          })}
        </Canvas>
      </View>

      {/* Visible canvas */}
      <GestureDetector gesture={panGesture}>
        <View style={{ flex: 1, backgroundColor: canvasBg }}>
          <Canvas ref={canvasRef} style={{ flex: 1 }}>
            {activePaths.map((p, i) => {
              const sk = buildPath(p.path);
              if (!sk) return null;
              return (
                <Path
                  key={i}
                  path={sk}
                  color={p.isEraser ? canvasBg : p.color}
                  style="stroke"
                  strokeWidth={p.strokeWidth}
                  strokeCap="round"
                  strokeJoin="round"
                />
              );
            })}
            {currentPath &&
              (() => {
                const sk = buildPath(currentPath.path);
                if (!sk) return null;
                return (
                  <Path
                    path={sk}
                    color={currentPath.isEraser ? canvasBg : currentPath.color}
                    style="stroke"
                    strokeWidth={currentPath.strokeWidth}
                    strokeCap="round"
                    strokeJoin="round"
                  />
                );
              })()}
          </Canvas>
        </View>
      </GestureDetector>

      {toolbarPosition === "bottom" ? toolbar : null}
    </View>
  );
}

export const DrawingCanvas = React.forwardRef(DrawingCanvasImpl);

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  modeTab: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 12,
  },
  widthBtn: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  exportCanvasContainer: {
    position: "absolute",
    width: 1,
    height: 1,
    overflow: "hidden",
    opacity: 0,
  },
  exportCanvas: {
    width: 2048,
    height: 2048,
  },
});
