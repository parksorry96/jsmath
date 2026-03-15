import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHash } from "crypto";
import { Redis } from "ioredis";
import { PrismaService } from "../prisma/prisma.service";
import { OcrProblemMaterializerService } from "./ocr-problem-materializer.service";

@Injectable()
export class OcrPipelineEventHandlerService implements OnModuleDestroy {
  private readonly logger = new Logger(OcrPipelineEventHandlerService.name);
  private readonly recentlyHandled = new Map<string, number>();
  private readonly redisPublisher: Redis;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly materializer: OcrProblemMaterializerService,
  ) {
    const redisUrl = this.config.getOrThrow<string>("REDIS_URL");
    this.redisPublisher = new Redis(redisUrl);
  }

  async onModuleDestroy() {
    await this.redisPublisher.quit();
  }

  async handle(channel: string, message: string) {
    try {
      const payload = JSON.parse(message) as {
        ocrJobId?: string;
        problemIds?: string[];
        problemCount?: unknown;
        problems?: Array<Record<string, unknown>>;
        reason?: unknown;
      };

      const key = `${channel}:${createHash("sha1").update(message).digest("hex")}`;
      const now = Date.now();

      // Dedup guard: skip if same event was handled within 30s
      if (
        this.recentlyHandled.has(key) &&
        now - this.recentlyHandled.get(key)! < 30_000
      ) {
        this.logger.debug(`Deduplicated event: ${key}`);
        return;
      }
      this.recentlyHandled.set(key, now);
      // Prune stale entries
      for (const [k, ts] of this.recentlyHandled) {
        if (now - ts > 30_000) this.recentlyHandled.delete(k);
      }

      const isAnalysisEvent =
        channel === "analysis:completed" || channel === "analysis:failed";
      if (!payload.ocrJobId && !isAnalysisEvent) {
        this.logger.warn(`Ignored ${channel}: missing ocrJobId`);
        return;
      }

      if (channel === "ocr:completed") {
        const maybeCount = payload.problemCount;
        const job = await this.prisma.ocrJob.update({
          where: { id: payload.ocrJobId },
          data: {
            status: "completed",
            problemCount:
              typeof maybeCount === "number" ? maybeCount : undefined,
            errorMessage: null,
            completedAt: new Date(),
          },
        });

        // Create Problem records from pipeline results
        if (
          Array.isArray(payload.problems) &&
          payload.problems.length > 0
        ) {
          await this.materializer.materialize(
            payload.ocrJobId!,
            job.sourceFileId,
            payload.problems,
          );
        }

        if (!job.autoAnalyze) {
          this.logger.log(
            `Skipped auto analysis for ${payload.ocrJobId} because autoAnalyze=false`,
          );
          return;
        }

        const analysisCandidates = await this.prisma.problem.findMany({
          where: {
            ocrJobId: payload.ocrJobId,
            analysisStatus: { in: ["pending", "failed"] },
          },
          select: { id: true },
        });
        const analysisProblemIds = analysisCandidates.map((problem) => problem.id);

        if (analysisProblemIds.length > 0) {
          await this.prisma.problem.updateMany({
            where: {
              id: { in: analysisProblemIds },
              analysisStatus: { in: ["pending", "failed"] },
            },
            data: { analysisStatus: "analyzing" },
          });
          await this.redisPublisher.publish(
            "analysis:request",
            JSON.stringify({
              ocrJobId: payload.ocrJobId,
              problemIds: analysisProblemIds,
            }),
          );
          this.logger.log(
            `Auto-triggered analysis for ${analysisProblemIds.length} problems (job ${payload.ocrJobId})`,
          );
        }
        return;
      }

      if (channel === "ocr:failed") {
        await this.prisma.ocrJob.update({
          where: { id: payload.ocrJobId },
          data: {
            status: "failed",
            errorMessage:
              typeof payload.reason === "string"
                ? payload.reason
                : "OCR pipeline failed",
            completedAt: new Date(),
          },
        });
        return;
      }

      if (channel === "analysis:completed") {
        const ids = Array.isArray(payload.problemIds)
          ? payload.problemIds
          : [];
        if (ids.length > 0) {
          await this.prisma.problem.updateMany({
            where: { id: { in: ids }, analysisStatus: { not: "completed" } },
            data: { analysisStatus: "completed", analyzedAt: new Date() },
          });
          this.logger.log(
            `analysis:completed for ${ids.length} problems`,
          );
        }
        return;
      }

      if (channel === "analysis:failed") {
        const ids = Array.isArray(payload.problemIds)
          ? payload.problemIds
          : [];
        if (ids.length > 0) {
          await this.prisma.problem.updateMany({
            where: { id: { in: ids } },
            data: { analysisStatus: "failed" },
          });
          this.logger.warn(
            `analysis:failed for ${ids.length} problems`,
          );
        }
        return;
      }
    } catch (error) {
      this.logger.error(
        `Failed to process OCR event on channel ${channel}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
