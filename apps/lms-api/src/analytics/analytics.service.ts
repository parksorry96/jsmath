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
      select: {
        submittedAt: true,
        score: true,
        maxScore: true,
        assignment: {
          select: {
            title: true,
            maxScore: true,
          },
        },
      },
      orderBy: { submittedAt: "asc" },
    });

    const accuracyByUnit = await this.prisma.$queryRaw<
      Array<{ unit: string; correct: bigint; total: bigint }>
    >`
      SELECT
        COALESCE(p.unit_major, '미분류') AS unit,
        COUNT(*) FILTER (WHERE sa.is_correct = true) AS correct,
        COUNT(*) FILTER (WHERE sa.is_correct IS NOT NULL) AS total
      FROM public.submission_answers sa
      JOIN public.submissions s ON s.id = sa.submission_id
      JOIN public.assignments a ON a.id = s.assignment_id
      LEFT JOIN ocr.problems p ON p.id = sa.problem_id
      WHERE s.student_id = ${studentId}
        AND s.status IN ('graded', 'returned')
        AND (${classId}::text IS NULL OR a.class_id = ${classId})
      GROUP BY COALESCE(p.unit_major, '미분류')
      HAVING COUNT(*) FILTER (WHERE sa.is_correct IS NOT NULL) > 0
      ORDER BY
        CASE
          WHEN COUNT(*) FILTER (WHERE sa.is_correct IS NOT NULL) = 0 THEN 1
          ELSE COUNT(*) FILTER (WHERE sa.is_correct = true)::float
            / COUNT(*) FILTER (WHERE sa.is_correct IS NOT NULL)
        END ASC
    `;

    // Score trend over time
    const scoreTrend = submissions.map((s) => ({
      date: s.submittedAt,
      score: s.score,
      maxScore: s.maxScore || s.assignment.maxScore,
      assignmentTitle: s.assignment.title,
    }));

    // Weak topics (lowest accuracy, min 3 problems attempted)
    const normalizedAccuracyByUnit = accuracyByUnit.map((row) => {
      const correct = Number(row.correct);
      const total = Number(row.total);
      return {
        unit: row.unit,
        accuracy: total > 0 ? Math.round((correct / total) * 100) : 0,
        correct,
        total,
      };
    });
    const weakTopics = normalizedAccuracyByUnit.filter((u) => u.total >= 3).slice(0, 5);
    const totalCorrect = normalizedAccuracyByUnit.reduce((sum, row) => sum + row.correct, 0);
    const totalAnswered = normalizedAccuracyByUnit.reduce((sum, row) => sum + row.total, 0);
    const overallAccuracy =
      totalAnswered > 0 ? Math.round((totalCorrect / totalAnswered) * 100) : 0;

    const commonErrors = await this.prisma.$queryRaw<
      Array<{ type: string; count: bigint }>
    >`
      SELECT
        sp.ai_feedback->>'errorType' AS type,
        COUNT(*) AS count
      FROM public.submission_photos sp
      JOIN public.submissions s ON s.id = sp.submission_id
      JOIN public.assignments a ON a.id = s.assignment_id
      WHERE s.student_id = ${studentId}
        AND s.status IN ('graded', 'returned')
        AND sp.analysis_status = 'completed'
        AND jsonb_typeof(sp.ai_feedback) = 'object'
        AND sp.ai_feedback ? 'errorType'
        AND (${classId}::text IS NULL OR a.class_id = ${classId})
      GROUP BY sp.ai_feedback->>'errorType'
      ORDER BY COUNT(*) DESC
      LIMIT 5
    `;

    return {
      studentId,
      totalSubmissions: submissions.length,
      overallAccuracy,
      accuracyByUnit: normalizedAccuracyByUnit,
      scoreTrend,
      weakTopics,
      commonErrors: commonErrors.map((row) => ({
        type: row.type,
        count: Number(row.count),
      })),
    };
  }

  async getClassReport(classId: string) {
    const [assignmentStats, studentStats] = await Promise.all([
      this.prisma.$queryRaw<
        Array<{
          id: string;
          title: string;
          maxScore: number;
          submissionCount: bigint;
          avgScore: number | null;
        }>
      >`
        SELECT
          a.id,
          a.title,
          a.max_score AS "maxScore",
          COUNT(s.id) FILTER (WHERE s.status IN ('graded', 'returned')) AS "submissionCount",
          ROUND(AVG(s.score)::numeric, 1)::float AS "avgScore"
        FROM public.assignments a
        LEFT JOIN public.submissions s
          ON s.assignment_id = a.id
         AND s.status IN ('graded', 'returned')
        WHERE a.class_id = ${classId}
        GROUP BY a.id, a.title, a.max_score
        ORDER BY a.created_at ASC
      `,
      this.prisma.$queryRaw<
        Array<{
          studentId: string;
          name: string;
          completedAssignments: bigint;
          avgScore: number | null;
        }>
      >`
        SELECT
          e.user_id AS "studentId",
          u.name AS name,
          COUNT(s.id) FILTER (WHERE s.status IN ('graded', 'returned')) AS "completedAssignments",
          ROUND(AVG(s.score)::numeric, 1)::float AS "avgScore"
        FROM public.enrollments e
        JOIN public.users u ON u.id = e.user_id
        LEFT JOIN public.submissions s
          ON s.student_id = e.user_id
         AND s.status IN ('graded', 'returned')
         AND s.assignment_id IN (
           SELECT id FROM public.assignments WHERE class_id = ${classId}
         )
        WHERE e.class_id = ${classId}
          AND e.role = 'student'
        GROUP BY e.user_id, u.name
        ORDER BY "avgScore" DESC NULLS LAST, u.name ASC
      `,
    ]);

    return {
      classId,
      assignmentStats: assignmentStats.map((row) => ({
        id: row.id,
        title: row.title,
        avgScore: row.avgScore,
        submissionCount: Number(row.submissionCount),
        maxScore: row.maxScore,
      })),
      studentStats: studentStats.map((row) => ({
        studentId: row.studentId,
        name: row.name,
        completedAssignments: Number(row.completedAssignments),
        avgScore: row.avgScore,
      })),
    };
  }
}
