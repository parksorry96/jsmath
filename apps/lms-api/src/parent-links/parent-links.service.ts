import {
  Injectable,
  NotFoundException,
  BadRequestException,
  OnModuleDestroy,
  ForbiddenException,
  InternalServerErrorException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../prisma/prisma.service";
import Redis from "ioredis";
import { randomInt } from "crypto";
import { canAccessClass, canAccessStudentData } from "../common/access-control";

const INVITE_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const INVITE_CODE_LENGTH = 8;
const INVITE_CODE_TTL_SECONDS = 86400;

function generateInviteCodeValue(): string {
  return Array.from({ length: INVITE_CODE_LENGTH }, () =>
    INVITE_CODE_ALPHABET[randomInt(0, INVITE_CODE_ALPHABET.length)],
  ).join("");
}

@Injectable()
export class ParentLinksService implements OnModuleDestroy {
  private redis: Redis;

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {
    this.redis = new Redis(this.config.getOrThrow<string>("REDIS_URL"));
  }

  async onModuleDestroy() {
    await this.redis.quit();
  }

  async generateInviteCode(
    studentId: string,
    requesterId: string,
    requesterRole: string,
    classId?: string,
  ): Promise<{ code: string; expiresIn: number }> {
    const student = await this.prisma.user.findUnique({
      where: { id: studentId },
      select: { id: true, role: true },
    });
    if (!student || student.role !== "student") {
      throw new NotFoundException("Student not found");
    }

    if (requesterRole !== "admin") {
      const allowedStudentAccess = await canAccessStudentData(
        this.prisma,
        requesterId,
        requesterRole,
        studentId,
      );
      if (!allowedStudentAccess) {
        throw new ForbiddenException("Not authorized to generate an invite for this student");
      }
    }

    if (classId) {
      const allowedClassAccess = await canAccessClass(
        this.prisma,
        requesterId,
        requesterRole,
        classId,
      );
      if (!allowedClassAccess) {
        throw new ForbiddenException("Not authorized to access this class");
      }

      const enrollment = await this.prisma.enrollment.findUnique({
        where: {
          userId_classId: {
            userId: studentId,
            classId,
          },
        },
        select: { id: true },
      });
      if (!enrollment) {
        throw new BadRequestException("Student is not enrolled in this class");
      }
    }

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = generateInviteCodeValue();
      const created = await this.redis.set(
        `invite:${code}`,
        studentId,
        "EX",
        INVITE_CODE_TTL_SECONDS,
        "NX",
      );

      if (created === "OK") {
        return { code, expiresIn: INVITE_CODE_TTL_SECONDS };
      }
    }

    throw new InternalServerErrorException("Failed to generate invite code");
  }

  async linkParent(parentId: string, inviteCode: string) {
    const normalizedCode = inviteCode.trim().toUpperCase();
    const studentId = await this.redis.get(`invite:${normalizedCode}`);
    if (!studentId) throw new BadRequestException("Invalid or expired invite code");

    const existing = await this.prisma.parentStudent.findUnique({
      where: { parentId_studentId: { parentId, studentId } },
    });
    if (existing) throw new BadRequestException("Already linked to this student");

    const link = await this.prisma.parentStudent.create({
      data: { parentId, studentId },
      include: { student: { select: { id: true, name: true, email: true } } },
    });

    await this.redis.del(`invite:${normalizedCode}`);

    return link;
  }

  async getChildren(parentId: string) {
    return this.prisma.parentStudent.findMany({
      where: { parentId },
      include: {
        student: {
          select: {
            id: true,
            name: true,
            email: true,
            enrollments: {
              include: { class: { select: { id: true, title: true } } },
            },
          },
        },
      },
    });
  }

  async unlink(id: string, requesterId: string) {
    const link = await this.prisma.parentStudent.findUnique({ where: { id } });
    if (!link) throw new NotFoundException("Link not found");
    if (link.parentId !== requesterId) throw new BadRequestException("Not authorized");
    await this.prisma.parentStudent.delete({ where: { id } });
  }
}
