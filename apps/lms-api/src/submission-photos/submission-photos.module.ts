import { Module } from "@nestjs/common";
import { SubmissionPhotosService } from "./submission-photos.service";
import { SubmissionPhotosController } from "./submission-photos.controller";

@Module({
  controllers: [SubmissionPhotosController],
  providers: [SubmissionPhotosService],
})
export class SubmissionPhotosModule {}
