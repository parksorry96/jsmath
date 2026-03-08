import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Query,
  Body,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Request,
  BadRequestException,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { FilesService } from "./files.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";

interface AuthRequest {
  user: { id: string; email: string; role: string };
}

@Controller("files")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("admin", "teacher")
export class FilesController {
  constructor(private files: FilesService) {}

  @Get()
  listFiles() {
    return this.files.listFiles();
  }

  @Post("pdf")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 300 * 1024 * 1024 } }))
  uploadPdf(
    @UploadedFile() file: Express.Multer.File,
    @Request() req: AuthRequest,
    @Body("document_type") documentType?: string,
    @Body("book_title") bookTitle?: string,
    @Body("publisher") publisher?: string,
  ) {
    if (!file) throw new BadRequestException("No file provided");
    if (file.mimetype !== "application/pdf") {
      throw new BadRequestException("Only PDF files are accepted");
    }
    const docType = documentType ?? "exam";
    if (docType !== "exam" && docType !== "textbook") {
      throw new BadRequestException("document_type must be 'exam' or 'textbook'");
    }
    if (docType === "textbook" && !bookTitle) {
      throw new BadRequestException("book_title is required for textbook uploads");
    }
    return this.files.uploadPdf(file, req.user.id, {
      documentType: docType,
      bookTitle: bookTitle ?? null,
      publisher: publisher ?? null,
    });
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
