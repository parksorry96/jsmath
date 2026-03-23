# Pencil Canvas UX Upgrade Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the existing iPad pencil canvas screen with smarter AI timing, progressive hints, animated status indicators, safer pen input, scratch pad mode, and step progress tracking, without redesigning the overall page layout in this phase.

**Architecture:** Pure client-side changes in `apps/student-app`. New hooks (`useCanvasActivity`, `useHintLevel`) encapsulate AI timing and hint policy. `drawing-canvas.tsx` migrates to Gesture Handler in JS-thread mode (`runOnJS(true)`) so the existing React state drawing model remains valid, and uses a dedicated white-background export surface for solution-only snapshots. Tutor message parsing is shared so `[STEP:N/T]` tags are stripped in both canvas and full-screen tutor flows. Local struggle nudges stay client-side only — they do not enqueue hidden tutor turns. `ensureSession()` gets an in-flight guard to prevent duplicate tutor sessions. AI behavior is still modified through prompt templates only — no server changes.

**Tech Stack:** React Native (Expo 55), @shopify/react-native-skia, react-native-gesture-handler, react-native-reanimated, moti (new), lucide-react-native

**Spec:** `docs/superpowers/specs/2026-03-18-pencil-canvas-ux-upgrade-design.md`

**Scope Decisions For This Plan:**
- Keep the current canvas screen shell (problem card + canvas + overlay tutor panel). A true split-view redesign is deferred.
- Auto-analysis always uses hint level 0. The "더 자세한 힌트" button only affects explicit manual hint requests.
- Hint escalation resets when `problemId` changes, when the student sends a free-form chat message, and after a successful full solution submission.
- Struggle nudges are local UI state only. They do not send hidden student turns to the server.
- Pressure sensitivity is explicitly deferred. This plan covers stylus detection, palm rejection, tool widths, and scratch/solution separation only.
- Canvas export must always exclude scratch strokes, use a white background, and stay within the existing iPad layout bounds so the exported image remains within the upstream `<= 1024px` expectation.

---

## Chunk 1: Foundation — Dependencies and Utilities

### Task 1: Install moti

**Files:**
- Modify: `apps/student-app/package.json`

- [ ] **Step 1: Install moti via pnpm**

```bash
cd /Users/parkjisong/jsmath && pnpm --filter student-app add moti
```

- [ ] **Step 2: Verify moti peer dependency (reanimated) is satisfied**

```bash
cd /Users/parkjisong/jsmath && pnpm --filter student-app list react-native-reanimated moti 2>&1 | head -10
```

Expected: moti installed, react-native-reanimated 4.2.1 satisfies moti's peer dep.

- [ ] **Step 3: Verify TypeScript resolves moti**

```bash
cd /Users/parkjisong/jsmath/apps/student-app && npx tsc --noEmit 2>&1 | head -5
```

- [ ] **Step 4: Commit**

```bash
git add apps/student-app/package.json pnpm-lock.yaml
git commit -m "chore: add moti dependency for canvas animations"
```

---

### Task 2: Create canvas constants

**Files:**
- Create: `apps/student-app/constants/canvas.ts`

- [ ] **Step 1: Create constants file**

Write `apps/student-app/constants/canvas.ts` with the following content:

```typescript
export const TIMING = {
  PAUSE_THRESHOLD_MS: 5_000,
  IDLE_THRESHOLD_MS: 20_000,
  STRUGGLE_THRESHOLD_MS: 45_000,
  MIN_STROKES_FOR_ANALYSIS: 3,
  ERASE_RATIO_THRESHOLD: 0.5,
  ERASE_WINDOW_MS: 30_000,
} as const;

export const PEN_COLORS = ['#000000', '#0072B2', '#E69F00'] as const;

export const STROKE_WIDTHS = [1, 3, 5] as const;

export const ERASER_WIDTHS = [10, 20, 40] as const;

export const SCRATCH_BG = {
  light: '#fffdf0',
  dark: '#1e1d16',
} as const;

export const DEFAULT_STEP_LABELS = ['문제 파악', '식 세우기', '풀이', '검산'] as const;

export const AUTO_HINT_LEVEL = 0 as const;

export const MAX_HINT_LEVEL = 3 as const;

export const LOCAL_NUDGE_MESSAGES = {
  idle: '힌트가 필요하면 알려주세요',
  erase: '다시 접근하는 것도 좋은 방법이에요',
} as const;

export const HINT_PROMPTS: Record<0 | 1 | 2 | 3, string> = {
  0: '지금까지의 풀이를 보고, 오류가 있는 줄 번호만 짧게 알려주세요. 정답이나 풀이법은 절대 말하지 마세요. 응답 첫 줄에 [STEP:N/T] 형식으로 현재 단계를 표시하세요.',
  1: '오류의 종류(부호/계산/개념)를 알려주세요. 구체적 수정 방법은 말하지 마세요. 응답 첫 줄에 [STEP:N/T] 형식으로 현재 단계를 표시하세요.',
  2: '어떤 단계를 다시 해야 하는지 구체적으로 알려주세요. 답 자체는 말하지 마세요. 응답 첫 줄에 [STEP:N/T] 형식으로 현재 단계를 표시하세요.',
  3: '한 단계씩 풀이를 안내해주세요. 응답 첫 줄에 [STEP:N/T] 형식으로 현재 단계를 표시하세요.',
};
```

- [ ] **Step 2: Commit**

```bash
git add apps/student-app/constants/canvas.ts
git commit -m "feat: add canvas constants (timing, colors, hints)"
```

---

### Task 3: Create tutor message parsing utilities

**Files:**
- Create: `apps/student-app/lib/parse-step-tag.ts`

- [ ] **Step 1: Create parse-step-tag.ts**

Write `apps/student-app/lib/parse-step-tag.ts`:

```typescript
export interface StepTag {
  currentStep: number;
  totalSteps: number;
  cleanContent: string;
}

export function parseStepTag(content: string): StepTag | null {
  const match = content.match(/^\s*\[STEP:(\d+)\/(\d+)\]\s*/);
  if (!match) return null;

  const currentStep = parseInt(match[1], 10);
  const totalSteps = parseInt(match[2], 10);

  if (currentStep < 1 || totalSteps < 1 || currentStep > totalSteps || totalSteps > 8) {
    return null;
  }

  return {
    currentStep,
    totalSteps,
    cleanContent: content.replace(/^\s*\[STEP:\d+\/\d+\]\s*/, ''),
  };
}

export function normalizeTutorMessage(content: string) {
  const parsed = parseStepTag(content);

  return {
    content: parsed?.cleanContent ?? content,
    stepProgress: parsed
      ? { current: parsed.currentStep, total: parsed.totalSteps }
      : null,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/student-app/lib/parse-step-tag.ts
git commit -m "feat: add tutor message parsing utilities"
```

