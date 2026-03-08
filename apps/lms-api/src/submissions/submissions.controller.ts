import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
} from "@nestjs/common";
import { SubmissionsService } from "./submissions.service";
import { CreateSubmissionDto } from "./dto/create-submission.dto";
import { GradeSubmissionDto } from "./dto/grade-submission.dto";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";

interface AuthRequest {
  user: { id: string; email: string; role: string };
}

@Controller("submissions")
@UseGuards(JwtAuthGuard, RolesGuard)
export class SubmissionsController {
  constructor(private submissions: SubmissionsService) {}

  @Post()
  @Roles("student")
  submit(@Body() dto: CreateSubmissionDto, @Request() req: AuthRequest) {
    return this.submissions.submit(req.user.id, dto);
  }

  @Get()
  findAll(
    @Query("assignmentId") assignmentId?: string,
    @Query("studentId") studentId?: string,
    @Query("classId") classId?: string,
    @Query("status") status?: string,
    @Query("limit") limit?: string,
    @Request() req?: AuthRequest,
  ) {
    if (!req) {
      return [];
    }

    if (assignmentId) {
      return this.submissions.findByAssignment(
        assignmentId,
        req.user.id,
        req.user.role,
        status,
      );
    }

    const normalizedStudentId =
      studentId === "me" ? req.user.id : studentId;

    if (normalizedStudentId) {
      return this.submissions.findByStudent(
        normalizedStudentId,
        req.user.id,
        req.user.role,
        classId,
        status,
        limit ? parseInt(limit, 10) : undefined,
      );
    }

    return this.submissions.findVisibleToRequester(
      req.user.id,
      req.user.role,
      classId,
      status,
      limit ? parseInt(limit, 10) : undefined,
    );
  }

  @Get(":id")
  findOne(@Param("id") id: string, @Request() req: AuthRequest) {
    return this.submissions.getDetail(id, req.user.id, req.user.role);
  }

  @Post(":id/grade")
  @Roles("admin", "teacher")
  grade(
    @Param("id") id: string,
    @Body() dto: GradeSubmissionDto,
    @Request() req: AuthRequest,
  ) {
    return this.submissions.grade(id, dto, req.user.id, req.user.role);
  }

  @Patch(":id/return")
  @Roles("admin", "teacher")
  returnSubmission(@Param("id") id: string, @Request() req: AuthRequest) {
    return this.submissions.returnSubmission(id, req.user.id, req.user.role);
  }
}
