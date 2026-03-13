import {
  Injectable,
  BadRequestException,
  NotFoundException,
  InternalServerErrorException,
  ForbiddenException,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../prisma/prisma.service";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { basename } from "path";
import { randomUUID } from "crypto";
import { Redis } from "ioredis";
import { canAccessSubmission } from "../common/access-control";

const ALLOWED_IMAGE_MIME_TYPES = new Map<string, string>([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
]);

@Injectable()
export class SubmissionPhotosService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SubmissionPhotosService.name);
  private s3: S3Client;
  private redisPublisher: Redis;
  private redisSubscriber: Redis;
  private bucket: string;

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {
    const s3Region =
      this.config.get<string>("AWS_REGION") ??
      this.config.getOrThrow<string>("S3_REGION");
    const s3AccessKeyId =
      this.config.get<string>("AWS_ACCESS_KEY_ID") ??
      this.config.getOrThrow<string>("S3_ACCESS_KEY_ID");
    const s3SecretAccessKey =
      this.config.get<string>("AWS_SECRET_ACCESS_KEY") ??
      this.config.getOrThrow<string>("S3_SECRET_ACCESS_KEY");

    this.s3 = new S3Client({
      region: s3Region,
      credentials: {
        accessKeyId: s3AccessKeyId,
        secretAccessKey: s3SecretAccessKey,
      },
    });
    this.bucket = this.config.getOrThrow<string>("S3_BUCKET");
    const redisUrl = this.config.getOrThrow<string>("REDIS_URL");
    this.redisPublisher = new Redis(redisUrl);
    this.redisSubscriber = new Redis(redisUrl);
  }

  async onModuleInit() {
    await this.redisSubscriber.subscribe(
      "photo:analysis:completed",
      "photo:analysis:failed",
      "photo:rubric:completed",
      "photo:rubric:failed",
    );
    this.redisSubscriber.on("message", (channel, message) => {
      if (channel === "photo:analysis:completed") {
        void this.handleAnalysisCompleted(message);
      } else if (channel === "photo:analysis:failed") {
        void this.handleAnalysisFailed(message);
      } else if (channel === "photo:rubric:completed") {
        void this.handleRubricCompleted(message);
      } else if (channel === "photo:rubric:failed") {
        void this.handleRubricFailed(message);
      }
    });
  }

  async onModuleDestroy() {
    await Promise.allSettled([
      this.redisSubscriber.quit(),
      this.redisPublisher.quit(),
    ]);
  }

  private async handleAnalysisCompleted(message: string) {
    try {
      const payload = JSON.parse(message) as {
        submissionPhotoId: string;
        feedback: unknown;
      };
      await this.prisma.submissionPhoto.update({
        where: { id: payload.submissionPhotoId },
        data: {
          analysisStatus: "completed",
          aiFeedback: payload.feedback as any,
          analyzedAt: new Date(),
        },
      });
      this.logger.log(
        `Photo analysis completed for ${payload.submissionPhotoId}`,
      );
    } catch (error) {
      this.logger.error(
        "Failed to process photo:analysis:completed",
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private async handleAnalysisFailed(message: string) {
    try {
      const payload = JSON.parse(message) as {
        submissionPhotoId: string;
      };
      await this.prisma.submissionPhoto.update({
        where: { id: payload.submissionPhotoId },
        data: {
          analysisStatus: "failed",
        },
      });
      this.logger.warn(
        `Photo analysis failed for ${payload.submissionPhotoId}`,
      );
    } catch (error) {
      this.logger.error(
        "Failed to process photo:analysis:failed",
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private async handleRubricCompleted(message: string) {
    try {
      const payload = JSON.parse(message) as {
        submissionPhotoId: string;
        submissionAnswerId: string | null;
        problemId: string | null;
        rubricResult: unknown;
        rubricScore: number;
        rubricVersion: number;
      };

      // If we have a direct submissionAnswerId, update it
      if (payload.submissionAnswerId) {
        await this.prisma.submissionAnswer.update({
          where: { id: payload.submissionAnswerId },
          data: {
            rubricResult: payload.rubricResult as any,
            rubricScore: payload.rubricScore,
            rubricVersion: payload.rubricVersion,
          },
        });
        this.logger.log(
          `Rubric grading completed for answer ${payload.submissionAnswerId}: ${payload.rubricScore}/10`,
        );
        return;
      }

      // Otherwise, find the SubmissionAnswer via photo -> submission + problemId
      if (payload.problemId) {
        const photo = await this.prisma.submissionPhoto.findUnique({
          where: { id: payload.submissionPhotoId },
          select: { submissionId: true },
        });
        if (photo) {
          const answer = await this.prisma.submissionAnswer.findUnique({
            where: {
              submissionId_problemId: {
                submissionId: photo.submissionId,
                problemId: payload.problemId,
              },
            },
          });
          if (answer) {
            await this.prisma.submissionAnswer.update({
              where: { id: answer.id },
              data: {
                rubricResult: payload.rubricResult as any,
                rubricScore: payload.rubricScore,
                rubricVersion: payload.rubricVersion,
              },
            });
            this.logger.log(
              `Rubric grading completed for photo ${payload.submissionPhotoId} -> answer ${answer.id}: ${payload.rubricScore}/10`,
            );
            return;
          }
        }
      }

      this.logger.warn(
        `Rubric grading completed for photo ${payload.submissionPhotoId} but no matching SubmissionAnswer found`,
      );
    } catch (error) {
      this.logger.error(
        "Failed to process photo:rubric:completed",
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private async handleRubricFailed(message: string) {
    try {
      const payload = JSON.parse(message) as {
        submissionPhotoId: string;
        submissionAnswerId: string | null;
        reason: string;
      };
      this.logger.warn(
        `Rubric grading failed for photo ${payload.submissionPhotoId}: ${payload.reason}`,
      );
    } catch (error) {
      this.logger.error(
        "Failed to process photo:rubric:failed",
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  async uploadPhoto(
    submissionId: string,
    file: Express.Multer.File,
    requesterId: string,
    requesterRole: string,
  ) {
    const allowed = await canAccessSubmission(
      this.prisma,
      requesterId,
      requesterRole,
      submissionId,
    );
    if (!allowed) {
      throw new ForbiddenException("Not authorized to upload to this submission");
    }
    if (!file) {
      throw new BadRequestException("No photo provided");
    }

    const extension = ALLOWED_IMAGE_MIME_TYPES.get(file.mimetype);
    if (!extension) {
      throw new BadRequestException("Only JPG, PNG, and WEBP images are accepted");
    }

    const submission = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      include: {
        assignment: {
          include: {
            assignmentProblems: { orderBy: { orderIndex: "asc" } },
          },
        },
      },
    });
    if (!submission) throw new NotFoundException("Submission not found");

    const safeOriginalName = basename(file.originalname || `photo${extension}`)
      .normalize("NFC");
    const s3Key = `submissions/${submissionId}/${Date.now()}-${randomUUID()}${extension}`;
    try {
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: s3Key,
          Body: file.buffer,
          ContentType: file.mimetype,
        }),
      );
    } catch {
      throw new InternalServerErrorException("S3 upload failed");
    }

    const photo = await this.prisma.submissionPhoto.create({
      data: { submissionId, s3Key, originalName: safeOriginalName },
    });

    // Send all assignment problems so the worker can match the photo to the right item.
    const problemIds = submission.assignment.assignmentProblems.map(
      (ap) => ap.problemId,
    );
    let problemContexts: Array<{
      id: string;
      stemLatex: string;
      answerText: string | null;
      answerLatex: string | null;
      solutionSteps: unknown;
    }> = [];
    if (problemIds.length > 0) {
      const problems = await this.prisma.problem.findMany({
        where: { id: { in: problemIds } },
        select: {
          id: true,
          stemLatex: true,
          answerText: true,
          answerLatex: true,
          solutionSteps: true,
        },
      });
      const problemMap = new Map(problems.map((problem) => [problem.id, problem]));
      problemContexts = submission.assignment.assignmentProblems
        .map((assignmentProblem) => problemMap.get(assignmentProblem.problemId))
        .filter((problem): problem is NonNullable<typeof problem> => Boolean(problem));
    }

    const payload = {
      submissionPhotoId: photo.id,
      s3Key,
      problems: problemContexts,
    };
    await this.redisPublisher.publish(
      "photo:analyze",
      JSON.stringify(payload),
    );

    await this.prisma.submissionPhoto.update({
      where: { id: photo.id },
      data: { analysisStatus: "analyzing" },
    });

    return photo;
  }

  async getPhoto(photoId: string, requesterId: string, requesterRole: string) {
    const photo = await this.prisma.submissionPhoto.findUnique({
      where: { id: photoId },
      include: {
        submission: {
          select: { id: true, studentId: true },
        },
      },
    });
    if (!photo) throw new NotFoundException("Photo not found");
    const allowed = await canAccessSubmission(
      this.prisma,
      requesterId,
      requesterRole,
      photo.submission.id,
    );
    if (!allowed) {
      throw new ForbiddenException("Not authorized to access this photo");
    }

    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: photo.s3Key,
    });
    const url = await getSignedUrl(this.s3, command, { expiresIn: 900 });
    return { ...photo, url };
  }
}
