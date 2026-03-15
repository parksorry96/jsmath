import { Module, OnModuleInit } from "@nestjs/common";
import { BullModule, InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { CanvasUploadService } from "./canvas/canvas-upload.service";
import { TutorVisionService } from "./tutor/tutor-vision.service";
import { WrongAnswersService } from "./weakness/wrong-answers.service";
import { MasteryService } from "./weakness/mastery.service";
import { KnowledgeGraphService } from "./weakness/knowledge-graph.service";
import { WeaknessProfileService } from "./weakness/weakness-profile.service";
import { SmartRecommendService } from "./recommend/smart-recommend.service";
import { ReviewScheduleService } from "./recommend/review-schedule.service";
import { WeaknessAggregationProcessor } from "./processors/weakness-aggregation.processor";
import { StudentAiController } from "./student-ai.controller";
import { StudentAiTeacherController } from "./student-ai-teacher.controller";

@Module({
  imports: [
    BullModule.registerQueue({ name: "student-ai-batch" }),
  ],
  controllers: [StudentAiController, StudentAiTeacherController],
  providers: [
    CanvasUploadService,
    TutorVisionService,
    WrongAnswersService,
    MasteryService,
    KnowledgeGraphService,
    WeaknessProfileService,
    SmartRecommendService,
    ReviewScheduleService,
    WeaknessAggregationProcessor,
  ],
  exports: [CanvasUploadService, WrongAnswersService, MasteryService, SmartRecommendService],
})
export class StudentAiModule implements OnModuleInit {
  constructor(
    @InjectQueue("student-ai-batch") private batchQueue: Queue,
  ) {}

  async onModuleInit() {
    await this.batchQueue.add("daily-weakness-summary", {}, {
      repeat: { pattern: "0 3 * * *" },
      removeOnComplete: 7,
      removeOnFail: 14,
    });
    await this.batchQueue.add("daily-recommendations", {}, {
      repeat: { pattern: "0 2 * * *" },
      removeOnComplete: 7,
      removeOnFail: 14,
    });
  }
}
