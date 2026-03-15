import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { PrismaService } from "../prisma/prisma.service";
import { CreateAssignmentDto } from "./dto/create-assignment.dto";
import { UpdateAssignmentDto } from "./dto/update-assignment.dto";
import {
  canAccessAssignment,
  canAccessClass,
  getAccessibleClassIds,
  getLinkedStudentIds,
  isPrivilegedRole,
} from "../common/access-control";
import { ProblemUsageLogService } from "../problems/problem-usage-log.service";

@Injectable()
export class AssignmentsService {
  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private usageLogService: ProblemUsageLogService,
  ) {}

  private serializeAssignmentListItem(assignment: {
    id: string;
    classId: string;
    title: string;
    description: string | null;
    type: string;
    dueAt: Date | null;
    maxScore: number;
    createdAt: Date;
    class?: { id: string; title: string } | null;
    _count?: { submissions: number };
    submissions?: Array<{ status: string; score: number | null }>;
  }) {
    const latestSubmission = assignment.submissions?.[0];
    return {
      ...assignment,
      dueDate: assignment.dueAt?.toISOString() ?? null,
      className: assignment.class?.title ?? null,
      class: assignment.class
        ? {
            ...assignment.class,
            name: assignment.class.title,
          }
        : assignment.class,
      status: latestSubmission?.status ?? "pending",
      score: latestSubmission?.score ?? null,
    };
  }

  private serializeAssignmentDetail(assignment: {
    id: string;
    classId: string;
    title: string;
    description: string | null;
    type: string;
    dueAt: Date | null;
    maxScore: number;
    createdAt: Date;
    class?: { id: string; title: string; _count?: { enrollments: number } } | null;
    assignmentProblems?: Array<{
      id: string;
      orderIndex: number;
      problem: {
        id: string;
        displayNumber: string | null;
        problemNumber: string | null;
        stemText: string;
        stemLatex: string;
        problemType: string;
        difficulty: number | null;
        choices: Array<{
          label: string;
          contentText: string;
          contentLatex: string;
          position: number;
        }>;
        answerText: string | null;
      };
    }>;
    _count?: { submissions: number };
  }, includeProblemAnswers: boolean) {
    const problems = (assignment.assignmentProblems ?? []).map((ap) => ({
      id: ap.id,
      order: ap.orderIndex,
      problem: {
        ...ap.problem,
        answerText: includeProblemAnswers ? ap.problem.answerText : null,
        choices: ap.problem.choices,
      },
    }));

    return {
      ...assignment,
      dueDate: assignment.dueAt?.toISOString() ?? null,
      className: assignment.class?.title ?? null,
      class: assignment.class
        ? {
            ...assignment.class,
            name: assignment.class.title,
          }
        : assignment.class,
      problems,
    };
  }

  private normalizeDueAt<T extends { dueAt?: string; dueDate?: string }>(dto: T) {
    return dto.dueAt ?? dto.dueDate;
  }

  async create(
    classId: string,
    dto: CreateAssignmentDto,
    requesterId: string,
    requesterRole: string,
  ) {
    const allowed = await canAccessClass(
      this.prisma,
      requesterId,
      requesterRole,
      classId,
    );
    if (!allowed) {
      throw new ForbiddenException("Not authorized to access this class");
    }
    await this.assertClassExists(classId);

    const assignment = await this.prisma.assignment.create({
      data: {
        title: dto.title,
        description: dto.description,
        classId,
        type: dto.type || "text_task",
        dueAt: this.normalizeDueAt(dto)
          ? new Date(this.normalizeDueAt(dto)!)
          : undefined,
        maxScore: dto.maxScore,
        examDocumentId: dto.examDocumentId ?? undefined,
        attachPdf: dto.attachPdf ?? false,
      },
    });

    let usedProblemIds: string[] = [];

    if (dto.type === "problem_set" && dto.problemIds?.length) {
      await this.prisma.assignmentProblem.createMany({
        data: dto.problemIds.map((problemId, index) => ({
          assignmentId: assignment.id,
          problemId,
          orderIndex: index,
        })),
      });
      usedProblemIds = dto.problemIds;
    } else if (dto.examDocumentId && (!dto.problemIds || dto.problemIds.length === 0)) {
      const examDoc = await this.prisma.examDocument.findUnique({
        where: { id: dto.examDocumentId },
        include: { problems: { orderBy: { orderIndex: "asc" } } },
      });
      if (examDoc) {
        await this.prisma.assignmentProblem.createMany({
          data: examDoc.problems.map((p, i) => ({
            assignmentId: assignment.id,
            problemId: p.problemId,
            orderIndex: i,
          })),
        });
        usedProblemIds = examDoc.problems.map((p) => p.problemId);
      }
    }

    if (usedProblemIds.length > 0) {
      await this.usageLogService.logUsage(
        usedProblemIds.map((problemId) => ({
          problemId,
          usageType: "assignment" as const,
          referenceId: assignment.id,
          referenceType: "Assignment",
          classId,
          usedByUserId: requesterId,
        })),
      );
    }

    return this.findByIdInternal(assignment.id);
  }

  async findAll(classId: string, requesterId: string, requesterRole: string) {
    const allowed = await canAccessClass(
      this.prisma,
      requesterId,
      requesterRole,
      classId,
    );
    if (!allowed) {
      throw new ForbiddenException("Not authorized to access this class");
    }

    await this.assertClassExists(classId);
    const visibilityWhere =
      requesterRole === "student"
        ? {
            OR: [
              { targetStudentId: null },
              { targetStudentId: requesterId },
            ],
          }
        : requesterRole === "parent"
          ? {
              OR: [
                { targetStudentId: null },
                {
                  targetStudentId: {
                    in: await getLinkedStudentIds(this.prisma, requesterId),
                  },
                },
              ],
            }
          : undefined;
    const assignments = await this.prisma.assignment.findMany({
      where: {
        classId,
        ...(visibilityWhere ?? {}),
      },
      include: {
        class: { select: { id: true, title: true } },
        targetStudent: { select: { id: true, name: true } },
        _count: { select: { assignmentProblems: true, submissions: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return assignments.map((assignment) =>
      this.serializeAssignmentListItem(assignment),
    );
  }

  async findById(id: string, requesterId: string, requesterRole: string) {
    const allowed = await canAccessAssignment(
      this.prisma,
      requesterId,
      requesterRole,
      id,
    );
    if (!allowed) {
      throw new ForbiddenException("Not authorized to access this assignment");
    }

    return this.findByIdInternal(id, isPrivilegedRole(requesterRole));
  }

  private async findByIdInternal(id: string, includeProblemAnswers = true) {
    const assignment = await this.prisma.assignment.findUnique({
      where: { id },
      include: {
        class: {
          select: {
            id: true,
            title: true,
            _count: { select: { enrollments: true } },
          },
        },
        targetStudent: { select: { id: true, name: true } },
        assignmentProblems: {
          orderBy: { orderIndex: "asc" },
        },
        _count: { select: { submissions: true } },
      },
    });
    if (!assignment) throw new NotFoundException("Assignment not found");

    const problemIds = assignment.assignmentProblems.map((item) => item.problemId);
    const problems = problemIds.length
      ? await this.prisma.problem.findMany({
          where: { id: { in: problemIds } },
          select: {
            id: true,
            displayNumber: true,
            problemNumber: true,
            stemText: true,
            stemLatex: true,
            problemType: true,
            difficulty: true,
            answerText: true,
            choices: {
              select: {
                label: true,
                contentText: true,
                contentLatex: true,
                position: true,
              },
              orderBy: { position: "asc" },
            },
          },
        })
      : [];

    const problemMap = new Map(problems.map((problem) => [problem.id, problem]));

    const detail = {
      ...assignment,
      assignmentProblems: assignment.assignmentProblems
        .map((item) => {
          const problem = problemMap.get(item.problemId);
          if (!problem) {
            return null;
          }

          return {
            id: item.id,
            orderIndex: item.orderIndex,
            problem,
          };
        })
        .filter((item): item is NonNullable<typeof item> => item !== null),
    };

    return this.serializeAssignmentDetail(detail, includeProblemAnswers);
  }

  async findMine(studentId: string) {
    const enrollments = await this.prisma.enrollment.findMany({
      where: { userId: studentId },
      select: { classId: true },
    });

    const classIds = enrollments.map((enrollment) => enrollment.classId);
    if (classIds.length === 0) {
      return [];
    }

    const assignments = await this.prisma.assignment.findMany({
      where: {
        classId: { in: classIds },
        OR: [
          { targetStudentId: null },
          { targetStudentId: studentId },
        ],
      },
      include: {
        class: { select: { id: true, title: true } },
        targetStudent: { select: { id: true, name: true } },
        submissions: {
          where: { studentId },
          orderBy: { submittedAt: "desc" },
          take: 1,
          select: { status: true, score: true },
        },
      },
      orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
    });

    return assignments.map((assignment) =>
      this.serializeAssignmentListItem(assignment),
    );
  }

  async findAcrossClasses(
    requesterId: string,
    requesterRole: string,
    hasPendingOnly = false,
  ) {
    const accessibleClassIds = await getAccessibleClassIds(
      this.prisma,
      requesterId,
      requesterRole,
    );
    const assignments = await this.prisma.assignment.findMany({
      where: hasPendingOnly
        ? {
            ...(accessibleClassIds !== null ? { classId: { in: accessibleClassIds } } : {}),
            submissions: {
              some: { status: "submitted" },
            },
          }
        : (accessibleClassIds !== null ? { classId: { in: accessibleClassIds } } : undefined),
      include: {
        class: { select: { id: true, title: true } },
        targetStudent: { select: { id: true, name: true } },
        submissions: {
          where: { status: "submitted" },
          select: { id: true, status: true, score: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return assignments.map((assignment) => ({
      ...this.serializeAssignmentListItem(assignment),
      pendingCount: assignment.submissions.length,
    }));
  }

  async update(
    id: string,
    dto: UpdateAssignmentDto,
    requesterId: string,
    requesterRole: string,
  ) {
    const allowed = await canAccessAssignment(
      this.prisma,
      requesterId,
      requesterRole,
      id,
    );
    if (!allowed) {
      throw new ForbiddenException("Not authorized to update this assignment");
    }
    await this.assertAssignmentExists(id);
    return this.prisma.assignment.update({
      where: { id },
      data: {
        ...dto,
        dueAt: dto.dueAt ? new Date(dto.dueAt) : undefined,
      },
    });
  }

  async remove(id: string, requesterId: string, requesterRole: string) {
    const allowed = await canAccessAssignment(
      this.prisma,
      requesterId,
      requesterRole,
      id,
    );
    if (!allowed) {
      throw new ForbiddenException("Not authorized to delete this assignment");
    }
    await this.assertAssignmentExists(id);
    await this.prisma.assignment.delete({ where: { id } });
  }

  async returnAll(id: string, requesterId: string, requesterRole: string) {
    const allowed = await canAccessAssignment(
      this.prisma,
      requesterId,
      requesterRole,
      id,
    );
    if (!allowed) {
      throw new ForbiddenException("Not authorized to return this assignment");
    }
    await this.assertAssignmentExists(id);

    const result = await this.prisma.submission.updateMany({
      where: {
        assignmentId: id,
        status: "graded",
      },
      data: {
        status: "returned",
      },
    });

    return { returnedCount: result.count };
  }

  async addProblems(
    assignmentId: string,
    problemIds: string[],
    requesterId: string,
    requesterRole: string,
  ) {
    const allowed = await canAccessAssignment(
      this.prisma,
      requesterId,
      requesterRole,
      assignmentId,
    );
    if (!allowed) {
      throw new ForbiddenException("Not authorized to update this assignment");
    }
    const assignment = await this.assertAssignmentExists(assignmentId);

    const existing = await this.prisma.assignmentProblem.findMany({
      where: { assignmentId },
      orderBy: { orderIndex: "desc" },
      take: 1,
    });
    const startIndex = existing.length > 0 ? existing[0].orderIndex + 1 : 0;

    await this.prisma.assignmentProblem.createMany({
      data: problemIds.map((problemId, i) => ({
        assignmentId,
        problemId,
        orderIndex: startIndex + i,
      })),
      skipDuplicates: true,
    });

    return this.findByIdInternal(assignmentId);
  }

  async removeProblem(
    assignmentId: string,
    problemId: string,
    requesterId: string,
    requesterRole: string,
  ) {
    const allowed = await canAccessAssignment(
      this.prisma,
      requesterId,
      requesterRole,
      assignmentId,
    );
    if (!allowed) {
      throw new ForbiddenException("Not authorized to update this assignment");
    }
    await this.assertAssignmentExists(assignmentId);

    const record = await this.prisma.assignmentProblem.findFirst({
      where: { assignmentId, problemId },
    });
    if (!record) throw new NotFoundException("Problem not found in assignment");

    await this.prisma.assignmentProblem.delete({ where: { id: record.id } });
    return this.findByIdInternal(assignmentId);
  }

  async reorderProblems(
    assignmentId: string,
    problemIds: string[],
    requesterId: string,
    requesterRole: string,
  ) {
    const allowed = await canAccessAssignment(
      this.prisma,
      requesterId,
      requesterRole,
      assignmentId,
    );
    if (!allowed) {
      throw new ForbiddenException("Not authorized to update this assignment");
    }
    await this.assertAssignmentExists(assignmentId);

    await this.prisma.$transaction(
      problemIds.map((problemId, index) =>
        this.prisma.assignmentProblem.updateMany({
          where: { assignmentId, problemId },
          data: { orderIndex: index },
        }),
      ),
    );

    return this.findByIdInternal(assignmentId);
  }

  private async assertClassExists(classId: string) {
    const cls = await this.prisma.class.findFirst({
      where: { id: classId, deletedAt: null },
    });
    if (!cls) throw new NotFoundException("Class not found");
    return cls;
  }

  private async assertAssignmentExists(id: string) {
    const assignment = await this.prisma.assignment.findUnique({
      where: { id },
    });
    if (!assignment) throw new NotFoundException("Assignment not found");
    return assignment;
  }

  async getExamPdf(assignmentId: string, userId: string, userRole: string) {
    const assignment = await this.prisma.assignment.findUnique({
      where: { id: assignmentId },
      include: {
        examDocument: true,
        class: { include: { enrollments: { select: { userId: true } } } },
      },
    });
    if (!assignment) throw new NotFoundException("Assignment not found");

    const isTeacher = isPrivilegedRole(userRole);
    const isEnrolled = assignment.class.enrollments.some((e) => e.userId === userId);
    if (!isTeacher && !isEnrolled) throw new ForbiddenException("Not authorized");

    if (!assignment.attachPdf || !assignment.examDocument?.pdfS3Key) {
      throw new NotFoundException("PDF not available for this assignment");
    }

    const s3 = new S3Client({
      region: this.config.get("AWS_REGION", "ap-northeast-2"),
      ...(this.config.get("AWS_ENDPOINT")
        ? { endpoint: this.config.get("AWS_ENDPOINT"), forcePathStyle: true }
        : {}),
    });
    const command = new GetObjectCommand({
      Bucket: this.config.getOrThrow("S3_BUCKET"),
      Key: assignment.examDocument.pdfS3Key,
    });
    const url = await getSignedUrl(s3, command, { expiresIn: 3600 });
    return { url };
  }
}
