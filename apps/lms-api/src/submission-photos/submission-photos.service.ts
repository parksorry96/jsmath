import {
  Injectable,
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
import { Redis } from "ioredis";
import { canAccessSubmission } from "../common/access-control";

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
    await this.redisSubscriber.subscribe("photo:analysis:completed");
    this.redisSubscriber.on("message", (channel, message) => {
      if (channel === "photo:analysis:completed") {
        void this.handleAnalysisCompleted(message);
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

    const s3Key = `submissions/${submissionId}/${Date.now()}-${file.originalname}`;
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
      data: { submissionId, s3Key, originalName: file.originalname },
    });

    // Fetch problem context for Vision LLM
    const problemIds = submission.assignment.assignmentProblems.map(
      (ap) => ap.problemId,
    );
    let problemContext: {
      id: string;
      stemLatex: string;
      answerText: string | null;
      answerLatex: string | null;
      solutionSteps: unknown;
    } | null = null;
    if (problemIds.length > 0) {
      problemContext = await this.prisma.problem.findFirst({
        where: { id: { in: problemIds } },
        select: {
          id: true,
          stemLatex: true,
          answerText: true,
          answerLatex: true,
          solutionSteps: true,
        },
      });
    }

    const payload = {
      submissionPhotoId: photo.id,
      s3Key,
      problemId: problemContext?.id ?? null,
      problemStemLatex: problemContext?.stemLatex ?? "",
      answerText: problemContext?.answerText ?? null,
      answerLatex: problemContext?.answerLatex ?? null,
      solutionSteps: problemContext?.solutionSteps ?? null,
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
