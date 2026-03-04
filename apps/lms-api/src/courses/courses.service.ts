import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CreateCourseDto } from "./dto/create-course.dto";
import { UpdateCourseDto } from "./dto/update-course.dto";

@Injectable()
export class CoursesService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateCourseDto) {
    return this.prisma.course.create({
      data: {
        title: dto.title,
        description: dto.description,
        organizationId: dto.organizationId,
      },
      include: {
        organization: { select: { id: true, name: true } },
      },
    });
  }

  async findAll(organizationId?: string) {
    return this.prisma.course.findMany({
      where: {
        deletedAt: null,
        ...(organizationId ? { organizationId } : {}),
      },
      include: {
        organization: { select: { id: true, name: true } },
        _count: { select: { enrollments: true } },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async findById(id: string) {
    const course = await this.prisma.course.findFirst({
      where: { id, deletedAt: null },
      include: {
        organization: { select: { id: true, name: true } },
        enrollments: {
          include: {
            user: { select: { id: true, name: true, email: true, role: true } },
          },
        },
        _count: { select: { assignments: true } },
      },
    });
    if (!course) throw new NotFoundException("Course not found");
    return course;
  }

  async update(id: string, dto: UpdateCourseDto, requesterId: string, requesterRole: string) {
    await this.assertCourseExists(id);
    if (requesterRole === "student") {
      throw new ForbiddenException("Students cannot update courses");
    }
    return this.prisma.course.update({
      where: { id },
      data: dto,
      include: {
        organization: { select: { id: true, name: true } },
      },
    });
  }

  async softDelete(id: string, requesterRole: string) {
    await this.assertCourseExists(id);
    if (requesterRole === "student") {
      throw new ForbiddenException("Students cannot delete courses");
    }
    return this.prisma.course.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  private async assertCourseExists(id: string) {
    const course = await this.prisma.course.findFirst({
      where: { id, deletedAt: null },
    });
    if (!course) throw new NotFoundException("Course not found");
    return course;
  }
}
