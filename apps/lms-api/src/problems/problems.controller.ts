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

  @Get("filter-options")
  @Roles("admin", "teacher")
  getFilterOptions(@Request() req: AuthRequest) {
    return this.problems.getFilterOptions(req.user.id, req.user.role);
  }

  @Get("stats")
  @Roles("admin", "teacher")
  getStats(@Request() req: AuthRequest) {
    return this.problems.getStats(req.user.id, req.user.role);
  }

  @Get()
  @Roles("admin", "teacher")
  findAll(
    @Request() req: AuthRequest,
    @Query("ocrJobId") ocrJobId?: string,
    @Query("reviewStatus") reviewStatus?: ReviewStatus,
    @Query("gradeLevel") gradeLevel?: string,
    @Query("subject") subject?: string,
    @Query("unitMajor") unitMajor?: string,
    @Query("difficulty") difficulty?: string,
    @Query("problemType") problemType?: string,
    @Query("analysisStatus") analysisStatus?: string,
    @Query("bookTitle") bookTitle?: string,
    @Query("q") q?: string,
    @Query("search") search?: string,
    @Query("searchMode") searchMode?: string,
    @Query("examYear") examYear?: string,
    @Query("examMonth") examMonth?: string,
    @Query("examType") examType?: string,
    @Query("page") page?: string,
    @Query("limit") limit?: string,
  ) {
    const queryText = q ?? search;
    if (searchMode === "semantic" && queryText) {
      return this.problems.semanticSearch(queryText, {
        requesterId: req.user.id,
        requesterRole: req.user.role,
        subject,
        gradeLevel,
        difficulty,
        limit: limit ? parseInt(limit, 10) : undefined,
      });
    }

    return this.problems.findAll({
      requesterId: req.user.id,
      requesterRole: req.user.role,
      ocrJobId,
      reviewStatus,
      gradeLevel,
      subject,
      unitMajor,
      difficulty,
      problemType,
      analysisStatus,
      bookTitle,
      q: queryText,
      examYear,
      examMonth,
      examType,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Post("analyze")
  @Roles("admin", "teacher")
  triggerAnalysis(
    @Body() body: { ocrJobId: string; problemIds?: string[] },
    @Request() req: AuthRequest,
  ) {
    return this.problems.triggerAnalysis(
      body.ocrJobId,
      req.user.id,
      req.user.role,
      body.problemIds,
    );
  }

  @Post(":id/generate-twin")
  @Roles("admin", "teacher")
  generateTwin(@Param("id") id: string, @Request() req: AuthRequest) {
    return this.problems.generateTwinProblem(id, req.user.id, req.user.role);
  }

  @Get(":id/analysis")
  @Roles("admin", "teacher")
  getAnalysis(@Param("id") id: string, @Request() req: AuthRequest) {
    return this.problems.getAnalysis(id, req.user.id, req.user.role);
  }

  @Patch(":id")
  @Roles("admin", "teacher")
  update(
    @Param("id") id: string,
    @Body() dto: UpdateProblemDto,
    @Request() req: AuthRequest,
  ) {
    return this.problems.update(id, dto, req.user.id, req.user.role);
  }

  @Post(":id/review")
  @Roles("admin", "teacher")
  review(
    @Param("id") id: string,
    @Body() dto: ReviewProblemDto,
    @Request() req: AuthRequest,
  ) {
    return this.problems.review(id, dto.action, req.user.id, req.user.role);
  }
}
