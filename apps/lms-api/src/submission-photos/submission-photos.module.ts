import { Module } from "@nestjs/common";
import { CommonModule } from "../common/common.module";
import { SubmissionPhotosService } from "./submission-photos.service";
import { SubmissionPhotosController } from "./submission-photos.controller";

@Module({
  imports: [CommonModule],
  controllers: [SubmissionPhotosController],
  providers: [SubmissionPhotosService],
})
export class SubmissionPhotosModule {}
