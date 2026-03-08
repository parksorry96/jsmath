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

    if (user.role === "student" && user.id !== studentId) {
      throw new ForbiddenException();
    }

    if (user.role === "parent") {
      const link = await this.prisma.parentStudent.findFirst({
        where: { parentId: user.id, studentId },
      });
      if (!link) throw new ForbiddenException();
    }

    return this.analytics.getStudentReport(studentId, classId);
  }

  @Get("class/:classId")
  @Roles("admin", "teacher")
  classReport(@Param("classId") classId: string) {
    return this.analytics.getClassReport(classId);
  }
}
