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
}

interface CanvasActivityState {
  activityState: 'writing' | 'paused' | 'idle' | 'struggling';
  handleStrokeEnd: () => void;
  handleEraseStroke: () => void;
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
| >50% strokes erased in 30s | any → `struggling` | Encourage: "Fresh approach is good" |

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
- `DrawingCanvas`: add `onStrokeEnd` and `onEraseStroke` callbacks alongside existing `onCanvasChange`

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

#### UI: "More Hint" Button
- Added to `LiveTutorPanel` header, next to "전체 보기" button
- Shows current level as dots: `●●○○`
- Pressing escalates level and triggers `analyzeCurrentCanvas` with the new prompt
- Disabled at level 3 (already max)

#### Integration Point
- `[problemId].tsx`: `analyzeCurrentCanvas` uses `promptForLevel()` instead of hardcoded string
- `live-tutor-panel.tsx`: adds hint level UI
- Auto-analysis always uses level 0. Manual escalation only via button.

---

## 4. Canvas Gesture Handler + Pen Tools

### Problem
Native responder API cannot read `pointerType` — no palm rejection. Pen options are minimal (3 fixed colors, fixed width).

### Solution

#### 4-1. Gesture Handler Migration

Replace `onResponderGrant/Move/Release` with `Gesture.Pan()` from `react-native-gesture-handler`.

```typescript
const panGesture = Gesture.Pan()
  .onBegin((e) => {
    if (pencilDetected && e.pointerType !== PointerType.STYLUS) return;
    handleTouchStart(e.x, e.y);
  })
  .onUpdate((e) => {
    handleTouchMove(e.x, e.y);
  })
  .onEnd(() => {
    handleTouchEnd();
  })
  .minPointers(1)
  .maxPointers(1);
```

Key: `e.pointerType` distinguishes stylus from touch. When stylus is detected, subsequent touch events are ignored (palm rejection). When no stylus has been detected, touch is allowed as fallback.

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
[●][●][●] color  [·][•][●] width  [eraser]  |  [undo][redo][clear]  [submit]
```

#### 4-4. Eraser Size

```typescript
const ERASER_WIDTHS = [10, 20, 40] as const;
```

When eraser is active, the width selector switches to eraser sizes.

#### Integration Point
- `drawing-canvas.tsx`: full rewrite of touch handling section + toolbar UI
- `drawing-canvas.web.tsx`: unchanged (web unsupported)

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
- `capture()` always captures from `solutionPaths` regardless of current mode
- `hasContent()` checks `solutionPaths.length > 0`

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
  return {
    currentStep: parseInt(match[1]),
    totalSteps: parseInt(match[2]),
    cleanContent: content.replace(/\[STEP:\d+\/\d+\]\s*/, ''),
  };
}
```

The `[STEP:N/T]` tag is stripped from displayed message content.

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
- Hidden until first `[STEP:N/T]` is parsed from an AI response
- Appears with moti `AnimatePresence` fade-in
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
| `components/canvas/drawing-canvas.tsx` | Gesture Handler migration, dual-layer paths, pen tool UI, scratch pad tabs, eraser sizes, new ref methods |
| `components/tutor/live-tutor-panel.tsx` | Hint level dots + "더 자세한 힌트" button |
| `app/canvas/[problemId].tsx` | Integrate useCanvasActivity, useHintLevel, AiStatusIndicator, StepProgressBar, wire new DrawingCanvas callbacks |
| `package.json` | Add `moti` dependency |

### Unchanged Files
| File | Reason |
|------|--------|
| `components/canvas/drawing-canvas.web.tsx` | Web unsupported, no changes |
| `lib/tutor-stream.ts` | SSE streaming unchanged |
| `hooks/useTutorChat.ts` | Used by full-screen tutor, not canvas screen |
| `components/tutor/chat-bubble.tsx` | No changes needed |

---

## Dependencies

### Added
- `moti` — Declarative animations on top of Reanimated. ~15KB gzipped.

### Already Installed (used more fully)
- `react-native-gesture-handler` ~2.30.0 — Gesture.Pan() for canvas
- `react-native-reanimated` 4.2.1 — Required by moti
- `lucide-react-native` ^0.577.0 — Eye, Hand icons (already bundled)

### No Server Changes
All improvements are client-side. AI behavior changes are achieved through prompt modification only. No new API endpoints needed.
