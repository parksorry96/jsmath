import { Module } from "@nestjs/common";
import { CanvasUploadService } from "./canvas/canvas-upload.service";
import { TutorVisionService } from "./tutor/tutor-vision.service";
import { WrongAnswersService } from "./weakness/wrong-answers.service";
import { MasteryService } from "./weakness/mastery.service";
import { KnowledgeGraphService } from "./weakness/knowledge-graph.service";
import { SmartRecommendService } from "./recommend/smart-recommend.service";
import { ReviewScheduleService } from "./recommend/review-schedule.service";

@Module({
  providers: [
    CanvasUploadService,
    TutorVisionService,
    WrongAnswersService,
    MasteryService,
    KnowledgeGraphService,
    SmartRecommendService,
    ReviewScheduleService,
  ],
  exports: [CanvasUploadService, WrongAnswersService, MasteryService, SmartRecommendService],
})
export class StudentAiModule {}
