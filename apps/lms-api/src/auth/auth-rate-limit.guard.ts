import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

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
export class AuthRateLimitGuard implements CanActivate {
  private readonly attempts = new Map<string, RateLimitBucket>();
  private readonly maxAttempts: number;
  private readonly windowMs: number;

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
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestLike>();
    const now = Date.now();

    this.pruneExpiredBuckets(now);

    const keys = this.getRateLimitKeys(request);
    for (const key of keys) {
      const current = this.attempts.get(key);
      if (current && current.resetAt > now && current.count >= this.maxAttempts) {
        throw new HttpException(
          "Too many authentication attempts. Please try again later.",
          HttpStatus.TOO_MANY_REQUESTS,
        );
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

    return true;
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
