export interface Sm2State {
  interval: number;
  easeFactor: number;
  repetitions: number;
}

export interface Sm2Result extends Sm2State {
  nextReviewAt: Date;
  lastReviewedAt: Date;
}

/**
 * SM-2 spaced repetition algorithm.
 * quality: 0-5 (0=complete failure, 5=perfect recall)
 */
export function applySmTwo(current: Sm2State, quality: number): Sm2Result {
  const now = new Date();
  let { interval, easeFactor, repetitions } = current;

  if (quality >= 3) {
    if (repetitions === 0) {
      interval = 1;
    } else if (repetitions === 1) {
      interval = 6;
    } else {
      interval = Math.round(interval * easeFactor);
    }
    repetitions += 1;
  } else {
    repetitions = 0;
    interval = 1;
  }

  easeFactor =
    easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
  if (easeFactor < 1.3) {
    easeFactor = 1.3;
  }

  const nextReviewAt = new Date(now);
  nextReviewAt.setDate(nextReviewAt.getDate() + interval);

  return { interval, easeFactor, repetitions, nextReviewAt, lastReviewedAt: now };
}
