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

const MAX_PDF_UPLOAD_BYTES = 100 * 1024 * 1024;

@Controller("files")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("admin", "teacher")
export class FilesController {
  constructor(private files: FilesService) {}

  @Get()
  listFiles(@Request() req: AuthRequest) {
    return this.files.listFiles(req.user.id, req.user.role);
  }

  @Post("pdf")
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: MAX_PDF_UPLOAD_BYTES, files: 1 },
      fileFilter: (_req, file, callback) => {
        if (
          file.mimetype !== "application/pdf" &&
          !file.originalname.toLowerCase().endsWith(".pdf")
        ) {
          callback(new BadRequestException("Only PDF files are accepted"), false);
          return;
        }
        callback(null, true);
      },
    }),
  )
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
  getAssetUrl(@Query("key") key: string, @Request() req: AuthRequest) {
    if (!key) throw new BadRequestException("key query parameter is required");
    return this.files.getAssetUrl(key, req.user.id, req.user.role);
  }

  @Get(":id/status")
  getStatus(@Param("id") id: string, @Request() req: AuthRequest) {
    return this.files.getStatus(id, req.user.id, req.user.role);
  }

  @Delete(":id")
  deleteFile(@Param("id") id: string, @Request() req: AuthRequest) {
    return this.files.deleteFile(id, req.user.id, req.user.role);
  }
}
