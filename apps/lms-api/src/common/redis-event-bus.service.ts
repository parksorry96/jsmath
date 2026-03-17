import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Redis } from "ioredis";

const CHANNEL_TO_STREAM: Record<string, string> = {
  "ocr:submit": "stream:ocr:submit",
  "analysis:request": "stream:analysis:request",
  "photo:analyze": "stream:photo:analyze",
  "photo:rubric": "stream:photo:rubric",
};

const STREAM_MAXLEN = 10_000;

@Injectable()
export class RedisEventBusService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisEventBusService.name);
  private redis!: Redis;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    this.redis = new Redis(this.config.getOrThrow<string>("REDIS_URL"));
  }

  async onModuleDestroy() {
    await this.redis?.quit();
  }

  async publishDurable(
    channel: keyof typeof CHANNEL_TO_STREAM,
    payload: Record<string, unknown>,
  ) {
    const stream = CHANNEL_TO_STREAM[channel];
    const data = JSON.stringify(payload);

    try {
      await this.redis.xadd(
        stream,
        "MAXLEN",
        "~",
        STREAM_MAXLEN,
        "*",
        "data",
        data,
      );
    } catch (error) {
      this.logger.error(
        `Failed to publish ${channel} to ${stream}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }
}
