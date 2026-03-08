import {
  Injectable,
  NotFoundException,
  BadRequestException,
  OnModuleDestroy,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../prisma/prisma.service";
import Redis from "ioredis";

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

  async generateInviteCode(studentId: string): Promise<{ code: string; expiresIn: number }> {
    const student = await this.prisma.user.findUnique({ where: { id: studentId } });
    if (!student || student.role !== "student") throw new NotFoundException("Student not found");

    const code = Math.random().toString().slice(2, 8);
    await this.redis.set(`invite:${code}`, studentId, "EX", 86400);

    return { code, expiresIn: 86400 };
  }

  async linkParent(parentId: string, inviteCode: string) {
    const studentId = await this.redis.get(`invite:${inviteCode}`);
    if (!studentId) throw new BadRequestException("Invalid or expired invite code");

    const existing = await this.prisma.parentStudent.findUnique({
      where: { parentId_studentId: { parentId, studentId } },
    });
    if (existing) throw new BadRequestException("Already linked to this student");

    const link = await this.prisma.parentStudent.create({
      data: { parentId, studentId },
      include: { student: { select: { id: true, name: true, email: true } } },
    });

    await this.redis.del(`invite:${inviteCode}`);

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
