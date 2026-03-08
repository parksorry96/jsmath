import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from "@nestjs/common";
import { SubmissionStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { CreateSubmissionDto } from "./dto/create-submission.dto";
import { GradeSubmissionDto } from "./dto/grade-submission.dto";
import {
  canAccessAssignment,
  canAccessStudentData,
  canAccessSubmission,
  getLinkedStudentIds,
  isPrivilegedRole,
} from "../common/access-control";

@Injectable()
export class SubmissionsService {
  constructor(private prisma: PrismaService) {}

  private normalizeStatus(status?: string): SubmissionStatus | undefined {
    if (
      status === "submitted" ||
      status === "grading" ||
      status === "graded" ||
      status === "returned"
    ) {
      return status;
    }

    return undefined;
  }

  private serializeSubmission(submission: any) {
    return {
      ...submission,
      answers: submission.answers?.map((answer: { studentAnswer?: string | null } & Record<string, unknown>) => ({
        ...answer,
        answer: answer.studentAnswer,
      })),
    };
  }

  async submit(studentId: string, dto: CreateSubmissionDto) {
    const allowed = await canAccessAssignment(
      this.prisma,
      studentId,
      "student",
      dto.assignmentId,
    );
    if (!allowed) {
      throw new ForbiddenException("Not authorized to submit this assignment");
    }

    const assignment = await this.prisma.assignment.findUnique({
      where: { id: dto.assignmentId },
    });
    if (!assignment) throw new NotFoundException("Assignment not found");

    const submission = await this.prisma.submission.create({
      data: {
        assignmentId: dto.assignmentId,
        studentId,
        type: dto.type,
        maxScore: assignment.maxScore,
        answers:
          dto.type === "online" && dto.answers?.length
            ? {
                create: dto.answers.map((a) => ({
                  problemId: a.problemId,
                  studentAnswer: a.studentAnswer,
                })),
              }
            : undefined,
      },
      include: { answers: true },
    });

    if (dto.type === "online" && submission.answers.length > 0) {
      return this.autoGrade(submission.id);
    }

    return submission;
  }

  async autoGrade(submissionId: string) {
    const submission = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      include: { answers: true, assignment: true },
    });
    if (!submission) throw new NotFoundException("Submission not found");

    let correctCount = 0;
    const totalCount = submission.answers.length;

    for (const answer of submission.answers) {
      const problem = await this.prisma.problem.findUnique({
        where: { id: answer.problemId },
      });
      if (!problem || !problem.answerText) continue;

      let isCorrect = false;

      if (problem.problemType === "multiple_choice") {
        isCorrect = answer.studentAnswer === problem.answerText;
      } else if (problem.problemType === "short_answer") {
        const normalize = (s: string) =>
          s.trim().toLowerCase().replace(/\s+/g, "");
        isCorrect =
          normalize(answer.studentAnswer ?? "") ===
          normalize(problem.answerText);
      }
      // written_solution / essay: skip auto-grading

      if (isCorrect) correctCount++;

      await this.prisma.submissionAnswer.update({
        where: { id: answer.id },
        data: { isCorrect },
      });
    }

    const score =
      totalCount > 0
        ? (correctCount / totalCount) * (submission.maxScore ?? 100)
        : 0;

    return this.prisma.submission.update({
      where: { id: submissionId },
      data: {
        score,
        status: "graded",
        gradedAt: new Date(),
      },
      include: { answers: true },
    });
  }

  async findByAssignment(
    assignmentId: string,
    requesterId: string,
    requesterRole: string,
    status?: string,
  ) {
    const allowed = await canAccessAssignment(
      this.prisma,
      requesterId,
      requesterRole,
      assignmentId,
    );
    if (!allowed) {
      throw new ForbiddenException("Not authorized to access this assignment");
    }

    const normalizedStatus = this.normalizeStatus(status);

    const items = await this.prisma.submission.findMany({
      where: {
        assignmentId,
        ...(normalizedStatus ? { status: normalizedStatus } : {}),
        ...(!isPrivilegedRole(requesterRole) && requesterRole === "student"
          ? { studentId: requesterId }
          : {}),
        ...(!isPrivilegedRole(requesterRole) && requesterRole === "parent"
          ? {
              studentId: {
                in: await getLinkedStudentIds(this.prisma, requesterId),
              },
            }
          : {}),
      },
      include: {
        student: { select: { id: true, name: true, email: true } },
        assignment: { select: { id: true, title: true, classId: true } },
        answers: true,
        photos: true,
      },
      orderBy: { submittedAt: "desc" },
    });

    return items.map((item) => this.serializeSubmission(item));
  }

  async findByStudent(
    studentId: string,
    requesterId: string,
    requesterRole: string,
    classId?: string,
    status?: string,
    limit?: number,
  ) {
    const allowed = await canAccessStudentData(
      this.prisma,
      requesterId,
      requesterRole,
      studentId,
    );
    if (!allowed) {
      throw new ForbiddenException("Not authorized to access this student");
    }

    const normalizedStatus = this.normalizeStatus(status);

    const items = await this.prisma.submission.findMany({
      where: {
        studentId,
        ...(classId ? { assignment: { classId } } : {}),
        ...(normalizedStatus ? { status: normalizedStatus } : {}),
      },
      include: {
        assignment: {
          select: { id: true, title: true, classId: true, dueAt: true },
        },
        answers: true,
        photos: true,
      },
      orderBy: { submittedAt: "desc" },
      ...(limit ? { take: limit } : {}),
    });

    return items.map((item) => this.serializeSubmission(item));
  }

  async findVisibleToRequester(
    requesterId: string,
    requesterRole: string,
    classId?: string,
    status?: string,
    limit?: number,
  ) {
    if (requesterRole === "student") {
      return this.findByStudent(
        requesterId,
        requesterId,
        requesterRole,
        classId,
        status,
        limit,
      );
    }

    if (requesterRole === "parent") {
      const linkedStudents = await getLinkedStudentIds(this.prisma, requesterId);
      if (linkedStudents.length === 0) {
        return [];
      }

      const normalizedStatus = this.normalizeStatus(status);
      const items = await this.prisma.submission.findMany({
        where: {
          studentId: { in: linkedStudents },
          ...(classId ? { assignment: { classId } } : {}),
          ...(normalizedStatus ? { status: normalizedStatus } : {}),
        },
        include: {
          student: { select: { id: true, name: true, email: true } },
          assignment: {
            select: { id: true, title: true, classId: true, dueAt: true },
          },
          answers: true,
          photos: true,
        },
        orderBy: { submittedAt: "desc" },
        ...(limit ? { take: limit } : {}),
      });

      return items.map((item) => this.serializeSubmission(item));
    }

    const normalizedStatus = this.normalizeStatus(status);
    const items = await this.prisma.submission.findMany({
      where: {
        ...(classId ? { assignment: { classId } } : {}),
        ...(normalizedStatus ? { status: normalizedStatus } : {}),
      },
      include: {
        student: { select: { id: true, name: true, email: true } },
        assignment: {
          select: { id: true, title: true, classId: true, dueAt: true },
        },
        answers: true,
        photos: true,
      },
      orderBy: { submittedAt: "desc" },
      ...(limit ? { take: limit } : {}),
    });

    return items.map((item) => this.serializeSubmission(item));
  }

  async getDetail(id: string, requesterId: string, requesterRole: string) {
    const allowed = await canAccessSubmission(
      this.prisma,
      requesterId,
      requesterRole,
      id,
    );
    if (!allowed) {
      throw new ForbiddenException("Not authorized to access this submission");
    }

    const submission = await this.prisma.submission.findUnique({
      where: { id },
      include: { answers: true, photos: true, assignment: true },
    });
    if (!submission) throw new NotFoundException("Submission not found");
    return this.serializeSubmission(submission);
  }

  async grade(id: string, dto: GradeSubmissionDto, graderId: string) {
    const submission = await this.prisma.submission.findUnique({
      where: { id },
    });
    if (!submission) throw new NotFoundException("Submission not found");

    if (dto.answers?.length) {
      for (const ans of dto.answers) {
        await this.prisma.submissionAnswer.update({
          where: {
            submissionId_problemId: {
              submissionId: id,
              problemId: ans.problemId,
            },
          },
          data: {
            score: ans.score,
            feedback: ans.feedback,
            isCorrect: ans.isCorrect,
          },
        });
      }
    }

    return this.prisma.submission.update({
      where: { id },
      data: {
        score: dto.score,
        feedback: dto.feedback,
        status: "graded",
        gradedAt: new Date(),
        gradedBy: graderId,
      },
      include: { answers: true },
    });
  }

  async returnSubmission(id: string) {
    const submission = await this.prisma.submission.findUnique({
      where: { id },
    });
    if (!submission) throw new NotFoundException("Submission not found");

    return this.prisma.submission.update({
      where: { id },
      data: { status: "returned" },
    });
  }
}
