import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { ExamDocumentsService } from "./exam-documents.service";
import { CreateExamDocumentDto } from "./dto/create-exam-document.dto";
import { AssignFromExamDto } from "./dto/assign-from-exam.dto";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";

interface AuthRequest {
  user: { id: string; email: string; role: string };
}

@Controller("exam-documents")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("admin", "teacher")
export class ExamDocumentsController {
  constructor(private examDocuments: ExamDocumentsService) {}

  @Post()
  create(@Body() dto: CreateExamDocumentDto, @Request() req: AuthRequest) {
    return this.examDocuments.create(dto, req.user.id, req.user.role);
  }

  @Get()
  findAll(
    @Query("scope") scope: "mine" | "shared" | "all" = "mine",
    @Request() req: AuthRequest,
  ) {
    return this.examDocuments.findAll(req.user.id, scope);
  }

  @Get(":id")
  findById(@Param("id") id: string, @Request() req: AuthRequest) {
    return this.examDocuments.findById(id, req.user.id);
  }

  @Get(":id/download")
  getDownloadUrl(
    @Param("id") id: string,
    @Query("type") type: "pdf" | "answer" = "pdf",
    @Request() req: AuthRequest,
  ) {
    return this.examDocuments.getDownloadUrl(id, req.user.id, type);
  }

  @Post(":id/regenerate")
  regenerate(@Param("id") id: string, @Request() req: AuthRequest) {
    return this.examDocuments.regenerate(id, req.user.id);
  }

  @Post(":id/duplicate")
  duplicate(@Param("id") id: string, @Request() req: AuthRequest) {
    return this.examDocuments.duplicate(id, req.user.id);
  }

  @Post(":id/assign")
  assign(
    @Param("id") id: string,
    @Body() dto: AssignFromExamDto,
    @Request() req: AuthRequest,
  ) {
    return this.examDocuments.assign(id, dto, req.user.id, req.user.role);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param("id") id: string, @Request() req: AuthRequest) {
    return this.examDocuments.remove(id, req.user.id);
  }
}
