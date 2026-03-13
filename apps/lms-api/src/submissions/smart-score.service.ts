import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

export interface SmartScoreBreakdown {
  rawScore: number;
  difficultyWeight: number;
  consistencyBonus: number;
  streakBonus: number;
  timeFactor: number;
  finalScore: number;
}

const DIFFICULTY_WEIGHT: Record<number, number> = {
  1: 0.6,
  2: 0.8,
  3: 1.0,
  4: 1.3,
  5: 1.6,
  6: 1.8,
};

@Injectable()
export class SmartScoreService {
  constructor(private prisma: PrismaService) {}

  async calculate(submissionId: string): Promise<SmartScoreBreakdown> {
    const submission = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      include: {
        answers: {
          select: {
            problemId: true,
            isCorrect: true,
          },
        },
      },
    });

    if (!submission || submission.answers.length === 0) {
      return {
        rawScore: 0,
        difficultyWeight: 1.0,
        consistencyBonus: 0,
        streakBonus: 0,
        timeFactor: 1.0,
        finalScore: 0,
      };
    }

    const gradedAnswers = submission.answers.filter(
      (a) => a.isCorrect !== null && a.isCorrect !== undefined,
    );

    if (gradedAnswers.length === 0) {
      return {
        rawScore: 0,
        difficultyWeight: 1.0,
        consistencyBonus: 0,
        streakBonus: 0,
        timeFactor: 1.0,
        finalScore: 0,
      };
    }

    const correctCount = gradedAnswers.filter((a) => a.isCorrect).length;
    const rawScore = (correctCount / gradedAnswers.length) * 100;

    const problemIds = gradedAnswers.map((a) => a.problemId);
    const problems = await this.prisma.problem.findMany({
      where: { id: { in: problemIds } },
      select: {
        id: true,
        difficulty: true,
        unitMajor: true,
      },
    });
    const problemMap = new Map(problems.map((p) => [p.id, p]));

    // difficultyWeight: average of weights for problems that have a known difficulty
    const weights: number[] = [];
    for (const answer of gradedAnswers) {
      const problem = problemMap.get(answer.problemId);
      const difficulty = problem?.difficulty;
      if (difficulty != null && DIFFICULTY_WEIGHT[difficulty] != null) {
        weights.push(DIFFICULTY_WEIGHT[difficulty]);
      }
    }
    const difficultyWeight =
      weights.length > 0
        ? weights.reduce((sum, w) => sum + w, 0) / weights.length
        : 1.0;

    // consistencyBonus: if per-topic accuracy variance is low (< 15% spread)
    const topicAccuracies = new Map<string, { correct: number; total: number }>();
    for (const answer of gradedAnswers) {
      const problem = problemMap.get(answer.problemId);
      const topic = problem?.unitMajor ?? "__unknown__";
      const existing = topicAccuracies.get(topic) ?? { correct: 0, total: 0 };
      topicAccuracies.set(topic, {
        correct: existing.correct + (answer.isCorrect ? 1 : 0),
        total: existing.total + 1,
      });
    }

    let consistencyBonus = 0;
    const topicRates = [...topicAccuracies.values()].map(
      (t) => t.correct / t.total,
    );
    if (topicRates.length >= 2) {
      const maxRate = Math.max(...topicRates);
      const minRate = Math.min(...topicRates);
      if (maxRate - minRate < 0.15) {
        consistencyBonus = 0.05;
      }
    }

    // streakBonus: longest consecutive correct answers, capped at 0.10
    let longestStreak = 0;
    let currentStreak = 0;
    for (const answer of gradedAnswers) {
      if (answer.isCorrect) {
        currentStreak++;
        if (currentStreak > longestStreak) {
          longestStreak = currentStreak;
        }
      } else {
        currentStreak = 0;
      }
    }
    const streakBonus = Math.min(longestStreak * 0.005, 0.10);

    const timeFactor = 1.0;

    const rawFinal =
      rawScore * difficultyWeight * (1 + consistencyBonus + streakBonus) * timeFactor;
    const finalScore = Math.min(100, Math.max(0, rawFinal));

    return {
      rawScore: Math.round(rawScore * 10) / 10,
      difficultyWeight: Math.round(difficultyWeight * 1000) / 1000,
      consistencyBonus,
      streakBonus: Math.round(streakBonus * 1000) / 1000,
      timeFactor,
      finalScore: Math.round(finalScore * 10) / 10,
    };
  }
}