---

## Chunk 2: Hooks — useHintLevel and useCanvasActivity

### Task 4: Create useHintLevel hook

**Files:**
- Create: `apps/student-app/hooks/useHintLevel.ts`

- [ ] **Step 1: Create useHintLevel.ts**

Write `apps/student-app/hooks/useHintLevel.ts`:

```typescript
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AUTO_HINT_LEVEL,
  HINT_PROMPTS,
  MAX_HINT_LEVEL,
} from '@/constants/canvas';

type HintLevel = 0 | 1 | 2 | 3;

export function useHintLevel(problemId: string) {
  const [level, setLevel] = useState<HintLevel>(AUTO_HINT_LEVEL);
  const levelRef = useRef(level);
  levelRef.current = level;

  useEffect(() => {
    setLevel(AUTO_HINT_LEVEL);
    levelRef.current = AUTO_HINT_LEVEL;
  }, [problemId]);

  const escalateAndGetPrompt = useCallback(() => {
    const next =
      levelRef.current < MAX_HINT_LEVEL
        ? ((levelRef.current + 1) as HintLevel)
        : levelRef.current;

    levelRef.current = next;
    setLevel(next);
    return HINT_PROMPTS[next];
  }, []);

  const reset = useCallback(() => {
    levelRef.current = AUTO_HINT_LEVEL;
    setLevel(AUTO_HINT_LEVEL);
  }, []);

  const getAutoPrompt = useCallback(() => {
    return HINT_PROMPTS[AUTO_HINT_LEVEL];
  }, []);

  const getPromptForCurrentLevel = useCallback(() => {
    return HINT_PROMPTS[levelRef.current];
  }, []);

  return {
    level,
    reset,
    getAutoPrompt,
    getPromptForCurrentLevel,
    escalateAndGetPrompt,
    isMaxLevel: level === MAX_HINT_LEVEL,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/student-app/hooks/useHintLevel.ts
git commit -m "feat: add useHintLevel hook for progressive hint system"
```

---

### Task 5: Create useCanvasActivity hook

**Files:**
- Create: `apps/student-app/hooks/useCanvasActivity.ts`

- [ ] **Step 1: Create useCanvasActivity.ts**

Write `apps/student-app/hooks/useCanvasActivity.ts`:

```typescript
import { useCallback, useEffect, useRef, useState } from 'react';
import { LOCAL_NUDGE_MESSAGES, TIMING } from '@/constants/canvas';

type ActivityState = 'writing' | 'paused' | 'idle' | 'struggling';

interface CanvasActivityOptions {
  onAutoAnalyze: () => void;
  onNudge: (message: string) => void;
  enabled: boolean;
  isBusy: boolean;
}

interface StrokeRecord {
  timestamp: number;
  isEraser: boolean;
}

export function useCanvasActivity({
  onAutoAnalyze,
  onNudge,
  enabled,
  isBusy,
}: CanvasActivityOptions) {
  const [activityState, setActivityState] = useState<ActivityState>('writing');

  const pauseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const struggleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const enteredIdleRef = useRef(false);
  const hasWrittenSinceEnableRef = useRef(false);

  const strokesSinceAnalysisRef = useRef(0);
  const recentStrokesRef = useRef<StrokeRecord[]>([]);

  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const isBusyRef = useRef(isBusy);
  isBusyRef.current = isBusy;
  const onAutoAnalyzeRef = useRef(onAutoAnalyze);
  onAutoAnalyzeRef.current = onAutoAnalyze;
  const onNudgeRef = useRef(onNudge);
  onNudgeRef.current = onNudge;

  const clearAllTimers = useCallback(() => {
    if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current);
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    if (struggleTimerRef.current) clearTimeout(struggleTimerRef.current);
    pauseTimerRef.current = null;
    idleTimerRef.current = null;
    struggleTimerRef.current = null;
    enteredIdleRef.current = false;
  }, []);

  useEffect(() => {
    return () => clearAllTimers();
  }, [clearAllTimers]);

  // When isBusy transitions false while idle, fire auto-analyze
  const prevBusyRef = useRef(isBusy);
  useEffect(() => {
    if (prevBusyRef.current && !isBusy && enabledRef.current) {
      if (strokesSinceAnalysisRef.current >= TIMING.MIN_STROKES_FOR_ANALYSIS) {
        onAutoAnalyzeRef.current();
        strokesSinceAnalysisRef.current = 0;
      }
    }
    prevBusyRef.current = isBusy;
  }, [isBusy]);

  const checkEraseRatio = useCallback(() => {
    const now = Date.now();
    const windowStart = now - TIMING.ERASE_WINDOW_MS;
    const recent = recentStrokesRef.current.filter((s) => s.timestamp >= windowStart);
    recentStrokesRef.current = recent;
    if (recent.length < 3) return false;
    const eraserCount = recent.filter((s) => s.isEraser).length;
    return eraserCount / recent.length >= TIMING.ERASE_RATIO_THRESHOLD;
  }, []);

  const startTimers = useCallback(() => {
    clearAllTimers();

    // writing -> paused (5s)
    pauseTimerRef.current = setTimeout(() => {
      if (!enabledRef.current) return;
      setActivityState('paused');

      // paused -> idle (20s from last stroke)
      idleTimerRef.current = setTimeout(() => {
        if (!enabledRef.current) return;

        if (strokesSinceAnalysisRef.current >= TIMING.MIN_STROKES_FOR_ANALYSIS) {
          enteredIdleRef.current = true;
          setActivityState('idle');
          if (!isBusyRef.current) {
            onAutoAnalyzeRef.current();
            strokesSinceAnalysisRef.current = 0;
          }
        }

        // idle -> struggling (45s from last stroke) — only if idle was entered
        struggleTimerRef.current = setTimeout(() => {
          if (!enabledRef.current) return;
          if (!enteredIdleRef.current) return; // guard: spec says idle->struggling
          setActivityState('struggling');
          onNudgeRef.current(LOCAL_NUDGE_MESSAGES.idle);
        }, TIMING.STRUGGLE_THRESHOLD_MS - TIMING.IDLE_THRESHOLD_MS);
      }, TIMING.IDLE_THRESHOLD_MS - TIMING.PAUSE_THRESHOLD_MS);
    }, TIMING.PAUSE_THRESHOLD_MS);
  }, [clearAllTimers]);

  useEffect(() => {
    if (!enabled) {
      clearAllTimers();
      setActivityState('writing');
      return;
    }

    if (hasWrittenSinceEnableRef.current) {
      startTimers();
    }
  }, [enabled, clearAllTimers, startTimers]);

  const handleStrokeEnd = useCallback(() => {
    hasWrittenSinceEnableRef.current = true;
    recentStrokesRef.current.push({ timestamp: Date.now(), isEraser: false });
    strokesSinceAnalysisRef.current += 1;
    setActivityState('writing');
    if (enabledRef.current) startTimers();
  }, [startTimers]);

  const handleEraserStrokeEnd = useCallback(() => {
    hasWrittenSinceEnableRef.current = true;
    recentStrokesRef.current.push({ timestamp: Date.now(), isEraser: true });
    strokesSinceAnalysisRef.current += 1;
    setActivityState('writing');
    if (enabledRef.current) {
      startTimers();
      if (checkEraseRatio()) {
        setActivityState('struggling');
        onNudgeRef.current(LOCAL_NUDGE_MESSAGES.erase);
      }
    }
  }, [startTimers, checkEraseRatio]);

  const resetActivity = useCallback(() => {
    clearAllTimers();
    hasWrittenSinceEnableRef.current = false;
    strokesSinceAnalysisRef.current = 0;
    recentStrokesRef.current = [];
    setActivityState('writing');
  }, [clearAllTimers]);

  return { activityState, handleStrokeEnd, handleEraserStrokeEnd, resetActivity };
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/student-app/hooks/useCanvasActivity.ts
git commit -m "feat: add useCanvasActivity hook for smart AI timing"
```

