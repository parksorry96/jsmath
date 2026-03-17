# Pencil Canvas UX Upgrade — Design Spec

**Date:** 2026-03-18
**Scope:** Phase 1 (AI Intelligence) + Phase 2 (Canvas Experience)
**Target:** `apps/student-app` — iPad pencil solving feature
**New dependency:** `moti` (declarative animations on top of Reanimated)

---

## 1. AI Intervention Timing System

### Problem
Fixed 2-second debounce after any stroke end triggers auto-analysis. Cannot distinguish "thinking" from "stuck." Interrupts productive struggle.

### Solution
Replace `scheduleAutoAnalysis()` with a `useCanvasActivity` hook that tracks student activity state.

#### Hook: `useCanvasActivity(options)`

```typescript
// hooks/useCanvasActivity.ts
interface CanvasActivityOptions {
  onAutoAnalyze: () => void;
  onNudge: (message: string) => void;
  enabled: boolean;
  isBusy: boolean; // true when isSubmitting || isTutorStreaming — guards against concurrent analysis
}

interface CanvasActivityState {
  activityState: 'writing' | 'paused' | 'idle' | 'struggling';
  handleStrokeEnd: () => void;
  handleEraserStrokeEnd: () => void; // called when a stroke is drawn with isEraser=true
  resetTimers: () => void;
}
```

#### State Transitions

| Event | Transition | AI Action |
|-------|-----------|-----------|
| Stroke added | → `writing` | None (observe) |
| 5s no input | `writing` → `paused` | None (may be thinking) |
| 20s no input + ≥3 strokes since last analysis | `paused` → `idle` | Auto-analyze (level 0 prompt) |
| 45s no input | `idle` → `struggling` | Nudge: "Need a hint?" |
| >50% of recent strokes are eraser strokes (last 30s window) | any → `struggling` | Encourage: "Fresh approach is good" |

**Erase detection:** Since the eraser paints over with background color rather than removing strokes, we track erase activity by counting strokes where `isEraser=true`. The `handleEraserStrokeEnd` callback increments an eraser stroke counter. The hook maintains a sliding window (30s) of total strokes vs eraser strokes. When the eraser ratio exceeds 50%, the state transitions to `struggling`.

#### `enabled` Toggle Behavior

- When `enabled` becomes `false`: all timers are cleared, state resets to `writing`, no `onAutoAnalyze` or `onNudge` fires.
- When `enabled` becomes `true` mid-session: timers restart from the current moment as if the student just started writing.
- The `onNudge` callback (struggling state from erase detection) also respects `enabled` — it does NOT fire when disabled.

#### `isBusy` Guard

- When `isBusy` is `true`, the `onAutoAnalyze` callback is suppressed. The hook stays in `idle` state and re-checks when `isBusy` transitions back to `false`.
- This prevents concurrent analysis when the user manually submits while auto-analysis timer fires.

#### Constants (tunable)

```typescript
const TIMING = {
  PAUSE_THRESHOLD_MS: 5_000,
  IDLE_THRESHOLD_MS: 20_000,
  STRUGGLE_THRESHOLD_MS: 45_000,
  MIN_STROKES_FOR_ANALYSIS: 3,
  ERASE_RATIO_THRESHOLD: 0.5,
  ERASE_WINDOW_MS: 30_000,
} as const;
```

#### Integration Point
- `[problemId].tsx`: replace `scheduleAutoAnalysis` and `autoAnalysisTimerRef` with `useCanvasActivity`
- `DrawingCanvas`: add `onStrokeEnd` and `onEraserStrokeEnd` callbacks alongside existing `onCanvasChange`
- Pass `isBusy: isSubmitting || isTutorStreaming` to the hook

---

## 2. AI Status Indicator

### Problem
Only a static Bot icon + LoaderCircle spinner. No visual signal that AI is observing during writing.

### Solution
New `AiStatusIndicator` component using `moti` for declarative animations.

#### Component: `AiStatusIndicator`

