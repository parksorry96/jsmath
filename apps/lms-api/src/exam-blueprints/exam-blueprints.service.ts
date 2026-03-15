import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { CreateBlueprintDto } from "./dto/create-blueprint.dto";

@Injectable()
export class ExamBlueprintsService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateBlueprintDto, userId: string) {
    return this.prisma.examBlueprint.create({
      data: {
        title: dto.title,
        description: dto.description,
        creatorId: userId,
        gradeLevel: dto.gradeLevel,
        totalQuestions: dto.totalQuestions,
        totalPoints: dto.totalPoints,
        timeLimitMin: dto.timeLimitMin,
        unitDistribution: dto.unitDistribution as unknown as Prisma.InputJsonValue,
        difficultyDistribution: dto.difficultyDistribution as unknown as Prisma.InputJsonValue,
        typeDistribution: dto.typeDistribution as unknown as Prisma.InputJsonValue,
        excludeRecentDays: dto.excludeRecentDays,
        excludeProblemIds: (dto.excludeProblemIds ?? []) as unknown as Prisma.InputJsonValue,
        isTemplate: dto.isTemplate ?? false,
      },
    });
  }

  async findAll(userId: string, role: string) {
    if (role === "admin") {
      return this.prisma.examBlueprint.findMany({
        orderBy: { createdAt: "desc" },
        include: { _count: { select: { generations: true } } },
      });
    }

    // Teachers see own + templates
    return this.prisma.examBlueprint.findMany({
      where: {
        OR: [{ creatorId: userId }, { isTemplate: true }],
      },
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { generations: true } } },
    });
  }

  async findById(id: string, userId: string, userRole?: string) {
    const bp = await this.prisma.examBlueprint.findUnique({
      where: { id },
      include: {
        generations: { orderBy: { createdAt: "desc" } },
      },
    });
    if (!bp) throw new NotFoundException("Blueprint not found");
    if (userRole !== "admin" && bp.creatorId !== userId && !bp.isTemplate) {
      throw new ForbiddenException("Not authorized to access this blueprint");
    }
    return bp;
  }

  async update(id: string, dto: Partial<CreateBlueprintDto>, userId: string) {
    const bp = await this.prisma.examBlueprint.findUnique({ where: { id } });
    if (!bp) throw new NotFoundException("Blueprint not found");
    if (bp.creatorId !== userId) {
      throw new ForbiddenException("Not the owner of this blueprint");
    }

    return this.prisma.examBlueprint.update({
      where: { id },
      data: {
        title: dto.title,
        description: dto.description,
        gradeLevel: dto.gradeLevel,
        totalQuestions: dto.totalQuestions,
        totalPoints: dto.totalPoints,
        timeLimitMin: dto.timeLimitMin,
        unitDistribution: dto.unitDistribution as unknown as Prisma.InputJsonValue,
        difficultyDistribution: dto.difficultyDistribution as unknown as Prisma.InputJsonValue,
        typeDistribution: dto.typeDistribution as unknown as Prisma.InputJsonValue,
        excludeRecentDays: dto.excludeRecentDays,
        excludeProblemIds: dto.excludeProblemIds as unknown as Prisma.InputJsonValue,
        isTemplate: dto.isTemplate,
      },
    });
  }

  async remove(id: string, userId: string) {
    const bp = await this.prisma.examBlueprint.findUnique({ where: { id } });
    if (!bp) throw new NotFoundException("Blueprint not found");
    if (bp.creatorId !== userId) {
      throw new ForbiddenException("Not the owner of this blueprint");
    }

    // Cascade: generations are deleted via onDelete: Cascade in schema
    await this.prisma.examBlueprint.delete({ where: { id } });
  }
}
