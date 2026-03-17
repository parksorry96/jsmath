import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  OnModuleDestroy,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Redis } from "ioredis";

interface RequestLike {
  headers?: Record<string, string | string[] | undefined>;
  ip?: string;
  ips?: string[];
  originalUrl?: string;
  route?: { path?: string };
  url?: string;
  body?: Record<string, unknown>;
}

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

@Injectable()
export class AuthRateLimitGuard implements CanActivate, OnModuleDestroy {
  private readonly logger = new Logger(AuthRateLimitGuard.name);
  private readonly attempts = new Map<string, RateLimitBucket>();
  private readonly maxAttempts: number;
  private readonly windowMs: number;
  private readonly redis?: Redis;

  constructor(config: ConfigService) {
    const configuredMaxAttempts = Number.parseInt(
      config.get("AUTH_RATE_LIMIT_MAX", "5"),
      10,
    );
    const configuredWindowMs = Number.parseInt(
      config.get("AUTH_RATE_LIMIT_WINDOW_MS", "60000"),
      10,
    );

    this.maxAttempts = Number.isFinite(configuredMaxAttempts) && configuredMaxAttempts > 0
      ? configuredMaxAttempts
      : 5;
    this.windowMs = Number.isFinite(configuredWindowMs) && configuredWindowMs > 0
      ? configuredWindowMs
      : 60_000;

    const redisUrl = config.get<string>("REDIS_URL");
    if (redisUrl) {
      this.redis = new Redis(redisUrl, { lazyConnect: true });
    }
  }

  async onModuleDestroy() {
    await this.redis?.quit();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestLike>();
    const keys = this.getRateLimitKeys(request);
    const limited = this.redis
      ? await this.isRedisRateLimited(keys)
      : this.isMemoryRateLimited(keys, Date.now());

    if (limited) {
      throw new HttpException(
        "Too many authentication attempts. Please try again later.",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }

  private isMemoryRateLimited(keys: string[], now: number) {
    this.pruneExpiredBuckets(now);

    for (const key of keys) {
      const current = this.attempts.get(key);
      if (current && current.resetAt > now && current.count >= this.maxAttempts) {
        return true;
      }
    }

    for (const key of keys) {
      const current = this.attempts.get(key);
      if (!current || current.resetAt <= now) {
        this.attempts.set(key, { count: 1, resetAt: now + this.windowMs });
        continue;
      }

      current.count += 1;
    }

    return false;
  }

  private async isRedisRateLimited(keys: string[]) {
    try {
      if (this.redis!.status === "wait") {
        await this.redis!.connect();
      }
      const counts = await Promise.all(
        keys.map(async (key) => {
          const namespaced = `auth-rate-limit:${key}`;
          const count = await this.redis!.incr(namespaced);
          if (count === 1) {
            await this.redis!.pexpire(namespaced, this.windowMs);
          }
          return count;
        }),
      );

      return counts.some((count) => count > this.maxAttempts);
    } catch (error) {
      this.logger.warn(
        "Redis rate limit failed; falling back to in-memory buckets",
        error instanceof Error ? error.message : String(error),
      );
      return this.isMemoryRateLimited(keys, Date.now());
    }
  }

  private getRateLimitKeys(request: RequestLike): string[] {
    const route = request.route?.path ?? request.originalUrl ?? request.url ?? "auth";
    const ip = this.getClientIp(request);
    const keys = [`ip:${ip}:${route}`];
    const email = this.getNormalizedEmail(request);

    if (email) {
      keys.push(`email:${email}:${route}`);
    }

    return keys;
  }

  private getClientIp(request: RequestLike): string {
    if (request.ips?.length) {
      const [firstHop] = request.ips;
      if (firstHop) {
        return firstHop;
      }
    }

    return request.ip ?? "unknown";
  }

  private getNormalizedEmail(request: RequestLike): string | null {
    const email = request.body?.email;
    if (typeof email !== "string") {
      return null;
    }

    const normalized = email.trim().toLowerCase();
    return normalized.length > 0 ? normalized : null;
  }

  private pruneExpiredBuckets(now: number) {
    for (const [key, bucket] of this.attempts.entries()) {
      if (bucket.resetAt <= now) {
        this.attempts.delete(key);
      }
    }
  }
}
