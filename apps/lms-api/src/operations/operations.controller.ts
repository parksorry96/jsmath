import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Post,
  Patch,
  Body,
  Param,
  Query,
  Request,
  UseGuards,
} from "@nestjs/common";
import { AttendanceService } from "./attendance.service";
import { BillingService } from "./billing.service";
import { CheckInDto, BulkCheckInDto } from "./dto/check-in.dto";
import {
  CreateBillingDto,
  BulkGenerateBillingDto,
  UpdateBillingStatusDto,
} from "./dto/billing.dto";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";
import { PrismaService } from "../prisma/prisma.service";
import { canAccessClass, canAccessStudentData } from "../common/access-control";

interface AuthRequest {
  user: { id: string; email: string; role: string };
}

@Controller("operations")
@UseGuards(JwtAuthGuard, RolesGuard)
export class OperationsController {
  constructor(
    private attendance: AttendanceService,
    private billing: BillingService,
    private prisma: PrismaService,
  ) {}

  // ─── Attendance ───

  @Post("attendance/check-in")
  @Roles("admin", "teacher")
  async checkIn(@Body() dto: CheckInDto, @Request() req: AuthRequest) {
    await this.assertClassAccess(req, dto.classId);
    await this.assertStudentAccess(req, dto.studentId);
    await this.assertStudentEnrolledInClass(dto.studentId, dto.classId);

    return this.attendance.checkIn(
      dto.studentId,
      dto.classId,
      dto.date,
      dto.status,
      dto.note,
    );
  }

  @Post("attendance/bulk")
  @Roles("admin", "teacher")
  async bulkCheckIn(@Body() dto: BulkCheckInDto, @Request() req: AuthRequest) {
    await this.assertClassAccess(req, dto.classId);
    await this.assertStudentsEnrolledInClass(
      dto.classId,
      dto.records.map((record) => record.studentId),
    );

    return this.attendance.bulkCheckIn(dto.classId, dto.date, dto.records);
  }

  @Get("attendance/class/:classId")
  @Roles("admin", "teacher")
  async getAttendanceByClass(
    @Param("classId") classId: string,
    @Query("month") month: string,
    @Request() req: AuthRequest,
  ) {
    await this.assertClassAccess(req, classId);
    return this.attendance.getByClass(classId, month);
  }

  @Get("attendance/student/:studentId")
  @Roles("admin", "teacher", "student", "parent")
  async getAttendanceByStudent(
    @Param("studentId") studentId: string,
    @Query("month") month: string,
    @Request() req: AuthRequest,
  ) {
    await this.assertStudentAccess(req, studentId);
    return this.attendance.getByStudent(studentId, month);
  }

  @Get("attendance/stats/:classId")
  @Roles("admin", "teacher")
  async getAttendanceStats(
    @Param("classId") classId: string,
    @Query("month") month: string,
    @Request() req: AuthRequest,
  ) {
    await this.assertClassAccess(req, classId);
    return this.attendance.getStats(classId, month);
  }

  // ─── Billing ───

  @Post("billing")
  @Roles("admin", "teacher")
  async createBilling(@Body() dto: CreateBillingDto, @Request() req: AuthRequest) {
    await this.assertStudentAccess(req, dto.studentId);
    if (dto.classId) {
      await this.assertClassAccess(req, dto.classId);
      await this.assertStudentEnrolledInClass(dto.studentId, dto.classId);
    }

    return this.billing.create(dto.studentId, {
      classId: dto.classId,
      type: dto.type,
      amount: dto.amount,
      description: dto.description,
      billingMonth: dto.billingMonth,
    });
  }

  @Post("billing/bulk-generate")
  @Roles("admin", "teacher")
  async bulkGenerateBilling(
    @Body() dto: BulkGenerateBillingDto,
    @Request() req: AuthRequest,
  ) {
    await this.assertClassAccess(req, dto.classId);
    return this.billing.bulkGenerate(
      dto.classId,
      dto.billingMonth,
      dto.type,
      dto.amount,
      dto.description,
    );
  }

  @Get("billing/student/:studentId")
  @Roles("admin", "teacher", "student", "parent")
  async getBillingByStudent(
    @Param("studentId") studentId: string,
    @Query("month") month?: string,
    @Request() req?: AuthRequest,
  ) {
    if (!req) {
      throw new ForbiddenException();
    }
    await this.assertStudentAccess(req, studentId);
    return this.billing.getByStudent(studentId, month);
  }

  @Get("billing/class/:classId")
  @Roles("admin", "teacher")
  async getBillingByClass(
    @Param("classId") classId: string,
    @Query("month") month?: string,
    @Request() req?: AuthRequest,
  ) {
    if (!req) {
      throw new ForbiddenException();
    }
    await this.assertClassAccess(req, classId);
    return this.billing.getByClass(classId, month);
  }

  @Patch("billing/:id/status")
  @Roles("admin", "teacher")
  async updateBillingStatus(
    @Param("id") id: string,
    @Body() dto: UpdateBillingStatusDto,
    @Request() req: AuthRequest,
  ) {
    const record = await this.prisma.billingRecord.findUnique({
      where: { id },
      select: { classId: true, studentId: true },
    });
    if (!record) {
      throw new NotFoundException("Billing record not found");
    }

    if (record.classId) {
      await this.assertClassAccess(req, record.classId);
    } else {
      await this.assertStudentAccess(req, record.studentId);
    }

    return this.billing.updateStatus(id, dto.status, dto.paidAt);
  }

  @Get("billing/statement/:classId")
  @Roles("admin", "teacher")
  async getMonthlyStatement(
    @Param("classId") classId: string,
    @Query("month") month: string,
    @Request() req: AuthRequest,
  ) {
    await this.assertClassAccess(req, classId);
    return this.billing.getMonthlyStatement(classId, month);
  }

  private async assertClassAccess(req: AuthRequest, classId: string) {
    const allowed = await canAccessClass(
      this.prisma,
      req.user.id,
      req.user.role,
      classId,
    );
    if (!allowed) {
      throw new ForbiddenException("Not authorized to access this class");
    }
  }

  private async assertStudentAccess(req: AuthRequest, studentId: string) {
    const allowed = await canAccessStudentData(
      this.prisma,
      req.user.id,
      req.user.role,
      studentId,
    );
    if (!allowed) {
      throw new ForbiddenException("Not authorized to access this student");
    }
  }

  private async assertStudentEnrolledInClass(studentId: string, classId: string) {
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

  private async assertStudentsEnrolledInClass(classId: string, studentIds: string[]) {
    const uniqueStudentIds = [...new Set(studentIds)];
    if (uniqueStudentIds.length === 0) {
      return;
    }

    const enrollments = await this.prisma.enrollment.findMany({
      where: {
        classId,
        userId: { in: uniqueStudentIds },
      },
      select: { userId: true },
    });

    const enrolledIds = new Set(enrollments.map((enrollment) => enrollment.userId));
    const missingStudentId = uniqueStudentIds.find((studentId) => !enrolledIds.has(studentId));
    if (missingStudentId) {
      throw new BadRequestException(
        `Student ${missingStudentId} is not enrolled in this class`,
      );
    }
  }
}
