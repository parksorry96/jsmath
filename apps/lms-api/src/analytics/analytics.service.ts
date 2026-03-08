import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class AnalyticsService {
  constructor(private prisma: PrismaService) {}

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
      where: { classId },
      include: { user: { select: { id: true, name: true } } },
    });

    const studentStats = await Promise.all(
      enrollments.map(async (e) => {
        const subs = await this.prisma.submission.findMany({
          where: {
            studentId: e.userId,
            assignment: { classId },
            status: { in: ["graded", "returned"] },
          },
          select: { score: true },
        });
        return {
          studentId: e.userId,
          name: e.user.name,
          completedAssignments: subs.length,
          avgScore:
            subs.length > 0
              ? Math.round(
                  (subs.reduce((s, sub) => s + (sub.score || 0), 0) /
                    subs.length) *
                    10,
                ) / 10
              : null,
        };
      }),
    );

    return {
      classId,
      assignmentStats,
      studentStats: studentStats.sort(
        (a, b) => (b.avgScore || 0) - (a.avgScore || 0),
      ),
    };
  }
}
