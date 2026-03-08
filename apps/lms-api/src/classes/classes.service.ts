import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CreateClassDto } from "./dto/create-class.dto";
import { UpdateClassDto } from "./dto/update-class.dto";

@Injectable()
export class ClassesService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateClassDto) {
    return this.prisma.class.create({
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
    return this.prisma.class.findMany({
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
    const cls = await this.prisma.class.findFirst({
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
    if (!cls) throw new NotFoundException("Class not found");
    return cls;
  }

  async update(id: string, dto: UpdateClassDto, requesterId: string, requesterRole: string) {
    await this.assertClassExists(id);
    if (requesterRole === "student") {
      throw new ForbiddenException("Students cannot update classes");
    }
    return this.prisma.class.update({
      where: { id },
      data: dto,
      include: {
        organization: { select: { id: true, name: true } },
      },
    });
  }

  async softDelete(id: string, requesterRole: string) {
    await this.assertClassExists(id);
    if (requesterRole === "student") {
      throw new ForbiddenException("Students cannot delete classes");
    }
    return this.prisma.class.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  private async assertClassExists(id: string) {
    const cls = await this.prisma.class.findFirst({
      where: { id, deletedAt: null },
    });
    if (!cls) throw new NotFoundException("Class not found");
    return cls;
  }
}
