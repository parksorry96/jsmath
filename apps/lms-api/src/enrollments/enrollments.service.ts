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

  async enroll(courseId: string, requesterId: string, requesterRole: string, targetUserId?: string) {
    await this.assertCourseExists(courseId);

    // Teachers/admins can enroll a specific student; students self-enroll
    const userId = (requesterRole === "teacher" || requesterRole === "admin") && targetUserId
      ? targetUserId
      : requesterId;

    const existing = await this.prisma.enrollment.findUnique({
      where: { userId_courseId: { userId, courseId } },
    });
    if (existing) throw new ConflictException("Already enrolled");

    return this.prisma.enrollment.create({
      data: { userId, courseId },
      include: {
        user: { select: { id: true, name: true, email: true } },
        course: { select: { id: true, title: true } },
      },
    });
  }

  async unenroll(courseId: string, requesterId: string, requesterRole: string, targetUserId?: string) {
    await this.assertCourseExists(courseId);

    const userId = (requesterRole === "teacher" || requesterRole === "admin") && targetUserId
      ? targetUserId
      : requesterId;

    // Students can only unenroll themselves
    if (requesterRole === "student" && userId !== requesterId) {
      throw new ForbiddenException("Cannot unenroll another student");
    }

    const enrollment = await this.prisma.enrollment.findUnique({
      where: { userId_courseId: { userId, courseId } },
    });
    if (!enrollment) throw new NotFoundException("Enrollment not found");

    await this.prisma.enrollment.delete({
      where: { userId_courseId: { userId, courseId } },
    });
  }

  async findStudents(courseId: string) {
    await this.assertCourseExists(courseId);
    return this.prisma.enrollment.findMany({
      where: { courseId },
      include: {
        user: { select: { id: true, name: true, email: true, role: true } },
      },
      orderBy: { createdAt: "asc" },
    });
  }

  private async assertCourseExists(courseId: string) {
    const course = await this.prisma.course.findFirst({
      where: { id: courseId, deletedAt: null },
    });
    if (!course) throw new NotFoundException("Course not found");
    return course;
  }
}
