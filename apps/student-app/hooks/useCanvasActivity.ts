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
    if (prevBusyRef.current && !isBusy && enabledRef.current && enteredIdleRef.current) {
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
          if (!enteredIdleRef.current) return;
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
