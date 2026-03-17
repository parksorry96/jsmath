import { HttpException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AuthRateLimitGuard } from "./auth-rate-limit.guard";

function createContext(request: Record<string, unknown>) {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as never;
}

describe("AuthRateLimitGuard", () => {
  function createGuard(maxAttempts = 1) {
    return new AuthRateLimitGuard(
      new ConfigService({
        AUTH_RATE_LIMIT_MAX: String(maxAttempts),
        AUTH_RATE_LIMIT_WINDOW_MS: "60000",
      }),
    );
  }

  it("does not trust spoofed x-forwarded-for headers", async () => {
    const guard = createGuard();

    await expect(
      guard.canActivate(
        createContext({
          ip: "10.0.0.1",
          headers: { "x-forwarded-for": "203.0.113.10" },
          route: { path: "/auth/login" },
        }),
      ),
    ).resolves.toBe(true);

    await expect(
      guard.canActivate(
        createContext({
          ip: "10.0.0.1",
          headers: { "x-forwarded-for": "203.0.113.11" },
          route: { path: "/auth/login" },
        }),
      ),
    ).rejects.toThrow(HttpException);
  });

  it("rate limits repeated attempts for the same email across different IPs", async () => {
    const guard = createGuard();

    await expect(
      guard.canActivate(
        createContext({
          ip: "10.0.0.1",
          route: { path: "/auth/login" },
          body: { email: "student@example.com" },
        }),
      ),
    ).resolves.toBe(true);

    await expect(
      guard.canActivate(
        createContext({
          ip: "10.0.0.2",
          route: { path: "/auth/login" },
          body: { email: "student@example.com" },
        }),
      ),
    ).rejects.toThrow(HttpException);
  });
});