```typescript
// components/canvas/ai-status-indicator.tsx
interface AiStatusIndicatorProps {
  activityState: 'writing' | 'paused' | 'idle' | 'struggling';
  isAnalyzing: boolean;
  isStreaming: boolean;
  hasUnread: boolean;
  onPress: () => void;
}
```

#### Visual States

| State | Icon | Animation | Color |
|-------|------|-----------|-------|
| `writing` | Eye | Slow opacity pulse (0.5↔0.8, 2s loop) | textMuted |
| `paused` | Bot | Static, slightly brighter | textSecondary |
| `analyzing` | Bot | Fast pulse + scale(1.0↔1.05, 300ms loop) | accent |
| `streaming` | Bot | Typing dots animation | accent |
| `hasUnread` | Bot + red dot | Single bounce | accent |
| `struggling` nudge | Hand | Single shake left-right | accent |

#### Moti Usage

```tsx
import { MotiView } from 'moti';

<MotiView
  animate={{
    opacity: isWriting ? 0.5 : 1,
    scale: isAnalyzing ? 1.05 : 1,
  }}
  transition={{
    opacity: { type: 'timing', duration: 2000, loop: isWriting },
    scale: { type: 'timing', duration: 300, loop: isAnalyzing },
  }}
>
  <Icon />
</MotiView>
```

#### Integration Point
- Replaces the `Pressable` block at lines 533-578 in `[problemId].tsx`

---

## 3. Progressive Hint System

### Problem
AI gives full feedback immediately. No scaffolding. Risk of "cognitive crutch" (2025 Harvard RCT).

### Solution
Client-side hint level tracker that modifies the prompt sent to the tutor API.

#### Hook: `useHintLevel(problemId)`

```typescript
// hooks/useHintLevel.ts
interface HintLevelState {
  level: 0 | 1 | 2 | 3;
  escalate: () => void;
  reset: () => void;
  promptForLevel: () => string;
}
```

#### Hint Levels

| Level | Trigger | Prompt Strategy | Example Output |
|-------|---------|----------------|----------------|
| 0 (auto) | Auto-analysis on idle | "Point out which line has an error. Do not give the answer or method." | "Check line 3 again" |
| 1 (nudge) | Struggling state or student asks "hint" | "Name the type of error (sign/calculation/concept). No specific fix." | "There's a sign error" |
| 2 (specific) | Student asks for more help | "Tell them which step to redo and why. Don't give the answer." | "Redo subtracting 3 from both sides" |
| 3 (guide) | Student explicitly says "show me" | "Walk through the solution one step at a time." | Full guided walkthrough |

#### Prompt Templates

```typescript
const HINT_PROMPTS: Record<number, string> = {
  0: '지금까지의 풀이를 보고, 오류가 있는 줄 번호만 짧게 알려주세요. 정답이나 풀이법은 절대 말하지 마세요. 응답 첫 줄에 [STEP:N/T] 형식으로 현재 단계를 표시하세요.',
  1: '오류의 종류(부호/계산/개념)를 알려주세요. 구체적 수정 방법은 말하지 마세요. 응답 첫 줄에 [STEP:N/T] 형식으로 현재 단계를 표시하세요.',
  2: '어떤 단계를 다시 해야 하는지 구체적으로 알려주세요. 답 자체는 말하지 마세요. 응답 첫 줄에 [STEP:N/T] 형식으로 현재 단계를 표시하세요.',
  3: '한 단계씩 풀이를 안내해주세요. 응답 첫 줄에 [STEP:N/T] 형식으로 현재 단계를 표시하세요.',
};
```

#### Prompt Injection Point

All hint prompts are sent as the `content` parameter of `sendTutorTurn` with `showStudentMessage: false`. This means they appear as hidden student messages in the conversation history. The AI sees them as instructions but they are not rendered in the chat UI. This matches the current behavior of `analyzeCurrentCanvas` which already uses `showStudentMessage: false`.

