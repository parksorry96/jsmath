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
const MAX_EXPORT_SIZE = 1024;

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
    setStrokes((prev) => prev.slice(0, -1));
  }, []);

  const clear = useCallback(() => {
    setStrokes([]);
  }, []);

  const exportAsPng = useCallback((): string | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;

    // Determine snapshot rect that fits within MAX_EXPORT_SIZE.
    const scale = Math.min(1, MAX_EXPORT_SIZE / width, MAX_EXPORT_SIZE / height);
    const rect =
      scale < 1
        ? Skia.XYWHRect(0, 0, width * scale, height * scale)
        : undefined;

    const image = canvas.makeImageSnapshot(rect);
    const base64 = image.encodeToBase64(ImageFormat.PNG, 100);
    onExport?.(base64);
    return base64;
  }, [canvasRef, width, height, onExport]);

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
