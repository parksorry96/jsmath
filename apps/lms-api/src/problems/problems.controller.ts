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
import { ProblemRevisionService } from "./problem-revision.service";
import { ProblemStatisticsService } from "./problem-statistics.service";
import { ProblemQualityService } from "./problem-quality.service";
import { ReviewProblemDto } from "./dto/review-problem.dto";
import { UpdateProblemDto } from "./dto/update-problem.dto";
import { GenerateVariantsDto } from "./dto/generate-variants.dto";
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
  constructor(
    private problems: ProblemsService,
    private revisions: ProblemRevisionService,
    private statistics: ProblemStatisticsService,
    private quality: ProblemQualityService,
  ) {}

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
    @Query("solutionTag") solutionTag?: string,
    @Query("q") q?: string,
    @Query("search") search?: string,
    @Query("searchMode") searchMode?: string,
    @Query("examYear") examYear?: string,
    @Query("examMonth") examMonth?: string,
    @Query("examType") examType?: string,
    @Query("curriculumNodeId") curriculumNodeId?: string,
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
      solutionTag,
      q: queryText,
      examYear,
      examMonth,
      examType,
      curriculumNodeId,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Get("browse")
  @Roles("admin", "teacher", "student")
  browse(
    @Query("subject") subject?: string,
    @Query("gradeLevel") gradeLevel?: string,
    @Query("difficulty") difficulty?: string,
    @Query("unitMajor") unitMajor?: string,
    @Query("problemType") problemType?: string,
    @Query("q") q?: string,
    @Query("page") page?: string,
    @Query("limit") limit?: string,
  ) {
    return this.problems.browse({
      subject,
      gradeLevel,
      difficulty,
      unitMajor,
      problemType,
      q,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Get("flagged")
  @Roles("admin", "teacher")
  getFlagged(
    @Query("page") page?: string,
    @Query("limit") limit?: string,
  ) {
    return this.quality.findFlagged(
      page ? parseInt(page, 10) : undefined,
      limit ? parseInt(limit, 10) : undefined,
    );
  }

  @Post("quality/evaluate-batch")
  @Roles("admin")
  evaluateQualityBatch() {
    return this.quality.evaluateBatch();
  }

  @Post("by-ids")
  @Roles("admin", "teacher")
  findByIds(@Body() body: { ids: string[] }) {
    return this.problems.findByIds(body.ids);
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

  @Post(":id/generate-variants")
  @Roles("admin", "teacher")
  generateVariants(
    @Param("id") id: string,
    @Body() dto: GenerateVariantsDto,
    @Request() req: AuthRequest,
  ) {
    return this.problems.generateVariants(
      id,
      dto.count,
      req.user.id,
      req.user.role,
      dto.difficultyTarget,
    );
  }

  @Get(":id/student-view")
  @Roles("admin", "teacher", "student")
  studentView(@Param("id") id: string) {
    return this.problems.studentView(id);
  }

  @Get(":id/analysis")
  @Roles("admin", "teacher")
  getAnalysis(@Param("id") id: string, @Request() req: AuthRequest) {
    return this.problems.getAnalysis(id, req.user.id, req.user.role);
  }

  @Get(":id/revisions")
  @Roles("admin", "teacher")
  getRevisions(@Param("id") id: string) {
    return this.revisions.getRevisions(id);
  }

  @Get(":id/revisions/:revisionId")
  @Roles("admin", "teacher")
  getRevision(
    @Param("id") id: string,
    @Param("revisionId") revisionId: string,
  ) {
    return this.revisions.getRevision(id, revisionId);
  }

  @Post(":id/revisions/:revisionId/restore")
  @Roles("admin", "teacher")
  restoreRevision(
    @Param("id") id: string,
    @Param("revisionId") revisionId: string,
    @Request() req: AuthRequest,
  ) {
    return this.revisions.restoreRevision(
      id,
      revisionId,
      req.user.id,
      req.user.role,
    );
  }

  @Get(":id/statistics")
  @Roles("admin", "teacher")
  getStatistics(@Param("id") id: string) {
    return this.statistics.getStatistics(id);
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

  @Post(":id/retire")
  @Roles("admin")
  retire(@Param("id") id: string, @Request() req: AuthRequest) {
    return this.quality.retireProblem(id, req.user.id);
  }

  @Post("statistics/recompute")
  @Roles("admin")
  recomputeStatistics() {
    return this.statistics.recomputeBatch();
  }
}
