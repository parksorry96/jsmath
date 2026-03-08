import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CreateAssignmentDto } from "./dto/create-assignment.dto";
import { UpdateAssignmentDto } from "./dto/update-assignment.dto";
import { canAccessClass, canAccessAssignment } from "../common/access-control";

@Injectable()
export class AssignmentsService {
  constructor(private prisma: PrismaService) {}

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
  }) {
    const problems = (assignment.assignmentProblems ?? []).map((ap) => ({
      id: ap.id,
      order: ap.orderIndex,
      problem: {
        ...ap.problem,
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

  async create(classId: string, dto: CreateAssignmentDto) {
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
      },
    });

    if (dto.type === "problem_set" && dto.problemIds?.length) {
      await this.prisma.assignmentProblem.createMany({
        data: dto.problemIds.map((problemId, index) => ({
          assignmentId: assignment.id,
          problemId,
          orderIndex: index,
        })),
      });
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
    const assignments = await this.prisma.assignment.findMany({
      where: { classId },
      include: {
        class: { select: { id: true, title: true } },
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

    return this.findByIdInternal(id);
  }

  private async findByIdInternal(id: string) {
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

    return this.serializeAssignmentDetail(detail);
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
      where: { classId: { in: classIds } },
      include: {
        class: { select: { id: true, title: true } },
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

  async findAcrossClasses(hasPendingOnly = false) {
    const assignments = await this.prisma.assignment.findMany({
      where: hasPendingOnly
        ? {
            submissions: {
              some: { status: "submitted" },
            },
          }
        : undefined,
      include: {
        class: { select: { id: true, title: true } },
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

  async update(id: string, dto: UpdateAssignmentDto, requesterRole: string) {
    if (requesterRole === "student") {
      throw new ForbiddenException("Students cannot update assignments");
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

  async remove(id: string, requesterRole: string) {
    if (requesterRole === "student") {
      throw new ForbiddenException("Students cannot delete assignments");
    }
    await this.assertAssignmentExists(id);
    await this.prisma.assignment.delete({ where: { id } });
  }

  async returnAll(id: string) {
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

  async addProblems(assignmentId: string, problemIds: string[]) {
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

  async removeProblem(assignmentId: string, problemId: string) {
    await this.assertAssignmentExists(assignmentId);

    const record = await this.prisma.assignmentProblem.findFirst({
      where: { assignmentId, problemId },
    });
    if (!record) throw new NotFoundException("Problem not found in assignment");

    await this.prisma.assignmentProblem.delete({ where: { id: record.id } });
    return this.findByIdInternal(assignmentId);
  }

  async reorderProblems(assignmentId: string, problemIds: string[]) {
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
}
