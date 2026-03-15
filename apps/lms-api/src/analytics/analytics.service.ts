import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class AnalyticsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Lightweight report from pre-aggregated daily stats.
   * Returns activity summary without per-unit breakdown (use getStudentReport for that).
   */
  async getStudentDailySummary(
    studentId: string,
    from?: Date,
    to?: Date,
  ) {
    const where: { studentId: string; statDate?: object } = { studentId };
    if (from || to) {
      where.statDate = {
        ...(from ? { gte: from } : {}),
        ...(to ? { lte: to } : {}),
      };
    }

    const stats = await this.prisma.learningEventDailyStat.findMany({
      where,
      orderBy: { statDate: "asc" },
    });

    const totals = stats.reduce(
      (acc, s) => {
        acc.problemsViewed += s.problemsViewed;
        acc.problemsSolved += s.problemsSolved;
        acc.problemsCorrect += s.problemsCorrect;
        acc.totalDurationMs += Number(s.totalDurationMs);
        acc.sessionCount += s.sessionCount;
        return acc;
      },
      {
        problemsViewed: 0,
        problemsSolved: 0,
        problemsCorrect: 0,
        totalDurationMs: 0,
        sessionCount: 0,
      },
    );

    return {
      studentId,
      days: stats.length,
      ...totals,
      accuracy:
        totals.problemsSolved > 0
          ? Math.round(
              (totals.problemsCorrect / totals.problemsSolved) * 100,
            )
          : 0,
      daily: stats.map((s) => ({
        date: s.statDate,
        problemsViewed: s.problemsViewed,
        problemsSolved: s.problemsSolved,
        problemsCorrect: s.problemsCorrect,
        totalDurationMs: Number(s.totalDurationMs),
        sessionCount: s.sessionCount,
      })),
    };
  }

  async getStudentReport(studentId: string, classId?: string) {
    const submissions = await this.prisma.submission.findMany({
      where: {
        studentId,
        status: { in: ["graded", "returned"] },
        ...(classId ? { assignment: { classId } } : {}),
      },
      include: {
        answers: true,
        assignment: {
          select: {
            id: true,
            title: true,
            classId: true,
            maxScore: true,
            createdAt: true,
          },
        },
        photos: {
          where: { analysisStatus: "completed" },
          select: { aiFeedback: true },
        },
      },
      orderBy: { submittedAt: "asc" },
    });

    // Collect all problemIds from answers
    const problemIds = [
      ...new Set(submissions.flatMap((s) => s.answers.map((a) => a.problemId))),
    ];

    // Fetch problems for unit info (cross-schema via Prisma)
    const problems =
      problemIds.length > 0
        ? await this.prisma.problem.findMany({
            where: { id: { in: problemIds } },
            select: {
              id: true,
              unitMajor: true,
              unitMinor: true,
              subject: true,
              difficulty: true,
            },
          })
        : [];
    const problemMap = new Map(problems.map((p) => [p.id, p]));

    // Accuracy by unit
    const unitStats: Record<string, { correct: number; total: number }> = {};
    for (const sub of submissions) {
      for (const ans of sub.answers) {
        if (ans.isCorrect === null) continue;
        const problem = problemMap.get(ans.problemId);
        const unit = problem?.unitMajor || "미분류";
        if (!unitStats[unit]) unitStats[unit] = { correct: 0, total: 0 };
        unitStats[unit].total++;
        if (ans.isCorrect) unitStats[unit].correct++;
      }
    }

    const accuracyByUnit = Object.entries(unitStats)
      .map(([unit, { correct, total }]) => ({
        unit,
        accuracy: total > 0 ? Math.round((correct / total) * 100) : 0,
        correct,
        total,
      }))
      .sort((a, b) => a.accuracy - b.accuracy);

    // Score trend over time
    const scoreTrend = submissions.map((s) => ({
      date: s.submittedAt,
      score: s.score,
      maxScore: s.maxScore || s.assignment.maxScore,
      assignmentTitle: s.assignment.title,
    }));

    // Weak topics (lowest accuracy, min 3 problems attempted)
    const weakTopics = accuracyByUnit.filter((u) => u.total >= 3).slice(0, 5);

    // Overall stats
    const allAnswers = submissions
      .flatMap((s) => s.answers)
      .filter((a) => a.isCorrect !== null);
    const overallAccuracy =
      allAnswers.length > 0
        ? Math.round(
            (allAnswers.filter((a) => a.isCorrect).length / allAnswers.length) *
              100,
          )
        : 0;

    // Common error types from AI feedback
    const errorTypes: Record<string, number> = {};
    for (const sub of submissions) {
      for (const photo of sub.photos) {
        const feedback = photo.aiFeedback as Record<string, unknown> | null;
        if (feedback?.errorType) {
          const key = String(feedback.errorType);
          errorTypes[key] = (errorTypes[key] || 0) + 1;
        }
      }
    }

    return {
      studentId,
      totalSubmissions: submissions.length,
      overallAccuracy,
      accuracyByUnit,
      scoreTrend,
      weakTopics,
      commonErrors: Object.entries(errorTypes)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([type, count]) => ({ type, count })),
    };
  }

  async getClassReport(classId: string) {
    // Average scores per assignment
    const assignments = await this.prisma.assignment.findMany({
      where: { classId },
      include: {
        submissions: {
          where: { status: { in: ["graded", "returned"] } },
          select: { score: true, studentId: true },
        },
        _count: { select: { submissions: true } },
      },
    });

    const assignmentStats = assignments.map((a) => ({
      id: a.id,
      title: a.title,
      avgScore:
        a.submissions.length > 0
          ? Math.round(
              (a.submissions.reduce((sum, s) => sum + (s.score || 0), 0) /
                a.submissions.length) *
                10,
            ) / 10
          : null,
      submissionCount: a._count.submissions,
      maxScore: a.maxScore,
    }));

    // Student completion rates
    const enrollments = await this.prisma.enrollment.findMany({
      where: {
        classId,
        user: { role: "student" },
      },
      include: { user: { select: { id: true, name: true } } },
    });

    const studentIds = enrollments.map((enrollment) => enrollment.userId);
    const submissions = studentIds.length
      ? await this.prisma.submission.findMany({
          where: {
            studentId: { in: studentIds },
            assignment: { classId },
            status: { in: ["graded", "returned"] },
          },
          select: {
            studentId: true,
            score: true,
          },
        })
      : [];

    const submissionStats = new Map<
      string,
      { completedAssignments: number; totalScore: number; scoredAssignments: number }
    >();

    for (const submission of submissions) {
      const current = submissionStats.get(submission.studentId) ?? {
        completedAssignments: 0,
        totalScore: 0,
        scoredAssignments: 0,
      };

      current.completedAssignments += 1;
      if (submission.score !== null) {
        current.totalScore += submission.score;
        current.scoredAssignments += 1;
      }

      submissionStats.set(submission.studentId, current);
    }

    const studentStats = enrollments.map((enrollment) => {
      const stats = submissionStats.get(enrollment.userId);
      return {
        studentId: enrollment.userId,
        name: enrollment.user.name,
        completedAssignments: stats?.completedAssignments ?? 0,
        avgScore:
          stats && stats.scoredAssignments > 0
            ? Math.round((stats.totalScore / stats.scoredAssignments) * 10) / 10
            : null,
      };
    });

    return {
      classId,
      assignmentStats,
      studentStats: studentStats.sort(
        (a, b) => (b.avgScore || 0) - (a.avgScore || 0),
      ),
    };
  }
}
