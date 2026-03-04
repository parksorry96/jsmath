import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  Request,
} from "@nestjs/common";
import { ProblemsService } from "./problems.service";
import { ReviewProblemDto } from "./dto/review-problem.dto";
import { UpdateProblemDto } from "./dto/update-problem.dto";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";
import { ReviewStatus } from "@prisma/client";

interface AuthRequest {
  user: { id: string; email: string; role: string };
}

@Controller("problems")
@UseGuards(JwtAuthGuard, RolesGuard)
export class ProblemsController {
  constructor(private problems: ProblemsService) {}

  @Get("stats")
  getStats() {
    return this.problems.getStats();
  }

  @Get()
  findAll(
    @Query("ocrJobId") ocrJobId?: string,
    @Query("reviewStatus") reviewStatus?: ReviewStatus,
    @Query("gradeLevel") gradeLevel?: string,
    @Query("subject") subject?: string,
    @Query("unitMajor") unitMajor?: string,
    @Query("difficulty") difficulty?: string,
    @Query("problemType") problemType?: string,
    @Query("q") q?: string,
    @Query("page") page?: string,
    @Query("limit") limit?: string,
  ) {
    return this.problems.findAll({
      ocrJobId,
      reviewStatus,
      gradeLevel,
      subject,
      unitMajor,
      difficulty,
      problemType,
      q,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Patch(":id")
  @Roles("admin", "teacher")
  update(@Param("id") id: string, @Body() dto: UpdateProblemDto) {
    return this.problems.update(id, dto);
  }

  @Post(":id/review")
  @Roles("admin", "teacher")
  review(
    @Param("id") id: string,
    @Body() dto: ReviewProblemDto,
    @Request() req: AuthRequest,
  ) {
    return this.problems.review(id, dto.action, req.user.id);
  }
}
