import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Redis } from "ioredis";
import { RedisStreamService } from "../common/redis-stream.service";
import { OcrPipelineEventHandlerService } from "./ocr-pipeline-event-handler.service";
import { PipelineProgressService } from "../files/pipeline-progress.service";

@Injectable()
export class OcrPipelineEventConsumerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(OcrPipelineEventConsumerService.name);
  private redisSubscriber: Redis;

  constructor(
    private readonly config: ConfigService,
    private readonly redisStream: RedisStreamService,
    private readonly handler: OcrPipelineEventHandlerService,
    private readonly progress: PipelineProgressService,
  ) {}

  async onModuleInit() {
    const redisUrl = this.config.getOrThrow<string>("REDIS_URL");
    this.redisSubscriber = new Redis(redisUrl);

    // Pub/Sub: ONLY for pipeline:progress (fire-and-forget SSE)
    await this.redisSubscriber.subscribe("pipeline:progress");
    this.redisSubscriber.on("message", (channel, message) => {
      if (channel === "pipeline:progress") {
        try {
          this.progress.emit(JSON.parse(message));
        } catch {
          /* progress is best-effort */
        }
      }
    });

    // Streams: durable events (ocr:completed, ocr:failed, analysis:completed, analysis:failed)
    this.redisStream.onMessage((channel, message) => {
      const durable = [
        "ocr:completed",
        "ocr:failed",
        "analysis:completed",
        "analysis:failed",
      ];
      if (durable.includes(channel)) {
        void this.handler.handle(channel, message);
      }
    });

    this.logger.log("OCR pipeline event consumer initialized");
  }

  async onModuleDestroy() {
    await this.redisSubscriber?.quit();
  }
}
