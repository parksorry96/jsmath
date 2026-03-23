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

  return {
    level,
    reset,
    getAutoPrompt,
    escalateAndGetPrompt,
    isMaxLevel: level === MAX_HINT_LEVEL,
  };
}
