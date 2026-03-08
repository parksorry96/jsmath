import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class EnrollmentsService {
  constructor(private prisma: PrismaService) {}

  async enroll(classId: string, requesterId: string, requesterRole: string, targetUserId?: string) {
    await this.assertClassExists(classId);

    // Teachers/admins can enroll a specific student; students self-enroll
    const userId = (requesterRole === "teacher" || requesterRole === "admin") && targetUserId
      ? targetUserId
      : requesterId;

    const existing = await this.prisma.enrollment.findUnique({
      where: { userId_classId: { userId, classId } },
    });
    if (existing) throw new ConflictException("Already enrolled");

    return this.prisma.enrollment.create({
      data: { userId, classId },
      include: {
        user: { select: { id: true, name: true, email: true } },
        class: { select: { id: true, title: true } },
      },
    });
  }

  async unenroll(classId: string, requesterId: string, requesterRole: string, targetUserId?: string) {
    await this.assertClassExists(classId);

    const userId = (requesterRole === "teacher" || requesterRole === "admin") && targetUserId
      ? targetUserId
      : requesterId;

    // Students can only unenroll themselves
    if (requesterRole === "student" && userId !== requesterId) {
      throw new ForbiddenException("Cannot unenroll another student");
    }

    const enrollment = await this.prisma.enrollment.findUnique({
      where: { userId_classId: { userId, classId } },
    });
    if (!enrollment) throw new NotFoundException("Enrollment not found");

    await this.prisma.enrollment.delete({
      where: { userId_classId: { userId, classId } },
    });
  }

  async findStudents(classId: string) {
    await this.assertClassExists(classId);
    return this.prisma.enrollment.findMany({
      where: { classId },
      include: {
        user: { select: { id: true, name: true, email: true, role: true } },
      },
      orderBy: { createdAt: "asc" },
    });
  }

  private async assertClassExists(classId: string) {
    const cls = await this.prisma.class.findFirst({
      where: { id: classId, deletedAt: null },
    });
    if (!cls) throw new NotFoundException("Class not found");
    return cls;
  }
}
