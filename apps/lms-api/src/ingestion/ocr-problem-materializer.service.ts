import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { UploadPolicyService } from "../files/upload-policy.service";
import { normalizeOcrProblem } from "./ocr-problem-normalizer";

type ExistingProblemRecord = {
  id: string;
  problemNumber: string | null;
  displayNumber: string | null;
  startPage: number;
  endPage: number;
  stemLatex: string;
  stemText: string;
  assets: Array<{ s3Key: string }>;
};

@Injectable()
export class OcrProblemMaterializerService {
  private readonly logger = new Logger(OcrProblemMaterializerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly uploadPolicy: UploadPolicyService,
  ) {}

  private buildProblemFingerprint(problem: {
    problemNumber?: unknown;
    displayNumber?: unknown;
    startPage?: unknown;
    endPage?: unknown;
    stemLatex?: unknown;
    stemText?: unknown;
  }): string {
    return JSON.stringify([
      typeof problem.problemNumber === "string" ? problem.problemNumber.trim() : "",
      typeof problem.displayNumber === "string" ? problem.displayNumber.trim() : "",
      typeof problem.startPage === "number" ? problem.startPage : 0,
      typeof problem.endPage === "number" ? problem.endPage : 0,
      typeof problem.stemText === "string" ? problem.stemText.trim() : "",
      typeof problem.stemLatex === "string" ? problem.stemLatex.trim() : "",
    ]);
  }

  private async ensureAssets(
    problemId: string,
    existingAssetKeys: Set<string>,
    payload: Record<string, unknown>,
  ) {
    const assetsToCreate: Array<{
      kind: "page_image" | "problem_crop";
      s3Key: string;
      format: "png" | "webp";
    }> = [];

    const pageImageKey = payload.pageImageS3Key;
    if (
      typeof pageImageKey === "string" &&
      pageImageKey &&
      !existingAssetKeys.has(pageImageKey)
    ) {
      assetsToCreate.push({
        kind: "page_image",
        s3Key: pageImageKey,
        format: "png",
      });
    }

    const problemImageKey = payload.problemImageS3Key;
    if (
      typeof problemImageKey === "string" &&
      problemImageKey &&
      !existingAssetKeys.has(problemImageKey)
    ) {
      assetsToCreate.push({
        kind: "problem_crop",
        s3Key: problemImageKey,
        format: "webp",
      });
    }

    for (const asset of assetsToCreate) {
      await this.prisma.problemAsset.create({
        data: {
          problemId,
          kind: asset.kind,
          s3Key: asset.s3Key,
          format: asset.format,
        },
      });
      existingAssetKeys.add(asset.s3Key);
    }
  }

