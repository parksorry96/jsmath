import {
  Controller,
  Post,
  Get,
  Param,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Request,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { SubmissionPhotosService } from "./submission-photos.service";

@Controller("submissions/:submissionId/photos")
@UseGuards(JwtAuthGuard)
export class SubmissionPhotosController {
  constructor(private readonly submissionPhotos: SubmissionPhotosService) {}

  @Post()
  @UseInterceptors(FileInterceptor("file"))
  upload(
    @Param("submissionId") submissionId: string,
    @UploadedFile() file: Express.Multer.File,
    @Request() req: { user: { id: string; role: string } },
  ) {
    return this.submissionPhotos.uploadPhoto(
      submissionId,
      file,
      req.user.id,
      req.user.role,
    );
  }

  @Get(":photoId")
  getPhoto(
    @Param("photoId") photoId: string,
    @Request() req: { user: { id: string; role: string } },
  ) {
    return this.submissionPhotos.getPhoto(photoId, req.user.id, req.user.role);
  }
}