---

## Chunk 3: UI Components — AiStatusIndicator and StepProgressBar

### Task 6: Create AiStatusIndicator component

**Files:**
- Create: `apps/student-app/components/canvas/ai-status-indicator.tsx`

- [ ] **Step 1: Create ai-status-indicator.tsx**

Write `apps/student-app/components/canvas/ai-status-indicator.tsx`:

```tsx
import { Pressable, Text, View } from 'react-native';
import { MotiView } from 'moti';
import { Bot, Eye, Hand } from 'lucide-react-native';
import { useTheme } from '@/lib/theme';

type ActivityState = 'writing' | 'paused' | 'idle' | 'struggling';

interface AiStatusIndicatorProps {
  activityState: ActivityState;
  isAnalyzing: boolean;
  isStreaming: boolean;
  hasUnread: boolean;
  nudgeMessage?: string | null;
  onPress: () => void;
}

export function AiStatusIndicator({
  activityState,
  isAnalyzing,
  isStreaming,
  hasUnread,
  nudgeMessage,
  onPress,
}: AiStatusIndicatorProps) {
  const { colors } = useTheme();

  const isWriting = activityState === 'writing';
  const isStruggling = activityState === 'struggling';

  function getIcon() {
    if (isWriting) return <Eye color={colors.textMuted} size={18} />;
    if (isStruggling) return <Hand color={colors.accent} size={18} />;
    return <Bot color={isAnalyzing || isStreaming ? colors.accent : colors.textSecondary} size={18} />;
  }

  function getLabelColor() {
    if (isAnalyzing || isStreaming) return colors.accent;
    if (isWriting) return colors.textMuted;
    if (isStruggling) return colors.accent;
    return colors.textPrimary;
  }

  function getLabel() {
    if (isStreaming) return 'AI 응답 중...';
    if (isAnalyzing) return '분석 중...';
    if (isWriting) return '관찰 중';
    if (isStruggling) return nudgeMessage ?? '도움이 필요하신가요?';
    return 'AI 피드백';
  }

  return (
    <Pressable onPress={onPress}>
      <MotiView
        animate={{
          opacity: isWriting ? 0.5 : 1,
          scale: isAnalyzing ? 1.05 : 1,
        }}
        transition={{
          opacity: { type: 'timing', duration: 2000, loop: isWriting },
          scale: { type: 'timing', duration: 300, loop: isAnalyzing },
        }}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          backgroundColor: colors.card,
          borderRadius: 999,
          borderWidth: 1,
          borderColor: colors.border,
          paddingHorizontal: 14,
          paddingVertical: 12,
          shadowColor: '#000',
          shadowOpacity: 0.12,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 6 },
          elevation: 8,
        }}
      >
        {getIcon()}
        <Text style={{ fontSize: 13, fontWeight: '700', color: getLabelColor() }}>
          {getLabel()}
        </Text>
        {hasUnread ? (
          <View
            style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent }}
          />
        ) : null}
      </MotiView>
    </Pressable>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/student-app/components/canvas/ai-status-indicator.tsx
git commit -m "feat: add AiStatusIndicator with moti animations"
```

---

### Task 7: Create StepProgressBar component

**Files:**
- Create: `apps/student-app/components/canvas/step-progress-bar.tsx`

- [ ] **Step 1: Create step-progress-bar.tsx**

Write `apps/student-app/components/canvas/step-progress-bar.tsx`:

```tsx
import { Text, View } from 'react-native';
import { MotiView } from 'moti';
import { Check } from 'lucide-react-native';
import { useTheme } from '@/lib/theme';
import { DEFAULT_STEP_LABELS } from '@/constants/canvas';

interface StepProgressBarProps {
  currentStep: number;
  totalSteps: number;
}

export function StepProgressBar({ currentStep, totalSteps }: StepProgressBarProps) {
  const { colors } = useTheme();

  const labels =
    totalSteps === 4
      ? DEFAULT_STEP_LABELS
      : Array.from({ length: totalSteps }, (_, i) => `${i + 1}단계`);

  return (
    <View
      style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 8, gap: 4 }}
    >
      {labels.map((label, index) => {
        const stepNum = index + 1;
        const isCompleted = stepNum < currentStep;
        const isCurrent = stepNum === currentStep;
        const isPending = stepNum > currentStep;

        return (
          <View key={stepNum} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <MotiView
              animate={{ scale: isCurrent ? 1.1 : 1, opacity: isPending ? 0.4 : 1 }}
              transition={{ scale: { type: 'timing', duration: 600, loop: isCurrent } }}
              style={{
                width: 22, height: 22, borderRadius: 11,
                backgroundColor: isCompleted || isCurrent ? colors.accent : colors.surface,
                alignItems: 'center', justifyContent: 'center',
              }}
            >
              {isCompleted ? (
                <Check color="#fff" size={12} strokeWidth={3} />
              ) : (
                <Text style={{ fontSize: 10, fontWeight: '700', color: isCurrent ? '#fff' : colors.textMuted }}>
                  {stepNum}
                </Text>
              )}
            </MotiView>
            <Text
              style={{ fontSize: 11, fontWeight: isCurrent ? '700' : '400', color: isPending ? colors.textMuted : colors.textPrimary }}
              numberOfLines={1}
            >
              {label}
            </Text>
            {index < labels.length - 1 ? (
              <View style={{ flex: 1, height: 1, backgroundColor: isCompleted ? colors.accent : colors.border, marginHorizontal: 2 }} />
            ) : null}
          </View>
        );
      })}
    </View>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/student-app/components/canvas/step-progress-bar.tsx
git commit -m "feat: add StepProgressBar component with moti animations"
```

