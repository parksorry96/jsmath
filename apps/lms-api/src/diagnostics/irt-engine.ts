// Pure IRT (Item Response Theory) functions — no side effects

export interface AbilityEstimate {
  theta: number;
  se: number;
  responses: number;
}

export interface TopicAbility {
  subject: string;
  unitMajor: string;
  theta: number;
  se: number;
  responses: number;
}

export interface TopicProfile {
  subject: string;
  unitMajor: string;
  score: number; // 0-100
  level: string; // Korean label
  theta: number;
  se: number;
  responses: number;
}

/**
 * Map difficulty 1-6 to IRT b-parameter (-2.5 to +2.5).
 */
export function difficultyToB(difficulty: number): number {
  // difficulty 1 -> -2.5, difficulty 6 -> +2.5
  return -2.5 + ((difficulty - 1) / 5) * 5;
}

/**
 * 1PL (Rasch) probability of correct response.
 */
export function pCorrect(theta: number, b: number): number {
  const exponent = theta - b;
  return 1 / (1 + Math.exp(-exponent));
}

/**
 * Newton-Raphson MLE single step update for ability estimate.
 * Clamps step size to +/-1 and theta to +/-3.
 */
export function updateAbility(
  current: AbilityEstimate,
  b: number,
  correct: boolean,
): AbilityEstimate {
  const p = pCorrect(current.theta, b);
  const y = correct ? 1 : 0;

  // Fisher information for 1PL
  const info = p * (1 - p);

  // Avoid division by near-zero
  if (info < 0.001) {
    return {
      theta: Math.max(-3, Math.min(3, current.theta + (correct ? 0.5 : -0.5))),
      se: current.se,
      responses: current.responses + 1,
    };
  }

  // Newton-Raphson step: delta = (y - p) / info
  let step = (y - p) / info;

  // Clamp step to +/-1
  step = Math.max(-1, Math.min(1, step));

  const newTheta = Math.max(-3, Math.min(3, current.theta + step));

  // Updated SE: 1 / sqrt(cumulative_info)
  // Approximate cumulative info as (responses + 1) * average_info
  const newResponses = current.responses + 1;
  const newSe = 1 / Math.sqrt(newResponses * Math.max(info, 0.01));

  return {
    theta: newTheta,
    se: newSe,
    responses: newResponses,
  };
}

/**
 * Select target difficulty range for next problem based on current ability.
 * Returns [minDifficulty, maxDifficulty] (1-6 scale).
 */
export function selectNextDifficulty(theta: number): [number, number] {
  // Map theta back to difficulty scale
  // theta -3 -> difficulty 0.5, theta +3 -> difficulty 6.5
  const targetDifficulty = ((theta + 2.5) / 5) * 5 + 1;
  const clamped = Math.max(1, Math.min(6, targetDifficulty));
  const min = Math.max(1, Math.floor(clamped - 0.5));
  const max = Math.min(6, Math.ceil(clamped + 0.5));
  return [min, max];
}

/**
 * Select the least-tested topic for next question.
 */
export function selectNextTopic(
  topicAbilities: TopicAbility[],
  allTopics: Array<{ subject: string; unitMajor: string }>,
): { subject: string; unitMajor: string } {
  if (allTopics.length === 0) {
    return { subject: "", unitMajor: "" };
  }

  // Build a map of response counts per topic
  const countMap = new Map<string, number>();
  for (const ta of topicAbilities) {
    countMap.set(`${ta.subject}::${ta.unitMajor}`, ta.responses);
  }

  // Find topic with fewest responses
  let minCount = Infinity;
  let selected = allTopics[0];

  for (const topic of allTopics) {
    const key = `${topic.subject}::${topic.unitMajor}`;
    const count = countMap.get(key) ?? 0;
    if (count < minCount) {
      minCount = count;
      selected = topic;
    }
  }

  return selected;
}

/**
 * Compute final per-topic ability profile with 0-100 scores and Korean level labels.
 */
export function computeProfile(topicAbilities: TopicAbility[]): TopicProfile[] {
  return topicAbilities.map((ta) => {
    // Map theta [-3, +3] to score [0, 100]
    const score = Math.round(Math.max(0, Math.min(100, ((ta.theta + 3) / 6) * 100)));

    let level: string;
    if (score >= 80) {
      level = "우수";
    } else if (score >= 60) {
      level = "양호";
    } else if (score >= 40) {
      level = "보통";
    } else if (score >= 20) {
      level = "부족";
    } else {
      level = "매우 부족";
    }

    return {
      subject: ta.subject,
      unitMajor: ta.unitMajor,
      score,
      level,
      theta: ta.theta,
      se: ta.se,
      responses: ta.responses,
    };
  });
}
