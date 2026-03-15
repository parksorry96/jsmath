import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { AssignmentsService } from "./assignments.service";
import { CreateAssignmentDto } from "./dto/create-assignment.dto";
import { UpdateAssignmentDto } from "./dto/update-assignment.dto";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";
import { SmartRecommendService } from "../student-ai/recommend/smart-recommend.service";
import { GenerateAssignmentRemediationDto } from "./dto/generate-assignment-remediation.dto";

interface AuthRequest {
  user: { id: string; email: string; role: string };
}

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class AssignmentsController {
  constructor(
    private assignments: AssignmentsService,
    private remediation: SmartRecommendService,
  ) {}

  @Post("classes/:classId/assignments")
  @Roles("admin", "teacher")
  create(
    @Param("classId") classId: string,
    @Body() dto: CreateAssignmentDto,
    @Request() req: AuthRequest,
  ) {
    return this.assignments.create(classId, dto, req.user.id, req.user.role);
  }

  @Get("classes/assignments")
  @Roles("admin", "teacher")
  findAcrossClasses(
    @Query("hasPending") hasPending?: string,
    @Request() req?: AuthRequest,
  ) {
    if (!req) {
      return [];
    }
    return this.assignments.findAcrossClasses(
      req.user.id,
      req.user.role,
      hasPending === "true",
    );
  }

  @Get("assignments/pending")
  @Roles("admin", "teacher")
  findPendingAssignments(@Request() req: AuthRequest) {
    return this.assignments.findAcrossClasses(req.user.id, req.user.role, true);
  }

  @Get("classes/:classId/assignments")
  findAll(@Param("classId") classId: string, @Request() req: AuthRequest) {
    return this.assignments.findAll(classId, req.user.id, req.user.role);
  }

  @Get("assignments/my")
  @Roles("student")
  findMine(@Request() req: AuthRequest) {
    return this.assignments.findMine(req.user.id);
  }

  @Get("assignments/:id/exam-pdf")
  getExamPdf(@Param("id") id: string, @Request() req: AuthRequest) {
    return this.assignments.getExamPdf(id, req.user.id, req.user.role);
  }

  @Get("assignments/:id")
  findOne(@Param("id") id: string, @Request() req: AuthRequest) {
    return this.assignments.findById(id, req.user.id, req.user.role);
  }

  @Post("assignments/:id/generate-remediation")
  @Roles("admin", "teacher")
  generateRemediation(
    @Param("id") id: string,
    @Query() query: GenerateAssignmentRemediationDto,
    @Request() req: AuthRequest,
  ) {
    return this.remediation.generateForAssignment(
      id,
      req.user.id,
      req.user.role,
      {
        studentId: query.studentId,
        maxProblems: query.maxProblems,
      },
    );
  }

  @Patch("assignments/:id")
  @Roles("admin", "teacher")
  update(
    @Param("id") id: string,
    @Body() dto: UpdateAssignmentDto,
    @Request() req: AuthRequest,
  ) {
    return this.assignments.update(id, dto, req.user.id, req.user.role);
  }

  @Delete("assignments/:id")
  @Roles("admin", "teacher")
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param("id") id: string, @Request() req: AuthRequest) {
    return this.assignments.remove(id, req.user.id, req.user.role);
  }

  @Post("assignments/:id/return-all")
  @Roles("admin", "teacher")
  returnAll(@Param("id") id: string, @Request() req: AuthRequest) {
    return this.assignments.returnAll(id, req.user.id, req.user.role);
  }

  @Post("assignments/:id/problems")
  @Roles("admin", "teacher")
  addProblems(
    @Param("id") id: string,
    @Body() body: { problemIds: string[] },
    @Request() req: AuthRequest,
  ) {
    return this.assignments.addProblems(
      id,
      body.problemIds,
      req.user.id,
      req.user.role,
    );
  }

  @Delete("assignments/:id/problems/:problemId")
  @Roles("admin", "teacher")
  removeProblem(
    @Param("id") id: string,
    @Param("problemId") problemId: string,
    @Request() req: AuthRequest,
  ) {
    return this.assignments.removeProblem(
      id,
      problemId,
      req.user.id,
      req.user.role,
    );
  }

  @Patch("assignments/:id/problems/reorder")
  @Roles("admin", "teacher")
  reorderProblems(
    @Param("id") id: string,
    @Body() body: { problemIds: string[] },
    @Request() req: AuthRequest,
  ) {
    return this.assignments.reorderProblems(
      id,
      body.problemIds,
      req.user.id,
      req.user.role,
    );
  }
}
