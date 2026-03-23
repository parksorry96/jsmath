import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Request,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";
import { GradePredictionService } from "./grade-prediction.service";
import { canAccessStudentData } from "../common/access-control";
import { PrismaService } from "../prisma/prisma.service";
import { PredictMockCutoffsDto } from "./dto/predict-mock-cutoffs.dto";

interface AuthRequest {
  user: { id: string; email: string; role: string };
}

interface CutoffDto {
  examYear: number;
  examMonth: number;
  subject: string;
  grade: number;
  minScore: number;
  maxScore: number;
  percentile?: number;
}

@Controller("grade-prediction")
@UseGuards(JwtAuthGuard, RolesGuard)
export class GradePredictionController {
  constructor(
    private gradePrediction: GradePredictionService,
    private prisma: PrismaService,
  ) {}

  @Post("cutoffs")
  @Roles("admin")
  upsertCutoffs(@Body() body: { cutoffs: CutoffDto[] }) {
    return this.gradePrediction.upsertCutoffs(body.cutoffs);
  }

  @Get("cutoffs")
  getCutoffs(
    @Query("year", new ParseIntPipe({ optional: true })) year?: number,
    @Query("month", new ParseIntPipe({ optional: true })) month?: number,
    @Query("subject") subject?: string,
  ) {
    return this.gradePrediction.getCutoffs(year, month, subject);
  }

  @Post("mock-cutoffs")
  @Roles("admin", "teacher")
  predictMockCutoffs(@Body() body: PredictMockCutoffsDto) {
    return this.gradePrediction.predictMockCutoffs(body);
  }

  @Get("student/:studentId")
  async getStudentPredictions(
    @Param("studentId") studentId: string,
    @Request() req: AuthRequest,
  ) {
    const allowed = await canAccessStudentData(
      this.prisma,
      req.user.id,
      req.user.role,
      studentId,
    );
    if (!allowed) throw new ForbiddenException();

    return this.gradePrediction.getStudentPredictions(studentId);
  }

  @Get("me")
  getMyPredictions(@Request() req: AuthRequest) {
    return this.gradePrediction.getStudentPredictions(req.user.id);
  }
}
