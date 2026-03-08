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
    return this.prisma.assignment.create({
      data: {
        title: dto.title,
        description: dto.description,
        classId,
        dueAt: dto.dueAt ? new Date(dto.dueAt) : undefined,
        maxScore: dto.maxScore,
        type: dto.type as any,
      },
    });
  }

  async findAll(classId: string) {
    await this.assertClassExists(classId);
    return this.prisma.assignment.findMany({
      where: { classId },
      orderBy: { createdAt: "desc" },
    });
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

  private async assertClassExists(classId: string) {
    const cls = await this.prisma.class.findFirst({
      where: { id: classId, deletedAt: null },
    });
    if (!cls) throw new NotFoundException("Class not found");
    return cls;
  }

  private async assertAssignmentExists(id: string) {
    const assignment = await this.prisma.assignment.findUnique({ where: { id } });
    if (!assignment) throw new NotFoundException("Assignment not found");
    return assignment;
  }
}
