import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  Request,
  ForbiddenException,
} from "@nestjs/common";
import { AnalyticsService } from "./analytics.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";
import { PrismaService } from "../prisma/prisma.service";
import { canAccessClass, canAccessStudentData } from "../common/access-control";

interface AuthRequest {
  user: { id: string; email: string; role: string };
}

@Controller("analytics")
@UseGuards(JwtAuthGuard, RolesGuard)
export class AnalyticsController {
  constructor(
    private analytics: AnalyticsService,
    private prisma: PrismaService,
  ) {}

  @Get("student/:studentId")
  async studentReport(
    @Param("studentId") studentId: string,
    @Query("classId") classId: string | undefined,
    @Request() req: AuthRequest,
  ) {
    const user = req.user;

    const canAccessStudent = await canAccessStudentData(
      this.prisma,
      user.id,
      user.role,
      studentId,
    );
    if (!canAccessStudent) {
      throw new ForbiddenException();
    }

    if (classId) {
      const canAccessTargetClass = await canAccessClass(
        this.prisma,
        user.id,
        user.role,
        classId,
      );
      if (!canAccessTargetClass) {
        throw new ForbiddenException();
      }
    }

    return this.analytics.getStudentReport(studentId, classId);
  }

  @Get("class/:classId")
  @Roles("admin", "teacher")
  async classReport(
    @Param("classId") classId: string,
    @Request() req: AuthRequest,
  ) {
    const allowed = await canAccessClass(
      this.prisma,
      req.user.id,
      req.user.role,
      classId,
    );
    if (!allowed) {
      throw new ForbiddenException();
    }
    return this.analytics.getClassReport(classId);
  }
}
