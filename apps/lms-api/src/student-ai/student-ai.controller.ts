import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  Request,
  Res,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { Response } from "express";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";
import { TutorVisionService } from "./tutor/tutor-vision.service";
import { WrongAnswersService } from "./weakness/wrong-answers.service";
import { MasteryService } from "./weakness/mastery.service";
import { WeaknessProfileService } from "./weakness/weakness-profile.service";
import { SmartRecommendService } from "./recommend/smart-recommend.service";
import { ReviewScheduleService } from "./recommend/review-schedule.service";
import { CanvasUploadService } from "./canvas/canvas-upload.service";
import { SendTutorMessageDto } from "./dto/send-tutor-message.dto";
import { ListWrongAnswersDto } from "./dto/list-wrong-answers.dto";

interface AuthRequest {
  user: { id: string; email: string; role: string };
}

@Controller("student-ai")
@UseGuards(JwtAuthGuard, RolesGuard)
export class StudentAiController {
  constructor(
    private tutor: TutorVisionService,
    private wrongAnswers: WrongAnswersService,
    private mastery: MasteryService,
    private weakness: WeaknessProfileService,
    private recommend: SmartRecommendService,
    private reviews: ReviewScheduleService,
    private canvas: CanvasUploadService,
  ) {}

  // ─── Tutor ───

  @Post("tutor/sessions")
  @Roles("student")
  createSession(
    @Body("problemId") problemId: string,
    @Request() req: AuthRequest,
  ) {
    return this.tutor.createSession(req.user.id, problemId);
  }

  @Post("tutor/sessions/:id/message")
  @Roles("student")
  async sendMessage(
    @Param("id") id: string,
    @Body() dto: SendTutorMessageDto,
    @Request() req: AuthRequest,
    @Res() res: Response,
  ) {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    try {
      const stream = this.tutor.sendMessage(
        id,
        req.user.id,
        dto.content,
        dto.imageS3Key,
      );
      for await (const chunk of stream) {
        res.write(`data: ${JSON.stringify({ chunk })}\n\n`);
      }
      res.write("event: done\ndata: {}\n\n");
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Internal server error";
      res.write(`event: error\ndata: ${JSON.stringify({ error: message })}\n\n`);
    }

    res.end();
  }

  @Get("tutor/sessions/:id")
  getSession(@Param("id") id: string, @Request() req: AuthRequest) {
    return this.tutor.getSession(id, req.user.id);
  }

  @Post("tutor/sessions/:id/end")
  @Roles("student")
  endSession(@Param("id") id: string, @Request() req: AuthRequest) {
    return this.tutor.endSession(id, req.user.id);
  }

  // ─── Canvas ───

  @Post("canvas/upload")
  @Roles("student")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 5 * 1024 * 1024 } }))
  uploadCanvas(
    @Request() req: AuthRequest,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException("File is required");
    }
    return this.canvas.upload(req.user.id, file.buffer, file.mimetype);
  }

  // ─── Weakness ───

  @Get("weakness")
  getWeakness(@Request() req: AuthRequest) {
    return this.weakness.getProfile(req.user.id);
  }

  // ─── Recommendations ───

  @Post("recommendations/generate")
  @Roles("student")
  generateRecommendations(@Request() req: AuthRequest) {
    return this.recommend.generateRecommendations(req.user.id);
  }

  // ─── Wrong Answers ───

  @Get("wrong-answers")
  getWrongAnswers(
    @Request() req: AuthRequest,
    @Query() query: ListWrongAnswersDto,
  ) {
    return this.wrongAnswers.getByStudent(req.user.id, query);
  }

  @Get("wrong-answers/stats")
  getWrongAnswerStats(@Request() req: AuthRequest) {
    return this.wrongAnswers.getStats(req.user.id);
  }

  @Patch("wrong-answers/:id/classify")
  classifyError(
    @Param("id") id: string,
    @Body("errorType") errorType: string,
    @Request() req: AuthRequest,
  ) {
    const validTypes = [
      "concept_gap",
      "pattern_gap",
      "calculation_error",
      "careless_mistake",
    ];
    if (!validTypes.includes(errorType)) {
      throw new BadRequestException(
        `Invalid error type. Must be one of: ${validTypes.join(", ")}`,
      );
    }
    return this.wrongAnswers.classifyError(
      id,
      errorType as any,
      req.user.id,
      req.user.role,
    );
  }

  @Patch("wrong-answers/:id/resolve")
  resolveWrongAnswer(
    @Param("id") id: string,
    @Request() req: AuthRequest,
  ) {
    return this.wrongAnswers.markResolved(id, req.user.id);
  }

  @Post("wrong-answers/:id/retry")
  retryWrongAnswer(
    @Param("id") id: string,
    @Body("isCorrect") isCorrect: boolean,
    @Request() req: AuthRequest,
  ) {
    return this.wrongAnswers.retryWrongAnswer(id, req.user.id, isCorrect);
  }

  // ─── Reviews ───

  @Get("reviews/daily")
  getDailyReview(@Request() req: AuthRequest) {
    return this.reviews.getDailyReview(req.user.id);
  }

  @Get("reviews/stats")
  getReviewStats(@Request() req: AuthRequest) {
    return this.reviews.getStats(req.user.id);
  }

  @Post("reviews/:id/grade")
  gradeReview(
    @Param("id") id: string,
    @Body("quality") quality: number,
    @Request() req: AuthRequest,
  ) {
    return this.reviews.gradeReview(id, req.user.id, quality);
  }

  // ─── Mastery ───

  @Get("mastery")
  getMasteryDashboard(@Request() req: AuthRequest) {
    return this.mastery.getDashboard(req.user.id);
  }

  @Get("mastery/tree")
  getMasteryTree(@Request() req: AuthRequest) {
    return this.mastery.getTreeWithMastery(req.user.id);
  }

  @Get("mastery/:nodeId")
  getMasteryByNode(
    @Param("nodeId") nodeId: string,
    @Request() req: AuthRequest,
  ) {
    return this.mastery.getByNode(req.user.id, nodeId);
  }
}
