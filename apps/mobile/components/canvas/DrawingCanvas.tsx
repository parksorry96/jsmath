import React, {
  useCallback,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import {
  Canvas,
  Path,
  Skia,
  ImageFormat,
  useCanvasRef,
} from "@shopify/react-native-skia";
import type { SkPath } from "@shopify/react-native-skia";

// ---------- types ----------

interface StrokeRecord {
  path: SkPath;
  color: string;
  strokeWidth: number;
}

export interface DrawingCanvasRef {
  undo: () => void;
  clear: () => void;
  exportAsPng: () => string | null;
}

export interface DrawingCanvasProps {
  width: number;
  height: number;
  strokeWidth?: number;
  isEraser?: boolean;
  onExport?: (pngBase64: string) => void;
}

// ---------- constants ----------

const BG_COLOR = "white";
const PEN_COLOR = "black";

// ---------- component ----------

export const DrawingCanvas = React.forwardRef<
  DrawingCanvasRef,
  DrawingCanvasProps
>(function DrawingCanvas(
  { width, height, strokeWidth = 3, isEraser = false, onExport },
  ref,
) {
  const canvasRef = useCanvasRef();
  const [strokes, setStrokes] = useState<StrokeRecord[]>([]);
  const currentPath = useRef<SkPath | null>(null);
  const [renderKey, setRenderKey] = useState(0);

  // Snapshot the latest prop values so the gesture callbacks always read
  // the value at stroke-start time, not the stale closure value.
  const isEraserRef = useRef(isEraser);
  isEraserRef.current = isEraser;
  const strokeWidthRef = useRef(strokeWidth);
  strokeWidthRef.current = strokeWidth;

  // ---- gesture handler ----

  const pan = Gesture.Pan()
    .minDistance(0)
    .onBegin((e) => {
      const path = Skia.Path.Make();
      path.moveTo(e.x, e.y);
      currentPath.current = path;
    })
    .onUpdate((e) => {
      currentPath.current?.lineTo(e.x, e.y);
      setRenderKey((k) => k + 1);
    })
    .onEnd(() => {
      if (currentPath.current) {
        setStrokes((prev) => [
          ...prev,
          {
            path: currentPath.current!,
            color: isEraserRef.current ? BG_COLOR : PEN_COLOR,
            strokeWidth: strokeWidthRef.current,
          },
        ]);
        currentPath.current = null;
      }
    });

  // ---- imperative API ----

  const undo = useCallback(() => {
    setStrokes((prev) => {
      if (prev.length === 0) return prev;
      const removed = prev[prev.length - 1];
      removed.path.dispose?.();
      return prev.slice(0, -1);
    });
  }, []);

  const clear = useCallback(() => {
    setStrokes((prev) => {
      prev.forEach((s) => s.path.dispose?.());
      return [];
    });
  }, []);

  const exportAsPng = useCallback((): string | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;

    // Snapshot the full canvas; let the server handle resize if needed.
    const image = canvas.makeImageSnapshot();
    const base64 = image.encodeToBase64(ImageFormat.PNG, 100);
    image.dispose();
    onExport?.(base64);
    return base64;
  }, [canvasRef, onExport]);

  useImperativeHandle(ref, () => ({ undo, clear, exportAsPng }), [
    undo,
    clear,
    exportAsPng,
  ]);

  // ---- render ----

  return (
    <View style={[styles.container, { width, height }]}>
      <GestureDetector gesture={pan}>
        <Canvas ref={canvasRef} style={styles.canvas}>
          {strokes.map((s, i) => (
            <Path
              key={i}
              path={s.path}
              color={s.color}
              style="stroke"
              strokeWidth={s.strokeWidth}
              strokeCap="round"
              strokeJoin="round"
            />
          ))}
          {currentPath.current && (
            <Path
              key={`current-${renderKey}`}
              path={currentPath.current}
              color={isEraser ? BG_COLOR : PEN_COLOR}
              style="stroke"
              strokeWidth={strokeWidth}
              strokeCap="round"
              strokeJoin="round"
            />
          )}
        </Canvas>
      </GestureDetector>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    backgroundColor: BG_COLOR,
    borderRadius: 8,
    overflow: "hidden",
  },
  canvas: {
    flex: 1,
  },
});
