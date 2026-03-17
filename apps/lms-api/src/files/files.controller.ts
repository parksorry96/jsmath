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
  UploadedFiles,
  Request,
  BadRequestException,
} from "@nestjs/common";
import {
  FileFieldsInterceptor,
  FileInterceptor,
} from "@nestjs/platform-express";
import { FilesService } from "./files.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";

interface AuthRequest {
  user: { id: string; email: string; role: string };
}

const MAX_DIRECT_PDF_UPLOAD_BYTES = 20 * 1024 * 1024;
const MAX_DIRECT_TEXTBOOK_FILE_BYTES = 20 * 1024 * 1024;

function parseBooleanInput(value: unknown, defaultValue = true): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "off"].includes(normalized)) return false;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  return defaultValue;
}

function pdfFileFilter(
  _req: unknown,
  file: Express.Multer.File,
  callback: (error: Error | null, acceptFile: boolean) => void,
) {
  if (
    file.mimetype !== "application/pdf" &&
    !file.originalname.toLowerCase().endsWith(".pdf")
  ) {
    callback(new BadRequestException("Only PDF files are accepted"), false);
    return;
  }

  callback(null, true);
}

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
      limits: { files: 1, fileSize: MAX_DIRECT_PDF_UPLOAD_BYTES },
      fileFilter: pdfFileFilter,
    }),
  )
  uploadPdf(
    @UploadedFile() file: Express.Multer.File,
    @Request() req: AuthRequest,
    @Body("document_type") documentType?: string,
    @Body("book_title") bookTitle?: string,
    @Body("publisher") publisher?: string,
    @Body("auto_analyze") autoAnalyze?: string | boolean,
  ) {
    if (!file) throw new BadRequestException("No file provided");
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
      autoAnalyze: parseBooleanInput(autoAnalyze, true),
    });
  }

  @Post("textbook")
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: "problem_file", maxCount: 1 },
        { name: "answer_file", maxCount: 1 },
      ],
      {
        limits: { files: 2, fileSize: MAX_DIRECT_TEXTBOOK_FILE_BYTES },
        fileFilter: pdfFileFilter,
      },
    ),
  )
  uploadTextbook(
    @UploadedFiles()
    files: {
      problem_file?: Express.Multer.File[];
      answer_file?: Express.Multer.File[];
    },
    @Request() req: AuthRequest,
    @Body("book_title") bookTitle?: string,
    @Body("publisher") publisher?: string,
    @Body("auto_analyze") autoAnalyze?: string | boolean,
  ) {
    const problemFile = files?.problem_file?.[0];
    const answerFile = files?.answer_file?.[0];

    if (!problemFile) {
      throw new BadRequestException("problem_file is required");
    }
    if (!bookTitle?.trim()) {
      throw new BadRequestException("book_title is required for textbook uploads");
    }

    return this.files.uploadTextbookPdf(problemFile, answerFile, req.user.id, {
      documentType: "textbook",
      bookTitle: bookTitle.trim(),
      publisher: publisher?.trim() || null,
      autoAnalyze: parseBooleanInput(autoAnalyze, true),
    });
  }

  @Post("uploads/multipart/initiate")
  initiateMultipartUpload(
    @Body("filename") filename: string,
    @Body("size") size?: number,
    @Body("role") role?: "exam" | "textbook_problem" | "textbook_answer",
    @Body("contentType") contentType?: string,
    @Request() req?: AuthRequest,
  ) {
    if (!filename?.trim()) {
      throw new BadRequestException("filename is required");
    }
    if (!role) {
      throw new BadRequestException("role is required");
    }

    return this.files.createMultipartUpload(req!.user.id, {
      filename: filename.trim(),
      size: Number(size),
      role,
      contentType: contentType?.trim() || "application/pdf",
    });
  }

  @Post("uploads/multipart/urls")
  getMultipartUploadUrls(
    @Body("key") key: string,
    @Body("uploadId") uploadId: string,
    @Body("partNumbers") partNumbers?: number[],
    @Request() req?: AuthRequest,
  ) {
    return this.files.getMultipartUploadUrls(req!.user.id, {
      key,
      uploadId,
      partNumbers: Array.isArray(partNumbers)
        ? partNumbers.map((partNumber) => Number(partNumber))
        : [],
    });
  }

  @Post("uploads/multipart/complete")
  completeMultipartUpload(
    @Body("key") key: string,
    @Body("uploadId") uploadId: string,
    @Body("parts")
    parts?: Array<{ partNumber: number; etag: string }>,
    @Request() req?: AuthRequest,
  ) {
    return this.files.completeMultipartUpload(req!.user.id, {
      key,
      uploadId,
      parts: Array.isArray(parts)
        ? parts.map((part) => ({
            partNumber: Number(part.partNumber),
            etag: String(part.etag),
          }))
        : [],
    });
  }

  @Post("uploads/multipart/abort")
  abortMultipartUpload(
    @Body("key") key: string,
    @Body("uploadId") uploadId: string,
    @Request() req?: AuthRequest,
  ) {
    return this.files.abortMultipartUpload(req!.user.id, {
      key,
      uploadId,
    });
  }

  @Post("pdf/register")
  registerUploadedPdf(
    @Body("key") key: string,
    @Body("filename") filename: string,
    @Body("size") size?: number,
    @Body("document_type") documentType?: string,
    @Body("book_title") bookTitle?: string,
    @Body("publisher") publisher?: string,
    @Body("auto_analyze") autoAnalyze?: boolean | string,
    @Request() req?: AuthRequest,
  ) {
    const docType = documentType ?? "exam";
    if (docType !== "exam" && docType !== "textbook") {
      throw new BadRequestException("document_type must be 'exam' or 'textbook'");
    }
    if (docType === "textbook" && !bookTitle?.trim()) {
      throw new BadRequestException("book_title is required for textbook uploads");
    }

    return this.files.registerUploadedPdf(req!.user.id, {
      key,
      filename,
      size: Number(size),
      documentType: docType,
      bookTitle: bookTitle?.trim() || null,
      publisher: publisher?.trim() || null,
      autoAnalyze: parseBooleanInput(autoAnalyze, true),
    });
  }

  @Post("textbook/register")
  registerUploadedTextbook(
    @Body("problem_key") problemKey: string,
    @Body("problem_filename") problemFilename: string,
    @Body("problem_size") problemSize?: number,
    @Body("answer_key") answerKey?: string,
    @Body("answer_size") answerSize?: number,
    @Body("book_title") bookTitle?: string,
    @Body("publisher") publisher?: string,
    @Body("auto_analyze") autoAnalyze?: boolean | string,
    @Request() req?: AuthRequest,
  ) {
    if (!bookTitle?.trim()) {
      throw new BadRequestException("book_title is required for textbook uploads");
    }

    return this.files.registerUploadedTextbook(req!.user.id, {
      problemKey,
      problemFilename,
      problemSize: Number(problemSize),
      answerKey: answerKey?.trim() || null,
      answerSize:
        answerSize === undefined || answerSize === null
          ? null
          : Number(answerSize),
      bookTitle: bookTitle.trim(),
      publisher: publisher?.trim() || null,
      autoAnalyze: parseBooleanInput(autoAnalyze, true),
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