---

## Chunk 4: Canvas Rewrite — DrawingCanvas + Web Stub

### Task 8: Rewrite drawing-canvas.tsx

**Files:**
- Modify: `apps/student-app/components/canvas/drawing-canvas.tsx` (full replacement)

- [ ] **Step 1: Rewrite drawing-canvas.tsx**

Replace the entire file `apps/student-app/components/canvas/drawing-canvas.tsx` with:

```tsx
import React, { ForwardedRef, useCallback, useImperativeHandle, useRef, useState } from 'react';
import { View, Pressable, Text, ActivityIndicator } from 'react-native';
import { Canvas, Path, Skia, ImageFormat, useCanvasRef } from '@shopify/react-native-skia';
import { Gesture, GestureDetector, PointerType } from 'react-native-gesture-handler';
import { Undo2, Redo2, Trash2, Eraser, Send } from 'lucide-react-native';
import { useTheme } from '@/lib/theme';
import { PEN_COLORS, STROKE_WIDTHS, ERASER_WIDTHS, SCRATCH_BG } from '@/constants/canvas';

interface DrawingPath {
  path: string;
  color: string;
  strokeWidth: number;
  isEraser: boolean;
}

export interface DrawingCanvasRef {
  capture: () => string | null;
  clear: () => void;
  undo: () => void;
  redo: () => void;
  hasContent: () => boolean;
  getMode: () => 'solution' | 'scratch';
  setMode: (mode: 'solution' | 'scratch') => void;
}

interface DrawingCanvasProps {
  onCapture: (imageBase64: string) => Promise<void> | void;
  toolbarPosition?: 'top' | 'bottom';
  onCanvasChange?: () => void;
  onStrokeEnd?: () => void;
  onEraserStrokeEnd?: () => void;
  onSolutionClear?: () => void;
}

function DrawingCanvasImpl(
  { onCapture, toolbarPosition = 'top', onCanvasChange, onStrokeEnd, onEraserStrokeEnd, onSolutionClear }: DrawingCanvasProps,
  ref: ForwardedRef<DrawingCanvasRef>,
) {
  const { colors, isDark } = useTheme();
  const canvasRef = useCanvasRef();
  const exportCanvasRef = useCanvasRef();

  // Dual-layer state
  const [mode, setMode] = useState<'solution' | 'scratch'>('solution');
  const [solutionPaths, setSolutionPaths] = useState<DrawingPath[]>([]);
  const [scratchPaths, setScratchPaths] = useState<DrawingPath[]>([]);
  const [solutionUndone, setSolutionUndone] = useState<DrawingPath[]>([]);
  const [scratchUndone, setScratchUndone] = useState<DrawingPath[]>([]);

  const activePaths = mode === 'solution' ? solutionPaths : scratchPaths;
  const setActivePaths = mode === 'solution' ? setSolutionPaths : setScratchPaths;
  const setActiveUndone = mode === 'solution' ? setSolutionUndone : setScratchUndone;

  // Pen state
  const [currentColor, setCurrentColor] = useState(PEN_COLORS[0]);
  const [strokeWidth, setStrokeWidth] = useState<(typeof STROKE_WIDTHS)[number]>(3);
  const [eraserWidth, setEraserWidth] = useState<(typeof ERASER_WIDTHS)[number]>(20);
  const [isEraser, setIsEraser] = useState(false);
  const [currentPath, setCurrentPath] = useState<DrawingPath | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const currentPathRef = useRef('');

  // Palm rejection
  const shouldDrawRef = useRef(true);
  const pencilDetectedRef = useRef(false);

  const canvasBg = mode === 'scratch'
    ? (isDark ? SCRATCH_BG.dark : SCRATCH_BG.light)
    : colors.bg;

  function buildPath(pathStr: string) {
    return Skia.Path.MakeFromSVGString(pathStr) ?? null;
  }

  function handleTouchStart(x: number, y: number) {
    currentPathRef.current = `M ${x} ${y}`;
    const activeWidth = isEraser ? eraserWidth : strokeWidth;
    setCurrentPath({
      path: currentPathRef.current,
      color: currentColor,
      strokeWidth: activeWidth,
      isEraser,
    });
    if (mode === 'solution') {
      setActiveUndone([]);
    } else {
      setScratchUndone([]);
    }
  }

  function handleTouchMove(x: number, y: number) {
    if (!currentPathRef.current) return;
    currentPathRef.current += ` L ${x} ${y}`;
    const activeWidth = isEraser ? eraserWidth : strokeWidth;
    setCurrentPath({
      path: currentPathRef.current,
      color: currentColor,
      strokeWidth: activeWidth,
      isEraser,
    });
  }

  function handleTouchEnd() {
    if (!currentPath) {
      currentPathRef.current = '';
      return;
    }
    setActivePaths((prev) => [...prev, currentPath]);
    setCurrentPath(null);
    currentPathRef.current = '';

    if (mode === 'solution') {
      onCanvasChange?.();
      if (isEraser) {
        onEraserStrokeEnd?.();
      } else {
        onStrokeEnd?.();
      }
    }
  }

  // Gesture Handler with palm rejection
  const panGesture = Gesture.Pan()
    .runOnJS(true)
    .minDistance(0)
    .minPointers(1)
    .maxPointers(1)
    .onBegin((e) => {
      if (e.pointerType === PointerType.STYLUS) pencilDetectedRef.current = true;
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
      shouldDrawRef.current = true;
    });

  const undo = useCallback(() => {
    setActivePaths((prev) => {
      if (prev.length === 0) return prev;
      setActiveUndone((stack) => [...stack, prev[prev.length - 1]]);
      return prev.slice(0, -1);
    });
    if (mode === 'solution') onCanvasChange?.();
  }, [mode, onCanvasChange, setActivePaths, setActiveUndone]);

  const redo = useCallback(() => {
    setActiveUndone((prev) => {
      if (prev.length === 0) return prev;
      const next = prev[prev.length - 1];
      setActivePaths((stack) => [...stack, next]);
      return prev.slice(0, -1);
    });
    if (mode === 'solution') onCanvasChange?.();
  }, [mode, onCanvasChange, setActivePaths, setActiveUndone]);

  const clear = useCallback(() => {
    setActivePaths([]);
    setActiveUndone([]);
    setCurrentPath(null);
    currentPathRef.current = '';
    if (mode === 'solution') {
      onCanvasChange?.();
      onSolutionClear?.();
    }
  }, [mode, onCanvasChange, onSolutionClear, setActivePaths, setActiveUndone]);

  const captureSnapshot = useCallback(() => {
    const exportCanvas = exportCanvasRef.current;
    if (!exportCanvas) return null;

    const image = exportCanvas.makeImageSnapshot();
    const base64 = image.encodeToBase64(ImageFormat.PNG, 100);
    image.dispose?.();
    return base64;
  }, [exportCanvasRef]);

  async function submitCapture() {
    if (isSubmitting || mode === 'scratch') return;
    const base64 = captureSnapshot();
    if (!base64) return;
    setIsSubmitting(true);
    try {
      await onCapture(base64);
    } finally {
      setIsSubmitting(false);
    }
  }

  useImperativeHandle(ref, () => ({
    capture: captureSnapshot,
    clear,
    undo,
    redo,
    hasContent: () => solutionPaths.length > 0,
    getMode: () => mode,
    setMode,
  }), [captureSnapshot, clear, undo, redo, solutionPaths.length, mode]);

  const toolbarBorderStyle =
    toolbarPosition === 'top'
      ? { borderBottomWidth: 1, borderBottomColor: colors.border }
      : { borderTopWidth: 1, borderTopColor: colors.border };

  const activeWidths = isEraser ? ERASER_WIDTHS : STROKE_WIDTHS;
  const activeWidthValue = isEraser ? eraserWidth : strokeWidth;

  const toolbar = (
    <View style={{ ...toolbarBorderStyle, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: colors.card, gap: 8 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {/* Mode tabs */}
        <View style={{ flexDirection: 'row', gap: 0, borderRadius: 8, overflow: 'hidden', borderWidth: 1, borderColor: colors.border }}>
          <Pressable
            onPress={() => setMode('solution')}
            style={{ paddingHorizontal: 12, paddingVertical: 6, backgroundColor: mode === 'solution' ? colors.accent : colors.surface }}
          >
            <Text style={{ fontSize: 12, fontWeight: '700', color: mode === 'solution' ? '#fff' : colors.textPrimary }}>풀이</Text>
          </Pressable>
          <Pressable
            onPress={() => setMode('scratch')}
            style={{ paddingHorizontal: 12, paddingVertical: 6, backgroundColor: mode === 'scratch' ? colors.accent : colors.surface }}
          >
            <Text style={{ fontSize: 12, fontWeight: '700', color: mode === 'scratch' ? '#fff' : colors.textPrimary }}>연습장</Text>
          </Pressable>
        </View>

        {/* Pen colors */}
        <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
          {PEN_COLORS.map((color) => (
            <Pressable
              key={color}
              onPress={() => { setCurrentColor(color); setIsEraser(false); }}
              style={{
                width: 26, height: 26, borderRadius: 8, backgroundColor: color,
                borderWidth: currentColor === color && !isEraser ? 3 : 0, borderColor: colors.accent,
              }}
            />
          ))}
        </View>

        {/* Width selector */}
        <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
          {activeWidths.map((w) => (
            <Pressable
              key={w}
              onPress={() => isEraser ? setEraserWidth(w as typeof eraserWidth) : setStrokeWidth(w as typeof strokeWidth)}
              style={{ alignItems: 'center', justifyContent: 'center', width: 28, height: 28 }}
            >
              <View
                style={{
                  width: Math.max(6, w * (isEraser ? 0.5 : 2)),
                  height: Math.max(6, w * (isEraser ? 0.5 : 2)),
                  borderRadius: 999,
                  backgroundColor: activeWidthValue === w ? colors.accent : colors.textMuted,
                }}
              />
            </Pressable>
          ))}
        </View>

        {/* Eraser */}
        <Pressable onPress={() => setIsEraser((v) => !v)} style={{ padding: 4 }}>
          <Eraser color={isEraser ? colors.accent : colors.textMuted} size={20} />
        </Pressable>

        {/* Actions */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Pressable onPress={undo}><Undo2 color={colors.textMuted} size={20} /></Pressable>
          <Pressable onPress={redo}><Redo2 color={colors.textMuted} size={20} /></Pressable>
          <Pressable onPress={clear}><Trash2 color={colors.destructive} size={20} /></Pressable>
          <Pressable
            onPress={submitCapture}
            disabled={isSubmitting || mode === 'scratch'}
            style={{
              flexDirection: 'row', alignItems: 'center', gap: 6,
              backgroundColor: mode === 'scratch' ? colors.surface : colors.accent,
              borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10,
              opacity: isSubmitting || mode === 'scratch' ? 0.5 : 1,
            }}
          >
            {isSubmitting ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Send color={mode === 'scratch' ? colors.textMuted : '#fff'} size={16} />
            )}
            <Text style={{ color: mode === 'scratch' ? colors.textMuted : '#fff', fontWeight: '700' }}>
              {isSubmitting ? '제출 중...' : '풀이 제출'}
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' }}>
      {toolbarPosition === 'top' ? toolbar : null}

      <View style={{ flex: 1 }}>
        <View
          pointerEvents="none"
          style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, opacity: 0 }}
        >
          <Canvas ref={exportCanvasRef} style={{ flex: 1, backgroundColor: '#ffffff' }}>
            {solutionPaths.map((p, index) => {
              const skPath = buildPath(p.path);
              if (!skPath) return null;
              return (
                <Path key={`export-${index}`} path={skPath} color={p.isEraser ? '#ffffff' : p.color} style="stroke"
                  strokeWidth={p.strokeWidth} strokeCap="round" strokeJoin="round" />
              );
            })}
          </Canvas>
        </View>

        <GestureDetector gesture={panGesture}>
          <View style={{ flex: 1, backgroundColor: canvasBg }}>
            <Canvas ref={canvasRef} style={{ flex: 1, backgroundColor: canvasBg }}>
              {activePaths.map((p, index) => {
                const skPath = buildPath(p.path);
                if (!skPath) return null;
                return (
                  <Path key={index} path={skPath} color={p.isEraser ? canvasBg : p.color} style="stroke"
                    strokeWidth={p.strokeWidth} strokeCap="round" strokeJoin="round" />
                );
              })}
              {currentPath && (() => {
                const skPath = buildPath(currentPath.path);
                if (!skPath) return null;
                return (
                  <Path path={skPath} color={currentPath.isEraser ? canvasBg : currentPath.color} style="stroke"
                    strokeWidth={currentPath.strokeWidth} strokeCap="round" strokeJoin="round" />
                );
              })()}
            </Canvas>
          </View>
        </GestureDetector>
      </View>

      {toolbarPosition === 'bottom' ? toolbar : null}
    </View>
  );
}

export const DrawingCanvas = React.forwardRef(DrawingCanvasImpl);
```

