import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CreateAssignmentDto } from "./dto/create-assignment.dto";
import { UpdateAssignmentDto } from "./dto/update-assignment.dto";

@Injectable()
export class AssignmentsService {
  constructor(private prisma: PrismaService) {}

  async create(classId: string, dto: CreateAssignmentDto) {
    await this.assertClassExists(classId);

    const assignment = await this.prisma.assignment.create({
      data: {
        title: dto.title,
        description: dto.description,
        classId,
        type: dto.type || "text_task",
        dueAt: dto.dueAt ? new Date(dto.dueAt) : undefined,
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

    return this.findById(assignment.id);
  }

  async findAll(classId: string) {
    await this.assertClassExists(classId);
    return this.prisma.assignment.findMany({
      where: { classId },
      include: {
        _count: { select: { assignmentProblems: true, submissions: true } },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async findById(id: string) {
    const assignment = await this.prisma.assignment.findUnique({
      where: { id },
      include: {
        assignmentProblems: {
          orderBy: { orderIndex: "asc" },
        },
        _count: { select: { submissions: true } },
      },
    });
    if (!assignment) throw new NotFoundException("Assignment not found");
    return assignment;
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

    return this.findById(assignmentId);
  }

  async removeProblem(assignmentId: string, problemId: string) {
    await this.assertAssignmentExists(assignmentId);

    const record = await this.prisma.assignmentProblem.findFirst({
      where: { assignmentId, problemId },
    });
    if (!record) throw new NotFoundException("Problem not found in assignment");

    await this.prisma.assignmentProblem.delete({ where: { id: record.id } });
    return this.findById(assignmentId);
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

    return this.findById(assignmentId);
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
