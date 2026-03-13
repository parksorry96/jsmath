import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  Request,
} from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { ReviewsService } from "./reviews.service";
import { GradeReviewDto } from "./dto/grade-review.dto";

interface AuthRequest {
  user: { id: string; email: string; role: string };
}

@Controller("reviews")
@UseGuards(JwtAuthGuard)
export class ReviewsController {
  constructor(private reviews: ReviewsService) {}

  @Get("daily")
  getDailyReview(@Request() req: AuthRequest) {
    return this.reviews.getDailyReview(req.user.id);
  }

  @Get("stats")
  getStats(@Request() req: AuthRequest) {
    return this.reviews.getStats(req.user.id);
  }

  @Post(":id/grade")
  grade(
    @Param("id") id: string,
    @Body() dto: GradeReviewDto,
    @Request() req: AuthRequest,
  ) {
    return this.reviews.gradeReview(id, req.user.id, dto.quality);
  }
}