#### UI: "More Hint" Button
- Added to `LiveTutorPanel` header, next to "전체 보기" button
- Shows current level as dots: `●●○○`
- Pressing escalates level and triggers `analyzeCurrentCanvas` with the new prompt
- Disabled at level 3 (already max)

#### Integration Point
- `[problemId].tsx`: `analyzeCurrentCanvas` uses `promptForLevel()` instead of hardcoded string
- `live-tutor-panel.tsx`: adds hint level UI + onEscalateHint callback
- Auto-analysis always uses level 0. Manual escalation only via button.

---

## 4. Canvas Gesture Handler + Pen Tools

### Problem
Native responder API cannot read `pointerType` — no palm rejection. Pen options are minimal (3 fixed colors, fixed width).

### Solution

#### 4-1. Gesture Handler Migration

Replace `onResponderGrant/Move/Release` with `Gesture.Pan()` from `react-native-gesture-handler`.

```typescript
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

const shouldDrawRef = useRef(true);
const pencilDetectedRef = useRef(false);

const panGesture = Gesture.Pan()
  .minDistance(0)  // capture dots and short marks (default 10px would miss them)
  .minPointers(1)
  .maxPointers(1)
  .onBegin((e) => {
    // Palm rejection: if pencil was ever detected, reject touch input
    if (e.pointerType === 2 /* STYLUS */) {
      pencilDetectedRef.current = true;
    }
    if (pencilDetectedRef.current && e.pointerType !== 2) {
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
```

**Palm rejection approach:** A `shouldDrawRef` guard ref is set in `onBegin` and checked in `onUpdate`/`onEnd`. Returning early from `onBegin` alone does NOT prevent subsequent callbacks, so the guard ref is necessary. Once any stylus event is detected (`pencilDetectedRef`), all non-stylus input is rejected. When no stylus has been detected, touch is allowed as fallback.

**Wrapper change:**
```tsx
// Before:
<View onStartShouldSetResponder ... >
  <Canvas ... />
</View>

// After:
<GestureDetector gesture={panGesture}>
  <View>
    <Canvas ... />
  </View>
</GestureDetector>
```

#### 4-2. Pen Colors (Okabe-Ito Palette)

```typescript
// Color-blind safe palette
const PEN_COLORS = ['#000000', '#0072B2', '#E69F00'];
// Black, Blue, Orange — distinguishable across protanopia, deuteranopia, tritanopia
```

Replaces current `['#333333', '#c87070', '#5da37e']`.

#### 4-3. Stroke Width Selection

```typescript
const STROKE_WIDTHS = [1, 3, 5] as const;
```

UI: three circles of increasing size next to color selectors.

```
[풀이|연습장]  [●][●][●] color  [·][•][●] width  [eraser]  |  [undo][redo][clear]  [submit]
```

#### 4-4. Eraser Size

```typescript
const ERASER_WIDTHS = [10, 20, 40] as const;
```

When eraser is active, the width selector switches to eraser sizes.

#### Integration Point
- `drawing-canvas.tsx`: full rewrite of touch handling section + toolbar UI
- `drawing-canvas.web.tsx`: requires stub updates (see Section 5)

---

## 5. Scratch Pad Mode

### Problem
All strokes go to a single paths array. AI analyzes everything, including exploratory rough work.

### Solution
Two path arrays (layers) within the same canvas component, switched by mode tab.

#### State Changes in `drawing-canvas.tsx`

```typescript
// New state
const [mode, setMode] = useState<'solution' | 'scratch'>('solution');
const [solutionPaths, setSolutionPaths] = useState<DrawingPath[]>([]);
const [scratchPaths, setScratchPaths] = useState<DrawingPath[]>([]);
const [solutionUndone, setSolutionUndone] = useState<DrawingPath[]>([]);
const [scratchUndone, setScratchUndone] = useState<DrawingPath[]>([]);

// Derived
const activePaths = mode === 'solution' ? solutionPaths : scratchPaths;
const setActivePaths = mode === 'solution' ? setSolutionPaths : setScratchPaths;
const activeUndone = mode === 'solution' ? solutionUndone : scratchUndone;
const setActiveUndone = mode === 'solution' ? setSolutionUndone : setScratchUndone;
```