  async materialize(
    ocrJobId: string,
    sourceFileId: string,
    problems: Array<Record<string, unknown>>,
  ): Promise<string[]> {
    const existingProblems = await this.prisma.problem.findMany({
      where: { ocrJobId },
      select: {
        id: true,
        problemNumber: true,
        displayNumber: true,
        startPage: true,
        endPage: true,
        stemLatex: true,
        stemText: true,
        assets: {
          select: { s3Key: true },
        },
      },
    });
    const existingByFingerprint = new Map<
      string,
      ExistingProblemRecord
    >(
      existingProblems.map((problem) => [
        this.buildProblemFingerprint(problem),
        problem,
      ]),
    );

    const createdIds: string[] = [];
    for (const p of problems) {
      try {
        const normalizedProblem = normalizeOcrProblem(p);
        const choices = normalizedProblem.choices;
        const fingerprint = this.buildProblemFingerprint({
          problemNumber: p.problemNumber,
          displayNumber: p.displayNumber,
          startPage: p.startPage,
          endPage: p.endPage,
          stemLatex: normalizedProblem.stemLatex,
          stemText: normalizedProblem.stemText,
        });
        const existingProblem = existingByFingerprint.get(fingerprint);

        if (existingProblem) {
          await this.ensureAssets(
            existingProblem.id,
            new Set(existingProblem.assets.map((asset) => asset.s3Key)),
            p,
          );
          continue;
        }
        const sanitizedBookSource = this.uploadPolicy.sanitizeBookSource(
          p.bookSource,
        );

        const created = await this.prisma.problem.create({
          data: {
            ocrJobId,
            sourceFileId,
            problemNumber:
              typeof p.problemNumber === "string" ? p.problemNumber : null,
            displayNumber:
              typeof p.displayNumber === "string" ? p.displayNumber : null,
            problemType: normalizedProblem.problemType,
            startPage: typeof p.startPage === "number" ? p.startPage : 0,
            endPage: typeof p.endPage === "number" ? p.endPage : 0,
            stemLatex: normalizedProblem.stemLatex,
            stemText: normalizedProblem.stemText,
            gradeLevel:
              typeof p.gradeLevel === "string" ? p.gradeLevel : null,
            subject: typeof p.subject === "string" ? p.subject : null,
            unitMajor:
              typeof p.unitMajor === "string" ? p.unitMajor : null,
            unitMinor:
              typeof p.unitMinor === "string" ? p.unitMinor : null,
            unitSub: typeof p.unitSub === "string" ? p.unitSub : null,
            difficulty:
              typeof p.difficulty === "number" ? p.difficulty : null,
            classificationConfidence:
              typeof p.classificationConfidence === "number"
                ? p.classificationConfidence
                : null,
            ...(sanitizedBookSource
              ? {
                  bookSource: sanitizedBookSource as any,
                }
              : {}),
            ...(p.examSource && typeof p.examSource === "object"
              ? { examSource: p.examSource as any }
              : {}),
            answerMatchStatus:
              typeof p.answerMatchStatus === "string"
                ? p.answerMatchStatus
                : null,
            solutionLatex:
              typeof p.solutionLatex === "string" ? p.solutionLatex : null,
            solutionText:
              typeof p.solutionText === "string" ? p.solutionText : null,
            ...(typeof p.answerText === "string"
              ? { answerText: p.answerText }
              : {}),
            reviewStatus: "pending_review",
            ...(choices && choices.length > 0
              ? {
                  choices: {
                    create: choices.map((c, i) => ({
                      position: c.position ?? i + 1,
                      label: c.label || `${i + 1}`,
                      contentLatex: c.contentLatex || "",
                      contentText: c.contentText || "",
                    })),
                  },
                }
              : {}),
          },
        });

        // Create ProblemAsset for page image if available
        const pageImageKey = p.pageImageS3Key;
        if (typeof pageImageKey === "string" && pageImageKey) {
          await this.prisma.problemAsset.create({
            data: {
              problemId: created.id,
              kind: "page_image",
              s3Key: pageImageKey,
              format: "png",
            },
          });
        }

        // Create ProblemAsset for cropped problem image if available
        const problemImageKey = p.problemImageS3Key;
        if (typeof problemImageKey === "string" && problemImageKey) {
          await this.prisma.problemAsset.create({
            data: {
              problemId: created.id,
              kind: "problem_crop",
              s3Key: problemImageKey,
              format: "webp",
            },
          });
        }

        createdIds.push(created.id);
        existingByFingerprint.set(fingerprint, {
          id: created.id,
          problemNumber:
            typeof p.problemNumber === "string" ? p.problemNumber : null,
          displayNumber:
            typeof p.displayNumber === "string" ? p.displayNumber : null,
          startPage: typeof p.startPage === "number" ? p.startPage : 0,
          endPage: typeof p.endPage === "number" ? p.endPage : 0,
          stemLatex: normalizedProblem.stemLatex,
          stemText: normalizedProblem.stemText,
          assets: [
            ...(typeof p.pageImageS3Key === "string" && p.pageImageS3Key
              ? [{ s3Key: p.pageImageS3Key }]
              : []),
            ...(typeof p.problemImageS3Key === "string" && p.problemImageS3Key
              ? [{ s3Key: p.problemImageS3Key }]
              : []),
          ],
        });
      } catch (error) {
        this.logger.error(
          `Failed to create problem record for job ${ocrJobId}`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }

    this.logger.log(
      `Created ${createdIds.length} problem records for OCR job ${ocrJobId}`,
    );
    return createdIds;
  }
}
