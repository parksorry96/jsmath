import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CreateClassDto } from "./dto/create-class.dto";
import { UpdateClassDto } from "./dto/update-class.dto";
import { canAccessClass, getAccessibleClassIds } from "../common/access-control";

@Injectable()
export class ClassesService {
  constructor(private prisma: PrismaService) {}

  private serializeClass<T extends { title: string }>(cls: T) {
    return {
      ...cls,
      name: cls.title,
    };
  }

  async create(dto: CreateClassDto) {
    const created = await this.prisma.class.create({
      data: {
        title: dto.title,
        description: dto.description,
        organizationId: dto.organizationId,
      },
      include: {
        organization: { select: { id: true, name: true } },
      },
    });
    return this.serializeClass(created);
  }

  async findAll(
    organizationId?: string,
    requesterId?: string,
    requesterRole?: string,
  ) {
    const accessibleClassIds =
      requesterId && requesterRole
        ? await getAccessibleClassIds(this.prisma, requesterId, requesterRole)
        : null;

    const classes = await this.prisma.class.findMany({
      where: {
        deletedAt: null,
        ...(organizationId ? { organizationId } : {}),
        ...(accessibleClassIds !== null ? { id: { in: accessibleClassIds } } : {}),
      },
      include: {
        organization: { select: { id: true, name: true } },
        _count: { select: { enrollments: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return classes.map((cls) => this.serializeClass(cls));
  }

  async findById(id: string, requesterId?: string, requesterRole?: string) {
    if (requesterId && requesterRole) {
      const allowed = await canAccessClass(
        this.prisma,
        requesterId,
        requesterRole,
        id,
      );
      if (!allowed) {
        throw new ForbiddenException("Not authorized to access this class");
      }
    }

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
    return this.serializeClass(cls);
  }

  async update(id: string, dto: UpdateClassDto, requesterId: string, requesterRole: string) {
    await this.assertClassExists(id);
    if (requesterRole === "student") {
      throw new ForbiddenException("Students cannot update classes");
    }
    const updated = await this.prisma.class.update({
      where: { id },
      data: dto,
      include: {
        organization: { select: { id: true, name: true } },
      },
    });
    return this.serializeClass(updated);
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
