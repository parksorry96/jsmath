import { Module } from "@nestjs/common";
import { CommonModule } from "../common/common.module";
import { FilesModule } from "../files/files.module";
import { OcrPipelineEventConsumerService } from "./ocr-pipeline-event-consumer.service";
import { OcrPipelineEventHandlerService } from "./ocr-pipeline-event-handler.service";
import { OcrProblemMaterializerService } from "./ocr-problem-materializer.service";

@Module({
  imports: [CommonModule, FilesModule],
  providers: [
    OcrPipelineEventConsumerService,
    OcrPipelineEventHandlerService,
    OcrProblemMaterializerService,
  ],
})
export class IngestionModule {}
