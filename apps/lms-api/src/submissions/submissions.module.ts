import { Module } from "@nestjs/common";
import { SubmissionsService } from "./submissions.service";
import { SubmissionsController } from "./submissions.controller";
import { WrongAnswersModule } from "../wrong-answers/wrong-answers.module";
import { MasteryModule } from "../mastery/mastery.module";

@Module({
  imports: [WrongAnswersModule, MasteryModule],
  controllers: [SubmissionsController],
  providers: [SubmissionsService],
})
export class SubmissionsModule {}
