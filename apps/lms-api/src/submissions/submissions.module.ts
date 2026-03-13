import { Module } from "@nestjs/common";
import { SubmissionsService } from "./submissions.service";
import { SubmissionsController } from "./submissions.controller";
import { WrongAnswersModule } from "../wrong-answers/wrong-answers.module";
import { MasteryModule } from "../mastery/mastery.module";
import { SmartScoreService } from "./smart-score.service";

@Module({
  imports: [WrongAnswersModule, MasteryModule],
  controllers: [SubmissionsController],
  providers: [SubmissionsService, SmartScoreService],
})
export class SubmissionsModule {}