Notes:
- Keep `Gesture.Pan().runOnJS(true)` explicit. This rewrite still uses React state for path accumulation, so JS-thread callbacks are intentional here.
- Do not use numeric `pointerType` literals. Use `PointerType.STYLUS` so palm rejection remains correct if enum values differ by platform or library version.
- The hidden export canvas is the only capture source. This guarantees scratch strokes and theme-colored backgrounds never leak into uploads.
- Store `isEraser` on each path and resolve eraser color at render time. Otherwise a white export surface would still replay theme-colored eraser strokes into the uploaded PNG.

- [ ] **Step 2: Verify no TypeScript errors**

```bash
cd /Users/parkjisong/jsmath/apps/student-app && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 3: Commit**

```bash
git add apps/student-app/components/canvas/drawing-canvas.tsx
git commit -m "feat: rewrite DrawingCanvas with gesture handler, dual-layer, pen tools"
```

---

### Task 9: Update drawing-canvas.web.tsx stubs

**Files:**
- Modify: `apps/student-app/components/canvas/drawing-canvas.web.tsx` (full replacement)

- [ ] **Step 1: Rewrite drawing-canvas.web.tsx**

Replace the entire file `apps/student-app/components/canvas/drawing-canvas.web.tsx` with:

```tsx
import React, { ForwardedRef, useImperativeHandle } from 'react';
import { View, Text } from 'react-native';
import { useTheme } from '@/lib/theme';
import type { DrawingCanvasRef } from './drawing-canvas';

