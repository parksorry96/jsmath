import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CreateSubmissionDto } from "./dto/create-submission.dto";
import { GradeSubmissionDto } from "./dto/grade-submission.dto";

@Injectable()
export class SubmissionsService {
  constructor(private prisma: PrismaService) {}

  async submit(studentId: string, dto: CreateSubmissionDto) {
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

  async findByAssignment(assignmentId: string) {
    return this.prisma.submission.findMany({
      where: { assignmentId },
      include: { student: { select: { id: true, name: true, email: true } } },
      orderBy: { submittedAt: "desc" },
    });
  }

  async findByStudent(studentId: string, classId?: string) {
    return this.prisma.submission.findMany({
      where: {
        studentId,
        ...(classId ? { assignment: { classId } } : {}),
      },
      include: { assignment: { select: { id: true, title: true, classId: true } } },
      orderBy: { submittedAt: "desc" },
    });
  }

  async getDetail(id: string) {
    const submission = await this.prisma.submission.findUnique({
      where: { id },
      include: { answers: true, photos: true, assignment: true },
    });
    if (!submission) throw new NotFoundException("Submission not found");
    return submission;
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
