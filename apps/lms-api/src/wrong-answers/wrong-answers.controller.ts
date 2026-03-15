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
import { WrongAnswersService } from "./wrong-answers.service";
import { ClassifyErrorDto } from "./dto/classify-error.dto";
import { RetryWrongAnswerDto } from "./dto/retry-wrong-answer.dto";
import { ListWrongAnswersDto } from "./dto/list-wrong-answers.dto";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";

interface AuthRequest {
  user: { id: string; email: string; role: string };
}

@Controller("wrong-answers")
@UseGuards(JwtAuthGuard, RolesGuard)
export class WrongAnswersController {
  constructor(private wrongAnswers: WrongAnswersService) {}

  @Get()
  @Roles("student")
  list(@Query() query: ListWrongAnswersDto, @Request() req: AuthRequest) {
    return this.wrongAnswers.getByStudent(req.user.id, query);
  }

  @Get("stats")
  @Roles("student")
  stats(@Request() req: AuthRequest) {
    return this.wrongAnswers.getStats(req.user.id);
  }

  @Patch(":id/classify")
  @Roles("admin", "teacher")
  classify(
    @Param("id") id: string,
    @Body() dto: ClassifyErrorDto,
    @Request() req: AuthRequest,
  ) {
    return this.wrongAnswers.classifyError(
      id,
      dto.errorType,
      req.user.id,
      req.user.role,
    );
  }

  @Patch(":id/resolve")
  @Roles("student")
  resolve(@Param("id") id: string, @Request() req: AuthRequest) {
    return this.wrongAnswers.markResolved(id, req.user.id);
  }

  @Post(":id/retry")
  @Roles("student")
  retry(
    @Param("id") id: string,
    @Body() dto: RetryWrongAnswerDto,
    @Request() req: AuthRequest,
  ) {
    return this.wrongAnswers.retryWrongAnswer(id, req.user.id, dto.isCorrect);
  }
}
