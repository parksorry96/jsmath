import {
  Controller,
  Post,
  Delete,
  Get,
  Param,
  Body,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { EnrollmentsService } from "./enrollments.service";
import { EnrollDto } from "./dto/enroll.dto";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";

interface AuthRequest {
  user: { id: string; email: string; role: string };
}

@Controller("courses/:courseId")
@UseGuards(JwtAuthGuard, RolesGuard)
export class EnrollmentsController {
  constructor(private enrollments: EnrollmentsService) {}

  @Post("enroll")
  enroll(
    @Param("courseId") courseId: string,
    @Body() dto: EnrollDto,
    @Request() req: AuthRequest,
  ) {
    return this.enrollments.enroll(courseId, req.user.id, req.user.role, dto.userId);
  }

  @Delete("enroll")
  @HttpCode(HttpStatus.NO_CONTENT)
  unenroll(
    @Param("courseId") courseId: string,
    @Body() dto: EnrollDto,
    @Request() req: AuthRequest,
  ) {
    return this.enrollments.unenroll(courseId, req.user.id, req.user.role, dto.userId);
  }

  @Get("students")
  @Roles("admin", "teacher")
  findStudents(@Param("courseId") courseId: string) {
    return this.enrollments.findStudents(courseId);
  }
}
