export interface AchievementDefinition {
  key: string;
  title: string;
  description: string;
  icon: string;
}

export const ACHIEVEMENT_DEFINITIONS: AchievementDefinition[] = [
  {
    key: "first_solve",
    title: "첫 걸음",
    description: "첫 번째 문제를 풀었습니다",
    icon: "rocket",
  },
  {
    key: "streak_3",
    title: "3일 연속 학습",
    description: "3일 연속으로 문제를 풀었습니다",
    icon: "flame",
  },
  {
    key: "streak_7",
    title: "일주일 연속 학습",
    description: "7일 연속으로 문제를 풀었습니다",
    icon: "flame",
  },
  {
    key: "streak_14",
    title: "2주 연속 학습",
    description: "14일 연속으로 문제를 풀었습니다",
    icon: "flame",
  },
  {
    key: "streak_30",
    title: "한 달 연속 학습",
    description: "30일 연속으로 문제를 풀었습니다",
    icon: "flame",
  },
  {
    key: "mastery_first",
    title: "첫 마스터",
    description: "첫 번째 단원을 마스터했습니다",
    icon: "star",
  },
  {
    key: "perfect_score",
    title: "만점왕",
    description: "과제에서 100점을 받았습니다",
    icon: "crown",
  },
  {
    key: "problem_50",
    title: "50문제 돌파",
    description: "총 50문제를 풀었습니다",
    icon: "target",
  },
  {
    key: "problem_100",
    title: "100문제 돌파",
    description: "총 100문제를 풀었습니다",
    icon: "target",
  },
  {
    key: "problem_500",
    title: "500문제 돌파",
    description: "총 500문제를 풀었습니다",
    icon: "trophy",
  },
];

export const ACHIEVEMENT_MAP = new Map(
  ACHIEVEMENT_DEFINITIONS.map((a) => [a.key, a]),
);
