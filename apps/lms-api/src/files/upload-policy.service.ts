import {
  Injectable,
  BadRequestException,
  ForbiddenException,
} from "@nestjs/common";
import { randomUUID } from "crypto";
import { normalizeFilename } from "../common/filename";

const BOOK_SOURCE_NUMBER_KEYS = ["problemNumber", "displayNumber", "localNumber"] as const;

export type MultipartUploadRole =
  | "exam"
  | "textbook_problem"
  | "textbook_answer";

@Injectable()
export class UploadPolicyService {
  isPdfUpload(file: Express.Multer.File): boolean {
    if (!file?.buffer || file.buffer.length < 4) {
      return false;
    }

    return file.buffer.subarray(0, 4).toString("utf8") === "%PDF";
  }

  buildMultipartUploadKey(
    uploaderId: string,
    role: MultipartUploadRole,
  ): string {
    const folder =
      role === "exam"
        ? "exam"
        : role === "textbook_problem"
          ? "textbook"
          : "textbook-answer";

    return `uploads/${uploaderId}/${folder}/${randomUUID()}.pdf`;
  }

  assertScopedUploadKey(key: string, uploaderId: string) {
    if (!key || key.includes("..") || key.startsWith("/")) {
      throw new BadRequestException("Invalid upload key");
    }

    const scopedPrefix = `uploads/${uploaderId}/`;
    if (!key.startsWith(scopedPrefix)) {
      throw new ForbiddenException("Upload key does not belong to this user");
    }
  }

  buildTextbookBundleFilename(
    problemFilename: string,
    answerFilename: string | null,
    bookTitle: string | null,
  ): string {
    if (!answerFilename) {
      return problemFilename;
    }

    const normalizedTitle = normalizeFilename(bookTitle)?.trim();
    if (normalizedTitle) {
      return `${normalizedTitle} (문제집+답지).pdf`;
    }

    const normalizedProblemName = normalizeFilename(problemFilename)?.replace(/\.pdf$/i, "")?.trim();
    if (normalizedProblemName) {
      return `${normalizedProblemName} (문제집+답지).pdf`;
    }

    return "textbook-bundle.pdf";
  }

  getSourceFileScopeWhere(requesterId: string, requesterRole: string) {
    if (requesterRole === "admin") {
      return {};
    }

    return { uploaderId: requesterId };
  }

  getProblemAssetScopeWhere(requesterId: string, requesterRole: string) {
    if (requesterRole === "admin") {
      return {};
    }

    return {
      problem: {
        ocrJob: {
          sourceFile: {
            uploaderId: requesterId,
          },
        },
      },
    };
  }

  sanitizeBookSource(bookSource: unknown): Record<string, unknown> | undefined {
    if (!bookSource || typeof bookSource !== "object" || Array.isArray(bookSource)) {
      return undefined;
    }

    const sanitized = { ...(bookSource as Record<string, unknown>) };
    for (const key of BOOK_SOURCE_NUMBER_KEYS) {
      delete sanitized[key];
    }

    return Object.keys(sanitized).length > 0 ? sanitized : undefined;
  }
}