Replaces current single `paths` and `undone` state.

#### Visual Differentiation

| Element | Solution | Scratch |
|---------|----------|---------|
| Canvas background | `colors.bg` | `#fffdf0` (light) / `#1e1d16` (dark) |
| Active tab | Bold + accent underline | Bold + accent underline |
| Inactive tab | Muted text | Muted text |
| Submit button | Enabled | Disabled + muted |
| AI auto-analysis | Active | Disabled |

#### Mode Tab UI

Added to toolbar, left side:

```
┌──────┬────────┐
│ 풀이  │ 연습장  │  [pen tools...]  [actions...]
└──────┴────────┘
```

#### Callbacks

- `onCanvasChange` only fires when `mode === 'solution'`
- `onStrokeEnd` only fires when `mode === 'solution'`
- `hasContent()` checks `solutionPaths.length > 0`

#### Capture Behavior

`capture()` must always return the solution layer, regardless of current mode. Since `canvasRef.current.makeImageSnapshot()` captures whatever is currently rendered on the Skia Canvas, the implementation must:

1. Temporarily switch the rendered paths to `solutionPaths`
2. Force a synchronous render on the Skia canvas
3. Call `makeImageSnapshot()`
4. Restore the previously rendered paths

Implementation approach: the `capture()` method will set a `captureOverridePaths` ref. When this ref is set, the Canvas renders from it instead of `activePaths`. After snapshot, the ref is cleared. This avoids a visible flicker since the Skia Canvas renders synchronously within the same frame.

```typescript
const captureOverrideRef = useRef<DrawingPath[] | null>(null);
const renderedPaths = captureOverrideRef.current ?? activePaths;

// In capture():
captureOverrideRef.current = solutionPaths;
// Force Skia re-render by reading canvas
const image = canvasRef.current.makeImageSnapshot();
captureOverrideRef.current = null;
```

#### New Ref Methods

```typescript
export interface DrawingCanvasRef {
  capture: () => string | null;
  clear: () => void;
  undo: () => void;
  redo: () => void;
  hasContent: () => boolean;
  getMode: () => 'solution' | 'scratch';    // new
  setMode: (mode: 'solution' | 'scratch') => void;  // new
}
```

#### Web Stub Updates

`drawing-canvas.web.tsx` must be updated to implement the expanded `DrawingCanvasRef` interface and accept the new optional props to avoid TypeScript compilation errors:

```typescript
// drawing-canvas.web.tsx additions
useImperativeHandle(ref, () => ({
  capture: () => null,
  clear: () => undefined,
  undo: () => undefined,
  redo: () => undefined,
  hasContent: () => false,
  getMode: () => 'solution' as const,   // new stub
  setMode: () => undefined,              // new stub
}), []);
```

New optional props (`onStrokeEnd`, `onEraserStrokeEnd`) are accepted but ignored in the web stub.

---

## 6. Step Progress Bar

### Problem
No visualization of where the student is in their solution process.

### Solution
AI includes `[STEP:N/T]` tag in auto-analysis responses. Client parses it and renders a horizontal stepper.

#### AI Response Protocol

Auto-analysis prompts include:
```
응답 첫 줄에 반드시 [STEP:N/T] 형식을 포함하세요. N=현재 단계(1부터), T=예상 총 단계수.
```

#### Client Parsing

```typescript
// lib/parse-step-tag.ts
function parseStepTag(content: string): {
  currentStep: number;
  totalSteps: number;
  cleanContent: string;
} | null {
  const match = content.match(/\[STEP:(\d+)\/(\d+)\]/);
  if (!match) return null;

  const currentStep = parseInt(match[1]);
  const totalSteps = parseInt(match[2]);

  // Validate: N >= 1, T >= 1, N <= T
  if (currentStep < 1 || totalSteps < 1 || currentStep > totalSteps) return null;

  return {
    currentStep,
    totalSteps,
    cleanContent: content.replace(/\[STEP:\d+\/\d+\]\s*/, ''),
  };
}
```

