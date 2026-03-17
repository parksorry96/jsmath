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
