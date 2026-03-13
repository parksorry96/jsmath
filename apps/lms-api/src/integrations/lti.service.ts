import {
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { PrismaService } from "../prisma/prisma.service";
import { RegisterPlatformDto } from "./dto/register-platform.dto";

/**
 * LTI 1.3 Provider Service
 *
 * Security hardening TODOs for production:
 * - TODO: Validate id_token signature against platform JWKS (fetch + cache keys)
 * - TODO: Enforce nonce uniqueness / replay-safe state param (Redis set with TTL)
 * - TODO: Validate iss, aud, exp, iat claims per IMS LTI 1.3 spec §4.1
 * - TODO: Implement PKCE / state param for OIDC login initiation flow
 * - TODO: Rotate our own RSA key pair and serve JWKS from database/secrets manager
 */
@Injectable()
export class LtiService {
  private readonly logger = new Logger(LtiService.name);

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private jwt: JwtService,
  ) {}

  async registerPlatform(dto: RegisterPlatformDto) {
    return this.prisma.ltiPlatform.upsert({
      where: { issuer: dto.issuer },
      create: {
        name: dto.name,
        issuer: dto.issuer,
        clientId: dto.clientId,
        authEndpoint: dto.authEndpoint,
        tokenEndpoint: dto.tokenEndpoint,
        jwksUri: dto.jwksUri,
        deploymentId: dto.deploymentId ?? null,
        isActive: true,
      },
      update: {
        name: dto.name,
        clientId: dto.clientId,
        authEndpoint: dto.authEndpoint,
        tokenEndpoint: dto.tokenEndpoint,
        jwksUri: dto.jwksUri,
        deploymentId: dto.deploymentId ?? null,
        isActive: true,
      },
    });
  }

  async listPlatforms() {
    return this.prisma.ltiPlatform.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        issuer: true,
        clientId: true,
        authEndpoint: true,
        tokenEndpoint: true,
        jwksUri: true,
        deploymentId: true,
        isActive: true,
        createdAt: true,
      },
    });
  }

  async getPlatform(id: string) {
    const platform = await this.prisma.ltiPlatform.findUnique({ where: { id } });
    if (!platform) throw new NotFoundException("LTI platform not found");
    return platform;
  }

  /**
   * Handle the LTI 1.3 OIDC launch id_token.
   *
   * In production this MUST:
   *  1. Fetch the platform JWKS from platform.jwksUri
   *  2. Validate the JWT signature
   *  3. Verify nonce against replay store
   * For now it performs structural decoding only and issues a session token.
   */
  async handleLaunch(idToken: string): Promise<{
    sessionToken: string;
    userId: string;
    contextId: string | null;
    resourceLinkId: string | null;
  }> {
    // TODO (production): replace with full JWKS-backed verification via jose
    let payload: Record<string, unknown>;
    try {
      // Decode without verification so we can read iss to look up platform
      const parts = idToken.split(".");
      if (parts.length !== 3) throw new Error("Malformed JWT");
      payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as Record<string, unknown>;
    } catch {
      throw new UnauthorizedException("Invalid LTI id_token format");
    }

    const issuer = payload["iss"] as string | undefined;
    if (!issuer) throw new UnauthorizedException("Missing iss claim");

    const platform = await this.prisma.ltiPlatform.findUnique({
      where: { issuer },
    });
    if (!platform || !platform.isActive) {
      throw new UnauthorizedException("Unknown or inactive LTI platform");
    }

    // TODO (production): verify JWT signature against platform.jwksUri here

    const sub = payload["sub"] as string | undefined;
    const email = (payload["email"] as string | undefined) ?? `lti-${sub}@${issuer}`;
    const name = (payload["name"] as string | undefined) ?? email;

    const contextClaim = payload["https://purl.imsglobal.org/spec/lti/claim/context"] as
      | Record<string, string>
      | undefined;
    const contextId = contextClaim?.["id"] ?? null;

    const resourceLinkClaim = payload[
      "https://purl.imsglobal.org/spec/lti/claim/resource_link"
    ] as Record<string, string> | undefined;
    const resourceLinkId = resourceLinkClaim?.["id"] ?? null;

    // Find or provision user
    let user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      user = await this.prisma.user.create({
        data: {
          email,
          name,
          passwordHash: "", // LTI users authenticate via platform, no local password
          role: "student",
        },
      });
      this.logger.log(`Provisioned LTI user ${user.id} for platform ${platform.id}`);
    }

    // Issue a short-lived JSMath session JWT (1 hour)
    const sessionToken = this.jwt.sign(
      { sub: user.id, email: user.email, role: user.role },
      { expiresIn: "1h" },
    );

    return { sessionToken, userId: user.id, contextId, resourceLinkId };
  }

  /**
   * AGS Grade Passback — POST a score to the platform's line item.
   *
   * TODO (production):
   *  - Obtain a platform access token via client_credentials grant
   *  - Use LTI Advantage AGS endpoint
   */
  async gradePassback(opts: {
    platformId: string;
    lineItemUrl: string;
    userId: string;
    score: number;
    maxScore: number;
  }): Promise<void> {
    const platform = await this.getPlatform(opts.platformId);

    this.logger.log(
      `[AGS] Grade passback to ${platform.name}: user=${opts.userId} score=${opts.score}/${opts.maxScore} lineItem=${opts.lineItemUrl}`,
    );

    // TODO (production): implement OAuth2 client_credentials flow to get access token,
    // then POST to opts.lineItemUrl + "/scores" with application/vnd.ims.lis.v1.score+json
    //
    // Example payload:
    // {
    //   "scoreGiven": opts.score,
    //   "scoreMaximum": opts.maxScore,
    //   "activityProgress": "Completed",
    //   "gradingProgress": "FullyGraded",
    //   "userId": opts.userId,
    //   "timestamp": new Date().toISOString(),
    // }
  }

  /**
   * Return our public JWKS so platforms can verify tokens we sign.
   *
   * TODO (production): store an RSA key pair, return the real public key here.
   */
  getJwks(): Record<string, unknown> {
    // TODO: generate and persist an RSA-2048 or ES256 key pair, return the public key as JWK
    return {
      keys: [
        {
          kty: "RSA",
          use: "sig",
          alg: "RS256",
          kid: "jsmath-lti-key-1",
          n: "TODO_replace_with_real_modulus",
          e: "AQAB",
        },
      ],
    };
  }
}