interface DrawingCanvasProps {
  onCapture: (imageBase64: string) => Promise<void> | void;
  toolbarPosition?: 'top' | 'bottom';
  onCanvasChange?: () => void;
  onStrokeEnd?: () => void;
  onEraserStrokeEnd?: () => void;
  onSolutionClear?: () => void;
}

function DrawingCanvasWebImpl(
  {
    onCapture: _onCapture,
    onStrokeEnd: _s,
    onEraserStrokeEnd: _e,
    onSolutionClear: _c,
  }: DrawingCanvasProps,
  ref: ForwardedRef<DrawingCanvasRef>,
) {
  const { colors } = useTheme();

  useImperativeHandle(ref, () => ({
    capture: () => null,
    clear: () => undefined,
    undo: () => undefined,
    redo: () => undefined,
    hasContent: () => false,
    getMode: () => 'solution' as const,
    setMode: () => undefined,
  }), []);

  return (
    <View style={{ flex: 1, backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <Text style={{ color: colors.textPrimary, fontSize: 16, fontWeight: '700' }}>
        웹에서는 펜슬 풀이를 지원하지 않습니다
      </Text>
      <Text style={{ color: colors.textMuted, fontSize: 13, marginTop: 8, textAlign: 'center' }}>
        iOS 또는 Android 앱에서 다시 시도해 주세요
      </Text>
    </View>
  );
}

export const DrawingCanvas = React.forwardRef(DrawingCanvasWebImpl);
```

- [ ] **Step 2: Verify no TypeScript errors**

```bash
cd /Users/parkjisong/jsmath/apps/student-app && npx tsc --noEmit 2>&1 | head -5
```

- [ ] **Step 3: Commit**

```bash
git add apps/student-app/components/canvas/drawing-canvas.web.tsx
git commit -m "fix: update web canvas stub for new DrawingCanvasRef interface"
```

---

## Chunk 5: Integration — LiveTutorPanel, useTutorChat, [problemId].tsx

### Task 10: Update LiveTutorPanel with hint level UI

**Files:**
- Modify: `apps/student-app/components/tutor/live-tutor-panel.tsx`

- [ ] **Step 1: Add hint level props to LiveTutorPanelProps**

Add to the `LiveTutorPanelProps` interface (after `onClose`):

```typescript
hintLevel?: 0 | 1 | 2 | 3;
onEscalateHint?: () => void;
```

Add to the function params destructuring: `hintLevel, onEscalateHint`

- [ ] **Step 2: Add hint button UI to the header**

Inside the header `View` (the one with `flexDirection: 'row', justifyContent: 'space-between'`), add the hint button BEFORE the `sessionReady && onOpenFullScreen` conditional block. Place it after the title/helper text `View`:

```tsx
{/* Hint level button — always visible when session ready */}
{sessionReady && onEscalateHint ? (
  <Pressable
    onPress={onEscalateHint}
    disabled={hintLevel === 3 || isStreaming}
    style={{
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 8,
      opacity: hintLevel === 3 || isStreaming ? 0.4 : 1,
    }}
  >
    {/* Hint level dots */}
    <View style={{ flexDirection: 'row', gap: 3 }}>
      {[0, 1, 2, 3].map((i) => (
        <View
          key={i}
          style={{
            width: 6,
            height: 6,
            borderRadius: 3,
            backgroundColor: i <= (hintLevel ?? 0) ? colors.accent : colors.border,
          }}
        />
      ))}
    </View>
    <Text style={{ fontSize: 12, fontWeight: '600', color: colors.textPrimary }}>
      더 자세한 힌트
    </Text>
  </Pressable>
) : null}
```

- [ ] **Step 3: Verify no TypeScript errors**

```bash
cd /Users/parkjisong/jsmath/apps/student-app && npx tsc --noEmit 2>&1 | head -5
```

- [ ] **Step 4: Commit**

```bash
git add apps/student-app/components/tutor/live-tutor-panel.tsx
git commit -m "feat: add progressive hint UI to LiveTutorPanel"
```

---

### Task 11: Normalize tutor messages in useTutorChat

**Files:**
- Modify: `apps/student-app/hooks/useTutorChat.ts`

- [ ] **Step 1: Import the shared normalizer**

Add:

```typescript
import { normalizeTutorMessage } from '@/lib/parse-step-tag';
```

- [ ] **Step 2: Normalize loaded session messages**

When mapping `session.messages`, strip `[STEP:N/T]` tags from tutor content before storing it in hook state:

```typescript
setMessages(
  session.messages.map((m, i) => {
    const normalized =
      m.role === 'tutor' ? normalizeTutorMessage(m.content) : { content: m.content };

    return {
      id: `init-${i}`,
      role: m.role as 'student' | 'tutor',
      content: normalized.content,
    };
  }),
);
```

- [ ] **Step 3: Normalize streaming tutor chunks**

Inside `sendMessage`, normalize tutor chunks before they reach the full-screen tutor UI:

```typescript
onChunk: (nextContent) => {
  tutorContent = nextContent;
  const normalized = normalizeTutorMessage(nextContent);
  setMessages((prev) =>
    prev.map((message) =>
      message.id === tutorMsgId
        ? { ...message, content: normalized.content }
        : message,
    ),
  );
},
```

- [ ] **Step 4: Commit**

```bash
git add apps/student-app/hooks/useTutorChat.ts
git commit -m "fix: normalize tutor step tags across full-screen chat"
```

---

### Task 12: Rewrite [problemId].tsx to wire everything together

**Files:**
- Modify: `apps/student-app/app/canvas/[problemId].tsx`

- [ ] **Step 1: Update imports**

Add these imports at the top of the file:

```typescript
import { MotiView } from 'moti';
import { useCanvasActivity } from '@/hooks/useCanvasActivity';
import { useHintLevel } from '@/hooks/useHintLevel';
import { AiStatusIndicator } from '@/components/canvas/ai-status-indicator';
import { StepProgressBar } from '@/components/canvas/step-progress-bar';
import { normalizeTutorMessage } from '@/lib/parse-step-tag';
```

Remove the `Bot, LoaderCircle` imports from lucide (no longer needed).

- [ ] **Step 2: Remove old state, add guarded session state, and wire activity/hint state**

Remove these lines:
- `const autoAnalysisTimerRef = useRef<...>(null);` (line ~75)
- `const canvasVersionRef = useRef(0);` (line ~76)
- `const lastAnalyzedVersionRef = useRef(0);` (line ~77)
- The cleanup `useEffect` that clears `autoAnalysisTimerRef` (lines ~87-94) — replace with just `abortRef.current?.abort()` cleanup
- The entire `scheduleAutoAnalysis` function (lines ~249-287)

Add after existing state declarations:

```typescript
const sessionPromiseRef = useRef<Promise<string> | null>(null);
const [localNudgeMessage, setLocalNudgeMessage] = useState<string | null>(null);
const [stepProgress, setStepProgress] = useState<{ current: number; total: number } | null>(null);
const {
  level: hintLevel,
  reset: resetHintLevel,
  getAutoPrompt,
  escalateAndGetPrompt,
  isMaxLevel,
} = useHintLevel(problemId!);

const { activityState, handleStrokeEnd, handleEraserStrokeEnd, resetActivity } = useCanvasActivity({
  onAutoAnalyze: () => {
    if (!canvasRef.current?.hasContent()) return;
    setIsSubmitting(true);
    void analyzeCurrentCanvas({
      prompt: getAutoPrompt(),
      revealPanel: false,
      showStudentMessage: false,
    })
      .then(() => {
        resetActivity();
      })
      .catch(() => undefined)
      .finally(() => setIsSubmitting(false));
  },
  onNudge: (message) => {
    setLocalNudgeMessage(message);
  },
  enabled: autoAnalyzeEnabled && isTablet,
  isBusy: isSubmitting || isTutorStreaming,
});
```

Update the cleanup useEffect to just:
```typescript
useEffect(() => {
  return () => { abortRef.current?.abort(); };
}, []);
```

Add a small effect so the local nudge clears automatically once the student resumes writing:

```typescript
useEffect(() => {
  if (activityState !== 'struggling') {
    setLocalNudgeMessage(null);
  }
}, [activityState]);
```

- [ ] **Step 3: Harden ensureSession, reset policy, and analyzeCurrentCanvas**

Replace `ensureSession()` with an in-flight guarded version so rapid auto/manual triggers cannot create duplicate tutor sessions:

```typescript
async function ensureSession() {
  if (sessionId) {
    return sessionId;
  }

  if (sessionPromiseRef.current) {
    return sessionPromiseRef.current;
  }

  sessionPromiseRef.current = api
    .post<{
      id: string;
      messages: Array<{ role: string; content: string }>;
    }>('/student-ai/tutor/sessions', { problemId })
    .then((session) => {
      setSessionId(session.id);
      setTutorMessages(
        session.messages.map((message, index) => {
          const normalized =
            message.role === 'tutor'
              ? normalizeTutorMessage(message.content)
              : { content: message.content };

          return {
            id: `init-${index}`,
            role: message.role as 'student' | 'tutor',
            content: normalized.content,
          };
        }),
      );
      return session.id;
    })
    .finally(() => {
      sessionPromiseRef.current = null;
    });

  return sessionPromiseRef.current;
}
```

Change the `analyzeCurrentCanvas` function. Replace the hardcoded prompt fallback:

```typescript
// Before:
await sendTutorTurn(options?.prompt ?? "제 풀이를 확인해주세요", uploadData.s3Key, {

// After:
await sendTutorTurn(options?.prompt ?? getAutoPrompt(), uploadData.s3Key, {
```

Remove the `options?.auto` / `lastAnalyzedVersionRef` logic at the bottom of the function (lines ~223-225). It's no longer needed.

Update `handleSubmit` so a successful full solution submission resets the local hint/activity state:

```typescript
await sendTutorTurn("제 풀이를 확인해주세요", uploadData.s3Key, {
  revealPanel: true,
  showStudentMessage: false,
});
resetHintLevel();
resetActivity();
setLocalNudgeMessage(null);
```

Update `handleTutorSend` so a free-form chat message also resets the manual hint ladder:

```typescript
setTutorInput('');
resetHintLevel();
setLocalNudgeMessage(null);
```

- [ ] **Step 4: Normalize streamed tutor content and update step progress**

In `sendTutorTurn`, capture the final streamed tutor content, normalize it once, and update both the message text and the step progress:

```typescript
const finalTutorContent = await streamTutorMessage({
  sessionId: activeSessionId,
  content,
  imageS3Key,
  signal: abortRef.current.signal,
  onChunk: (nextContent) => {
    setTutorMessages((prev) =>
      prev.map((message) =>
        message.id === tutorMessageId
          ? { ...message, content: nextContent }
          : message,
      ),
    );
  },
});

const normalized = normalizeTutorMessage(finalTutorContent);

if (normalized.stepProgress) {
  setStepProgress(normalized.stepProgress);
}

setTutorMessages((prev) =>
  prev.map((message) =>
    message.id === tutorMessageId
      ? { ...message, content: normalized.content }
      : message,
  ),
);
```

- [ ] **Step 5: Replace AI feedback button with AiStatusIndicator**

Replace the `{!showTutorPanel ? ( <Pressable ... /> ) : null}` block (lines ~533-578) with:

```tsx
{!showTutorPanel ? (
  <View style={{ position: 'absolute', right: 16, top: 16 }}>
    <AiStatusIndicator
      activityState={activityState}
      isAnalyzing={isSubmitting}
      isStreaming={isTutorStreaming}
      hasUnread={hasUnreadTutorFeedback}
      nudgeMessage={localNudgeMessage}
      onPress={() => {
        setShowTutorPanel(true);
        setHasUnreadTutorFeedback(false);
      }}
    />
  </View>
) : null}
```

- [ ] **Step 6: Add StepProgressBar and update auto-analysis copy**

After the problem card `View` and the auto-analysis toggle row, before the canvas `View`, add:

```tsx
{stepProgress ? (
  <MotiView
    from={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    transition={{ type: 'timing', duration: 300 }}
  >
    <StepProgressBar
      currentStep={stepProgress.current}
      totalSteps={stepProgress.total}
    />
  </MotiView>
) : null}
```

Also update the helper copy in the auto-analysis toggle row. Replace the old `2초` wording with copy that matches the new behavior, e.g.:

```tsx
<Text style={{ fontSize: 12, color: colors.textMuted }}>
  짧은 멈춤에는 기다리고, 약 20초 이상 멈췄을 때만 현재 풀이를 자동 분석합니다.
</Text>
```

- [ ] **Step 7: Update DrawingCanvas props**

Replace the `<DrawingCanvas>` usage:

```tsx
<DrawingCanvas
  ref={canvasRef}
  onCapture={handleSubmit}
  toolbarPosition="bottom"
  onStrokeEnd={() => {
    setLocalNudgeMessage(null);
    handleStrokeEnd();
  }}
  onEraserStrokeEnd={() => {
    setLocalNudgeMessage(null);
    handleEraserStrokeEnd();
  }}
  onSolutionClear={() => {
    resetActivity();
    resetHintLevel();
    setLocalNudgeMessage(null);
    setStepProgress(null);
  }}
/>
```

Remove `onCanvasChange={scheduleAutoAnalysis}` — the activity hook handles timing via `onStrokeEnd`/`onEraserStrokeEnd`.

- [ ] **Step 8: Pass hint level to LiveTutorPanel**

Add hint props to `<LiveTutorPanel>`:

```tsx
<LiveTutorPanel
  messages={tutorMessages}
  input={tutorInput}
  onInputChange={setTutorInput}
  onSend={handleTutorSend}
  isStreaming={isTutorStreaming}
  isTablet={isTablet}
  sessionReady={Boolean(sessionId)}
  onOpenFullScreen={sessionId ? () => router.push(`/tutor/${sessionId}`) : undefined}
  onClose={() => setShowTutorPanel(false)}
  hintLevel={hintLevel}
  onEscalateHint={async () => {
    if (isMaxLevel || !canvasRef.current?.hasContent()) return;
    const prompt = escalateAndGetPrompt();
    setLocalNudgeMessage(null);
    setIsSubmitting(true);
    try {
      await analyzeCurrentCanvas({
        prompt,
        revealPanel: true,
        showStudentMessage: false,
      });
      resetActivity();
    } finally {
      setIsSubmitting(false);
    }
  }}
/>
```

- [ ] **Step 9: Verify no TypeScript errors**

```bash
cd /Users/parkjisong/jsmath/apps/student-app && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 10: Commit**

```bash
git add apps/student-app/app/canvas/[problemId].tsx
git commit -m "feat: integrate canvas UX upgrade — activity tracking, hints, step progress"
```

---

## Chunk 6: Verification

### Task 13: Full build and behavior verification

- [ ] **Step 1: Run full TypeScript check**

```bash
cd /Users/parkjisong/jsmath/apps/student-app && npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 2: Verify Expo bundler resolves all imports**

```bash
cd /Users/parkjisong/jsmath/apps/student-app && npx expo start --clear 2>&1 | head -20
```

Expected: Metro bundler starts without resolution errors.

- [ ] **Step 3: Run focused manual QA on iPad or simulator**

Verify all of the following behaviors:

```text
1. Finger-only drawing still works before any stylus input is detected.
2. After one stylus stroke is detected, finger touches no longer draw on the canvas.
3. Scratch mode accepts strokes but does not enable submit and does not trigger auto-analysis.
4. Solution submit uploads only solution strokes, never scratch strokes, and uses a white background.
5. Auto-analysis does not re-fire immediately after a successful manual submit or manual hint request.
6. Tapping "더 자세한 힌트" immediately produces the next hint level, not the previous one.
7. Step progress tags are not visible in the canvas overlay tutor panel.
8. Step progress tags are also not visible when the same session is opened in `/tutor/[sessionId]`.
9. Clearing the solution layer resets local nudge state, step progress, and pending auto-analysis state.
10. The auto-analysis helper copy matches actual timing (observe on short pause, analyze on long idle).
```

- [ ] **Step 4: Final commit if any fixes needed**

Stage only the specific files that were fixed:

```bash
git status
# Only commit specific files if there are changes, e.g.:
# git add apps/student-app/specific-file.tsx
# git commit -m "fix: address build issues from integration"
```
