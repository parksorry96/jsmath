import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import {
  ACHIEVEMENT_DEFINITIONS,
  ACHIEVEMENT_MAP,
} from "./achievement-definitions";

@Injectable()
export class GamificationService {
  private readonly logger = new Logger(GamificationService.name);

  constructor(private prisma: PrismaService) {}

  /** Award XP and check for level-up. Returns updated user xp/level. */
  async awardXp(studentId: string, amount: number, _reason: string) {
    const user = await this.prisma.user.update({
      where: { id: studentId },
      data: { xp: { increment: amount } },
      select: { xp: true, level: true },
    });

    const newLevel = Math.floor(user.xp / 100) + 1;
    if (newLevel !== user.level) {
      await this.prisma.user.update({
        where: { id: studentId },
        data: { level: newLevel },
      });
      return { xp: user.xp, level: newLevel, leveledUp: true };
    }

    return { xp: user.xp, level: user.level, leveledUp: false };
  }

  /** Update daily streak. Returns current streak value. */
  async updateStreak(studentId: string, streakType: string) {
    const existing = await this.prisma.studentStreak.findUnique({
      where: { studentId_streakType: { studentId, streakType } },
    });

    const now = new Date();
    const todayStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );
    const yesterdayStart = new Date(todayStart);
    yesterdayStart.setDate(yesterdayStart.getDate() - 1);

    if (!existing) {
      return this.prisma.studentStreak.create({
        data: {
          studentId,
          streakType,
          currentStreak: 1,
          longestStreak: 1,
          lastActivityAt: now,
        },
      });
    }

    const lastActivity = existing.lastActivityAt;
    if (lastActivity && lastActivity >= todayStart) {
      // Already recorded today — skip
      return existing;
    }

    let newStreak: number;
    if (lastActivity && lastActivity >= yesterdayStart) {
      // Yesterday — increment
      newStreak = existing.currentStreak + 1;
    } else {
      // Gap — reset
      newStreak = 1;
    }

    const newLongest = Math.max(existing.longestStreak, newStreak);

    return this.prisma.studentStreak.update({
      where: { id: existing.id },
      data: {
        currentStreak: newStreak,
        longestStreak: newLongest,
        lastActivityAt: now,
      },
    });
  }

  /** Check all achievement conditions and award any newly earned ones. */
  async checkAndAwardAchievements(studentId: string) {
    const earned = await this.prisma.studentAchievement.findMany({
      where: { studentId },
      select: { achievementKey: true },
    });
    const earnedKeys = new Set(earned.map((a) => a.achievementKey));

    const toAward: string[] = [];

    // Total problems solved (answers with isCorrect != null)
    const totalAnswered = await this.prisma.submissionAnswer.count({
      where: {
        submission: { studentId },
        isCorrect: { not: null },
      },
    });

    // first_solve
    if (!earnedKeys.has("first_solve") && totalAnswered >= 1) {
      toAward.push("first_solve");
    }

    // problem milestones
    if (!earnedKeys.has("problem_50") && totalAnswered >= 50) {
      toAward.push("problem_50");
    }
    if (!earnedKeys.has("problem_100") && totalAnswered >= 100) {
      toAward.push("problem_100");
    }
    if (!earnedKeys.has("problem_500") && totalAnswered >= 500) {
      toAward.push("problem_500");
    }

    // Streak achievements
    const solveStreak = await this.prisma.studentStreak.findUnique({
      where: {
        studentId_streakType: { studentId, streakType: "daily_solve" },
      },
    });
    const currentStreak = solveStreak?.currentStreak ?? 0;

    for (const threshold of [3, 7, 14, 30]) {
      const key = `streak_${threshold}`;
      if (!earnedKeys.has(key) && currentStreak >= threshold) {
        toAward.push(key);
      }
    }

    // mastery_first
    if (!earnedKeys.has("mastery_first")) {
      const masteredCount = await this.prisma.studentMastery.count({
        where: { studentId, state: "mastered" },
      });
      if (masteredCount >= 1) {
        toAward.push("mastery_first");
      }
    }

    // perfect_score
    if (!earnedKeys.has("perfect_score")) {
      const perfectSubmission = await this.prisma.submission.findFirst({
        where: {
          studentId,
          status: "graded",
          score: { not: null },
        },
        select: { score: true, maxScore: true },
      });
      if (
        perfectSubmission?.score !== null &&
        perfectSubmission?.score !== undefined &&
        perfectSubmission?.maxScore !== null &&
        perfectSubmission?.maxScore !== undefined &&
        perfectSubmission.maxScore > 0 &&
        perfectSubmission.score >= perfectSubmission.maxScore
      ) {
        toAward.push("perfect_score");
      }
    }

    // Batch create
    if (toAward.length > 0) {
      await this.prisma.studentAchievement.createMany({
        data: toAward.map((key) => ({
          studentId,
          achievementKey: key,
        })),
        skipDuplicates: true,
      });
      this.logger.log(
        `Awarded achievements to ${studentId}: ${toAward.join(", ")}`,
      );
    }

    return toAward;
  }

  /** Get full student gamification profile. */
  async getStudentProfile(studentId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: studentId },
      select: { id: true, name: true, xp: true, level: true },
    });

    const streaks = await this.prisma.studentStreak.findMany({
      where: { studentId },
    });

    const achievements = await this.prisma.studentAchievement.findMany({
      where: { studentId },
      orderBy: { earnedAt: "desc" },
    });

    // Rank: count users with higher xp + 1
    const higherXpCount = await this.prisma.user.count({
      where: { role: "student", xp: { gt: user.xp } },
    });

    return {
      id: user.id,
      name: user.name,
      xp: user.xp,
      level: user.level,
      xpToNextLevel: (user.level) * 100 - user.xp,
      xpProgress: user.xp % 100,
      streaks: streaks.map((s) => ({
        type: s.streakType,
        current: s.currentStreak,
        longest: s.longestStreak,
        lastActivityAt: s.lastActivityAt,
      })),
      achievements: achievements.map((a) => ({
        key: a.achievementKey,
        earnedAt: a.earnedAt,
        ...ACHIEVEMENT_MAP.get(a.achievementKey),
      })),
      rank: higherXpCount + 1,
    };
  }

  /** Get all achievement definitions with earned status for a student. */
  async getAllAchievements(studentId: string) {
    const earned = await this.prisma.studentAchievement.findMany({
      where: { studentId },
      select: { achievementKey: true, earnedAt: true },
    });
    const earnedMap = new Map(
      earned.map((a) => [a.achievementKey, a.earnedAt]),
    );

    return ACHIEVEMENT_DEFINITIONS.map((def) => ({
      ...def,
      earned: earnedMap.has(def.key),
      earnedAt: earnedMap.get(def.key) ?? null,
    }));
  }

  /** Leaderboard: top students by xp. Optionally filter by classId. */
  async getLeaderboard(classId?: string, limit = 20) {
    const where = classId
      ? {
          role: "student" as const,
          enrollments: { some: { classId } },
        }
      : { role: "student" as const };

    const students = await this.prisma.user.findMany({
      where,
      select: { id: true, name: true, xp: true, level: true },
      orderBy: { xp: "desc" },
      take: limit,
    });

    return students.map((s, i) => ({
      rank: i + 1,
      id: s.id,
      name: s.name,
      xp: s.xp,
      level: s.level,
    }));
  }
}
