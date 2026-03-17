import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Redis } from "ioredis";

const CONSUMER_GROUP = "lms-api";
const CONSUMER_NAME = `lms-api-${process.pid}`;
const BLOCK_MS = 5000;
const BATCH_SIZE = 10;

/** Streams that NestJS (LMS-API) consumes — FastAPI → NestJS direction. */
const INBOUND_STREAMS = [
  "stream:ocr:completed",
  "stream:ocr:failed",
  "stream:analysis:completed",
  "stream:analysis:failed",
  "stream:photo:analysis:completed",
  "stream:photo:analysis:failed",
  "stream:photo:rubric:completed",
  "stream:photo:rubric:failed",
] as const;

/** Map stream name → legacy Pub/Sub channel name for handler dispatch. */
const STREAM_TO_CHANNEL: Record<string, string> = {
  "stream:ocr:completed": "ocr:completed",
  "stream:ocr:failed": "ocr:failed",
  "stream:analysis:completed": "analysis:completed",
  "stream:analysis:failed": "analysis:failed",
  "stream:photo:analysis:completed": "photo:analysis:completed",
  "stream:photo:analysis:failed": "photo:analysis:failed",
  "stream:photo:rubric:completed": "photo:rubric:completed",
  "stream:photo:rubric:failed": "photo:rubric:failed",
};

export type StreamHandler = (
  channel: string,
  message: string,
) => void | Promise<void>;

@Injectable()
export class RedisStreamService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisStreamService.name);
  private redis: Redis;
  private running = false;
  private handlers: StreamHandler[] = [];

  constructor(private config: ConfigService) {}

  /** Register a handler that receives (channel, rawJsonMessage) for each stream event. */
  onMessage(handler: StreamHandler) {
    this.handlers.push(handler);
  }

  private async processStreamMessage(
    streamName: string,
    msgId: string,
    fields: string[],
  ) {
    const channel = STREAM_TO_CHANNEL[streamName] ?? streamName;
    const dataIndex = fields.indexOf("data");
    const raw = dataIndex >= 0 ? fields[dataIndex + 1] : "{}";

    for (const handler of this.handlers) {
      await handler(channel, raw);
    }

    await this.redis.xack(streamName, CONSUMER_GROUP, msgId);
  }

  async onModuleInit() {
    const redisUrl = this.config.getOrThrow<string>("REDIS_URL");
    this.redis = new Redis(redisUrl);

    await this.ensureConsumerGroups();

    this.running = true;
    void this.consumeLoop();
  }

  async onModuleDestroy() {
    this.running = false;
    await this.redis.quit();
  }

  private async ensureConsumerGroups() {
    for (const stream of INBOUND_STREAMS) {
      try {
        await this.redis.xgroup("CREATE", stream, CONSUMER_GROUP, "0", "MKSTREAM");
        this.logger.log(`Created consumer group ${CONSUMER_GROUP} on ${stream}`);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        if (!message.includes("BUSYGROUP")) {
          throw err;
        }
      }
    }
  }

  private async consumeLoop() {
    while (this.running) {
      try {
        const streamNames = [...INBOUND_STREAMS];
        const streamIds = INBOUND_STREAMS.map(() => ">");
        const results = await this.redis.xreadgroup(
          "GROUP",
          CONSUMER_GROUP,
          CONSUMER_NAME,
          "COUNT",
          BATCH_SIZE,
          "BLOCK",
          BLOCK_MS,
          "STREAMS",
          ...streamNames,
          ...streamIds,
        );

        if (!results) continue;

        for (const [streamName, messages] of results as [string, [string, string[]][]][]) {
          for (const [msgId, fields] of messages) {
            try {
              await this.processStreamMessage(streamName, msgId, fields);
            } catch (err) {
              this.logger.error(
                `Failed to process stream ${streamName} msg ${msgId}`,
                err instanceof Error ? err.stack : String(err),
              );
            }
          }
        }
      } catch (err) {
        if (!this.running) break;
        this.logger.error(
          "Stream consume loop error; retrying in 5s",
          err instanceof Error ? err.stack : String(err),
        );
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  }
}
