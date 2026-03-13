import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
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

@Controller("operations")
@UseGuards(JwtAuthGuard, RolesGuard)
export class OperationsController {
  constructor(
    private attendance: AttendanceService,
    private billing: BillingService,
  ) {}

  // ─── Attendance ───

  @Post("attendance/check-in")
  @Roles("admin", "teacher")
  checkIn(@Body() dto: CheckInDto) {
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
  bulkCheckIn(@Body() dto: BulkCheckInDto) {
    return this.attendance.bulkCheckIn(dto.classId, dto.date, dto.records);
  }

  @Get("attendance/class/:classId")
  @Roles("admin", "teacher")
  getAttendanceByClass(
    @Param("classId") classId: string,
    @Query("month") month: string,
  ) {
    return this.attendance.getByClass(classId, month);
  }

  @Get("attendance/student/:studentId")
  @Roles("admin", "teacher", "student", "parent")
  getAttendanceByStudent(
    @Param("studentId") studentId: string,
    @Query("month") month: string,
  ) {
    return this.attendance.getByStudent(studentId, month);
  }

  @Get("attendance/stats/:classId")
  @Roles("admin", "teacher")
  getAttendanceStats(
    @Param("classId") classId: string,
    @Query("month") month: string,
  ) {
    return this.attendance.getStats(classId, month);
  }

  // ─── Billing ───

  @Post("billing")
  @Roles("admin", "teacher")
  createBilling(@Body() dto: CreateBillingDto) {
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
  bulkGenerateBilling(@Body() dto: BulkGenerateBillingDto) {
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
  getBillingByStudent(
    @Param("studentId") studentId: string,
    @Query("month") month?: string,
  ) {
    return this.billing.getByStudent(studentId, month);
  }

  @Get("billing/class/:classId")
  @Roles("admin", "teacher")
  getBillingByClass(
    @Param("classId") classId: string,
    @Query("month") month?: string,
  ) {
    return this.billing.getByClass(classId, month);
  }

  @Patch("billing/:id/status")
  @Roles("admin", "teacher")
  updateBillingStatus(
    @Param("id") id: string,
    @Body() dto: UpdateBillingStatusDto,
  ) {
    return this.billing.updateStatus(id, dto.status, dto.paidAt);
  }

  @Get("billing/statement/:classId")
  @Roles("admin", "teacher")
  getMonthlyStatement(
    @Param("classId") classId: string,
    @Query("month") month: string,
  ) {
    return this.billing.getMonthlyStatement(classId, month);
  }
}
