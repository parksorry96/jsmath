import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  BadRequestException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import {
  canAccessClass,
  canAccessStudentData,
  getRequesterOrganizationId,
} from "../common/access-control";

@Injectable()
export class EnrollmentsService {
  constructor(private prisma: PrismaService) {}

  async enroll(classId: string, requesterId: string, requesterRole: string, targetUserId?: string) {
    const cls = await this.assertClassExists(classId);

    // Only students can self-enroll; parents cannot enroll
    if (requesterRole === "parent") {
      throw new ForbiddenException("Parents cannot enroll in classes");
    }

    const userId = await this.resolveEnrollmentUserId(
      classId,
      cls.organizationId,
      requesterId,
      requesterRole,
      targetUserId,
    );

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
    const cls = await this.assertClassExists(classId);
    const userId = await this.resolveEnrollmentUserId(
      classId,
      cls.organizationId,
      requesterId,
      requesterRole,
      targetUserId,
    );

    const enrollment = await this.prisma.enrollment.findUnique({
      where: { userId_classId: { userId, classId } },
    });
    if (!enrollment) throw new NotFoundException("Enrollment not found");

    await this.prisma.enrollment.delete({
      where: { userId_classId: { userId, classId } },
    });
  }

  async findStudents(classId: string, requesterId: string, requesterRole: string) {
    await this.assertClassExists(classId);
    const allowed = await canAccessClass(
      this.prisma,
      requesterId,
      requesterRole,
      classId,
    );
    if (!allowed) {
      throw new ForbiddenException("Not authorized to access this class");
    }

    return this.prisma.enrollment.findMany({
      where: {
        classId,
        user: { role: "student" },
      },
      include: {
        user: { select: { id: true, name: true, email: true, role: true } },
      },
      orderBy: { createdAt: "asc" },
    });
  }

  private async resolveEnrollmentUserId(
    classId: string,
    classOrganizationId: string | null,
    requesterId: string,
    requesterRole: string,
    targetUserId?: string,
  ) {
    if (requesterRole === "teacher" || requesterRole === "admin") {
      if (!targetUserId) {
        throw new BadRequestException("userId is required to manage another student's enrollment");
      }

      const [allowedClassAccess, allowedStudentAccess] = await Promise.all([
        canAccessClass(this.prisma, requesterId, requesterRole, classId),
        canAccessStudentData(this.prisma, requesterId, requesterRole, targetUserId),
      ]);

      if (!allowedClassAccess || !allowedStudentAccess) {
        throw new ForbiddenException("Not authorized to manage this enrollment");
      }

      await this.assertStudentUser(targetUserId, classOrganizationId, requesterRole);
      return targetUserId;
    }

    if (targetUserId && targetUserId !== requesterId) {
      throw new ForbiddenException("Cannot manage another student's enrollment");
    }

    await this.assertStudentCanSelfManage(classOrganizationId, requesterId, requesterRole);
    return requesterId;
  }

  private async assertStudentCanSelfManage(
    classOrganizationId: string | null,
    requesterId: string,
    requesterRole: string,
  ) {
    if (requesterRole !== "student") {
      throw new ForbiddenException("Only students can self-manage enrollments");
    }

    await this.assertStudentUser(requesterId, classOrganizationId, requesterRole);

    const requesterOrganizationId = await getRequesterOrganizationId(
      this.prisma,
      requesterId,
    );
    if (requesterOrganizationId !== classOrganizationId) {
      throw new ForbiddenException("Cannot enroll in a class outside your organization");
    }
  }

  private async assertStudentUser(
    userId: string,
    classOrganizationId: string | null,
    requesterRole: string,
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, organizationId: true },
    });

    if (!user || user.role !== "student") {
      throw new NotFoundException("Student not found");
    }

    if (
      requesterRole !== "admin" &&
      user.organizationId !== classOrganizationId
    ) {
      throw new ForbiddenException("Student is not in the same organization as the class");
    }
  }

  private async assertClassExists(classId: string) {
    const cls = await this.prisma.class.findFirst({
      where: { id: classId, deletedAt: null },
      select: { id: true, organizationId: true },
    });
    if (!cls) throw new NotFoundException("Class not found");
    return cls;
  }
}
