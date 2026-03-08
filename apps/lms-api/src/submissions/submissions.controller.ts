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
  submit(@Body() dto: CreateSubmissionDto, @Request() req: AuthRequest) {
    return this.submissions.submit(req.user.id, dto);
  }

  @Get()
  findAll(
    @Query("assignmentId") assignmentId?: string,
    @Query("studentId") studentId?: string,
    @Query("classId") classId?: string,
    @Request() req?: AuthRequest,
  ) {
    if (assignmentId) return this.submissions.findByAssignment(assignmentId);
    const sid = studentId ?? req?.user.id;
    return this.submissions.findByStudent(sid!, classId);
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.submissions.getDetail(id);
  }

  @Post(":id/grade")
  @Roles("admin", "teacher")
  grade(
    @Param("id") id: string,
    @Body() dto: GradeSubmissionDto,
    @Request() req: AuthRequest,
  ) {
    return this.submissions.grade(id, dto, req.user.id);
  }

  @Patch(":id/return")
  @Roles("admin", "teacher")
  returnSubmission(@Param("id") id: string) {
    return this.submissions.returnSubmission(id);
  }
}