The `[STEP:N/T]` tag is stripped from displayed message content.

#### Edge Case Handling

- **AI response lacks `[STEP:N/T]`:** Progress bar retains the last valid step data. This happens for free-text chat messages from student typing — the bar simply keeps showing the previous state.
- **Total steps change mid-session** (e.g., `[STEP:2/4]` then `[STEP:2/5]`): Bar re-renders with the new total. Steps 1 through N-1 are marked completed. Previously completed steps beyond the new total are discarded.
- **Invalid values** (N=0, N>T, T=0): `parseStepTag` returns `null`, treated as "no tag present" — bar retains previous state.
- **First response ever:** Bar is hidden until the first valid `[STEP:N/T]` is parsed.

#### Component: `StepProgressBar`

```typescript
// components/canvas/step-progress-bar.tsx
interface StepProgressBarProps {
  currentStep: number;
  totalSteps: number;
}
```

Default labels: `['문제 파악', '식 세우기', '풀이', '검산']`
If `totalSteps` differs from 4, fall back to numbered labels: `['1단계', '2단계', ...]`

#### Visual

```
  ✓ 문제 파악 ─── ✓ 식 세우기 ─── ● 풀이 ─── ○ 검산
```

- Completed: accent color circle + check icon, moti scale bounce on transition
- Current: accent color + pulse animation
- Pending: muted color, static

Height: ~40px. Placed between problem card and canvas in `[problemId].tsx`.

#### Visibility
- Hidden until first valid `[STEP:N/T]` is parsed from an AI response
- Appears with `MotiView` opacity animation (0 → 1) conditioned on `stepProgress !== null`
- State stored in `[problemId].tsx`: `stepProgress: { current: number, total: number } | null`

---

## File Change Summary

### New Files
| File | Purpose |
|------|---------|
| `hooks/useCanvasActivity.ts` | Activity state tracking + auto-analysis timing |
| `hooks/useHintLevel.ts` | Progressive hint level management |
| `components/canvas/ai-status-indicator.tsx` | Animated AI presence indicator |
| `components/canvas/step-progress-bar.tsx` | Horizontal step progress UI |
| `lib/parse-step-tag.ts` | Parse `[STEP:N/T]` from AI responses |
| `constants/canvas.ts` | Timing constants, pen colors, stroke widths |

### Modified Files
| File | Changes |
|------|---------|
| `components/canvas/drawing-canvas.tsx` | Gesture Handler migration, dual-layer paths, pen tool UI, scratch pad tabs, eraser sizes, capture override, new ref methods |
| `components/canvas/drawing-canvas.web.tsx` | Add stub implementations for `getMode`, `setMode`; accept new optional props |
| `components/tutor/live-tutor-panel.tsx` | Hint level dots + "더 자세한 힌트" button + `onEscalateHint` callback |
| `app/canvas/[problemId].tsx` | Integrate useCanvasActivity, useHintLevel, AiStatusIndicator, StepProgressBar, wire new DrawingCanvas callbacks, pass isBusy guard |
| `package.json` | Add `moti` dependency |

### Unchanged Files
| File | Reason |
|------|--------|
| `lib/tutor-stream.ts` | SSE streaming unchanged |
| `hooks/useTutorChat.ts` | Used by full-screen tutor, not canvas screen |
| `components/tutor/chat-bubble.tsx` | No changes needed |

---

## Dependencies

### Added
- `moti` — Declarative animations on top of Reanimated. ~15KB gzipped. Import: `import { MotiView } from 'moti'`

### Already Installed (used more fully)
- `react-native-gesture-handler` ~2.30.0 — `Gesture.Pan()`, `GestureDetector` for canvas
- `react-native-reanimated` 4.2.1 — Required by moti
- `lucide-react-native` ^0.577.0 — Eye, Hand icons (already bundled)

### No Server Changes
All improvements are client-side. AI behavior changes are achieved through prompt modification only. No new API endpoints needed.
