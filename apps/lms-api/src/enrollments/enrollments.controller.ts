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

@Controller("classes/:classId")
@UseGuards(JwtAuthGuard, RolesGuard)
export class EnrollmentsController {
  constructor(private enrollments: EnrollmentsService) {}

  @Post("enroll")
  enroll(
    @Param("classId") classId: string,
    @Body() dto: EnrollDto,
    @Request() req: AuthRequest,
  ) {
    return this.enrollments.enroll(classId, req.user.id, req.user.role, dto.userId);
  }

  @Delete("enroll")
  @HttpCode(HttpStatus.NO_CONTENT)
  unenroll(
    @Param("classId") classId: string,
    @Body() dto: EnrollDto,
    @Request() req: AuthRequest,
  ) {
    return this.enrollments.unenroll(classId, req.user.id, req.user.role, dto.userId);
  }

  @Get("students")
  @Roles("admin", "teacher")
  findStudents(@Param("classId") classId: string, @Request() req: AuthRequest) {
    return this.enrollments.findStudents(classId, req.user.id, req.user.role);
  }
}
