import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Request,
  BadRequestException,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { FilesService } from "./files.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";

interface AuthRequest {
  user: { id: string; email: string; role: string };
}

@Controller("files")
@UseGuards(JwtAuthGuard)
export class FilesController {
  constructor(private files: FilesService) {}

  @Get()
  listFiles() {
    return this.files.listFiles();
  }

  @Post("pdf")
  @UseInterceptors(FileInterceptor("file"))
  uploadPdf(
    @UploadedFile() file: Express.Multer.File,
    @Request() req: AuthRequest,
  ) {
    if (!file) throw new BadRequestException("No file provided");
    if (file.mimetype !== "application/pdf") {
      throw new BadRequestException("Only PDF files are accepted");
    }
    return this.files.uploadPdf(file, req.user.id);
  }

  @Get("assets/url")
  getAssetUrl(@Query("key") key: string) {
    if (!key) throw new BadRequestException("key query parameter is required");
    return this.files.getAssetUrl(key);
  }

  @Get(":id/status")
  getStatus(@Param("id") id: string) {
    return this.files.getStatus(id);
  }

  @Delete(":id")
  deleteFile(@Param("id") id: string) {
    return this.files.deleteFile(id);
  }
}
