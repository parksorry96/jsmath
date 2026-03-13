import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

export interface StudentProgress {
  studentId: string;
  name: string;
  submittedCount: number;
  totalProblems: number;
  score: number | null;
  status: "not_started" | "in_progress" | "completed";
  lastActivityAt: string | null;
}

export interface ClassMonitorStatus {
  classId: string;
  classTitle: string;
  assignment: {
    id: string;
    title: string;
    totalProblems: number;
    dueAt: string | null;
  } | null;
  students: StudentProgress[];
  alerts: StudentProgress[];
}

const STUCK_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

@Injectable()
export class ClassMonitorService {
  constructor(private prisma: PrismaService) {}

  async getStatus(
    classId: string,
    assignmentId?: string,
  ): Promise<ClassMonitorStatus> {
    const cls = await this.prisma.class.findFirst({
      where: { id: classId, deletedAt: null },
      select: { id: true, title: true },
    });
    if (!cls) throw new NotFoundException("Class not found");

    const assignment = await this.resolveAssignment(classId, assignmentId);

    if (!assignment) {
      return {
        classId: cls.id,
        classTitle: cls.title,
        assignment: null,
        students: [],
        alerts: [],
      };
    }

    const students = await this.getStudentProgress(classId, assignment.id, assignment.totalProblems);
    const alerts = this.findAlerts(students);

    return {
      classId: cls.id,
      classTitle: cls.title,
      assignment: {
        id: assignment.id,
        title: assignment.title,
        totalProblems: assignment.totalProblems,
        dueAt: assignment.dueAt?.toISOString() ?? null,
      },
      students,
      alerts,
    };
  }

  async getClassAssignments(classId: string) {
    return this.prisma.assignment.findMany({
      where: { classId },
      select: { id: true, title: true, dueAt: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });
  }

  private async resolveAssignment(classId: string, assignmentId?: string) {
    if (assignmentId) {
      const assignment = await this.prisma.assignment.findFirst({
        where: { id: assignmentId, classId },
        select: {
          id: true,
          title: true,
          dueAt: true,
          _count: { select: { assignmentProblems: true } },
        },
      });
      if (!assignment) return null;
      return {
        id: assignment.id,
        title: assignment.title,
        dueAt: assignment.dueAt,
        totalProblems: assignment._count.assignmentProblems,
      };
    }

    // Get the most recent assignment with a due date in the future or most recent overall
    const active = await this.prisma.assignment.findFirst({
      where: {
        classId,
        dueAt: { gte: new Date() },
      },
      orderBy: { dueAt: "asc" },
      select: {
        id: true,
        title: true,
        dueAt: true,
        _count: { select: { assignmentProblems: true } },
      },
    });

    if (active) {
      return {
        id: active.id,
        title: active.title,
        dueAt: active.dueAt,
        totalProblems: active._count.assignmentProblems,
      };
    }

    // Fallback to most recent assignment
    const latest = await this.prisma.assignment.findFirst({
      where: { classId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        title: true,
        dueAt: true,
        _count: { select: { assignmentProblems: true } },
      },
    });

    if (!latest) return null;

    return {
      id: latest.id,
      title: latest.title,
      dueAt: latest.dueAt,
      totalProblems: latest._count.assignmentProblems,
    };
  }

  private async getStudentProgress(
    classId: string,
    assignmentId: string,
    totalProblems: number,
  ): Promise<StudentProgress[]> {
    const enrollments = await this.prisma.enrollment.findMany({
      where: {
        classId,
        user: { role: "student" },
      },
      include: {
        user: { select: { id: true, name: true } },
      },
    });

    const submissions = await this.prisma.submission.findMany({
      where: {
        assignmentId,
        studentId: { in: enrollments.map((e) => e.user.id) },
      },
      include: {
        answers: { select: { id: true } },
      },
    });

    const submissionMap = new Map(
      submissions.map((s) => [s.studentId, s]),
    );

    return enrollments.map((enrollment) => {
      const submission = submissionMap.get(enrollment.user.id);

      if (!submission) {
        return {
          studentId: enrollment.user.id,
          name: enrollment.user.name,
          submittedCount: 0,
          totalProblems,
          score: null,
          status: "not_started" as const,
          lastActivityAt: null,
        };
      }

      const submittedCount = submission.answers.length;
      const isCompleted =
        submission.status === "graded" || submission.status === "returned";

      return {
        studentId: enrollment.user.id,
        name: enrollment.user.name,
        submittedCount,
        totalProblems,
        score: submission.score,
        status: isCompleted
          ? ("completed" as const)
          : ("in_progress" as const),
        lastActivityAt: submission.updatedAt.toISOString(),
      };
    });
  }

  private findAlerts(students: StudentProgress[]): StudentProgress[] {
    const now = Date.now();
    return students.filter((s) => {
      if (s.status === "completed" || s.status === "not_started") return false;
      if (!s.lastActivityAt) return false;
      const elapsed = now - new Date(s.lastActivityAt).getTime();
      return elapsed > STUCK_THRESHOLD_MS;
    });
  }
}
