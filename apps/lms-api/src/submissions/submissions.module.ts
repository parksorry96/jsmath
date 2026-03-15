import { Module } from "@nestjs/common";
import { SubmissionsService } from "./submissions.service";
import { SubmissionsController } from "./submissions.controller";
import { StudentAiModule } from "../student-ai/student-ai.module";
import { GamificationModule } from "../gamification/gamification.module";
import { ClassMonitorModule } from "../class-monitor/class-monitor.module";
import { SmartScoreService } from "./smart-score.service";

@Module({
  imports: [StudentAiModule, GamificationModule, ClassMonitorModule],
  controllers: [SubmissionsController],
  providers: [SubmissionsService, SmartScoreService],
})
export class SubmissionsModule {}
