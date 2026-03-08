import {
  Controller,
  Post,
  Get,
  Param,
  BadRequestException,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Request,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { SubmissionPhotosService } from "./submission-photos.service";

const MAX_PHOTO_UPLOAD_BYTES = 10 * 1024 * 1024;

@Controller("submissions/:submissionId/photos")
@UseGuards(JwtAuthGuard)
export class SubmissionPhotosController {
  constructor(private readonly submissionPhotos: SubmissionPhotosService) {}

  @Post()
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: MAX_PHOTO_UPLOAD_BYTES, files: 1 },
      fileFilter: (_req, file, callback) => {
        if (!file.mimetype.startsWith("image/")) {
          callback(
            new BadRequestException("Only image uploads are accepted"),
            false,
          );
          return;
        }

        callback(null, true);
      },
    }),
  )
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
