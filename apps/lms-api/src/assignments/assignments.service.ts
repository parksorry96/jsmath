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

  async create(courseId: string, dto: CreateAssignmentDto) {
    await this.assertCourseExists(courseId);
    return this.prisma.assignment.create({
      data: {
        title: dto.title,
        description: dto.description,
        courseId,
        dueAt: dto.dueAt ? new Date(dto.dueAt) : undefined,
        maxScore: dto.maxScore,
      },
    });
  }

  async findAll(courseId: string) {
    await this.assertCourseExists(courseId);
    return this.prisma.assignment.findMany({
      where: { courseId },
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

  private async assertCourseExists(courseId: string) {
    const course = await this.prisma.course.findFirst({
      where: { id: courseId, deletedAt: null },
    });
    if (!course) throw new NotFoundException("Course not found");
    return course;
  }

  private async assertAssignmentExists(id: string) {
    const assignment = await this.prisma.assignment.findUnique({ where: { id } });
    if (!assignment) throw new NotFoundException("Assignment not found");
    return assignment;
  }
}
