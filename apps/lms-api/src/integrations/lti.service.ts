import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  NotImplementedException,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { createHash } from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import { RegisterPlatformDto } from "./dto/register-platform.dto";
import {
  createRemoteJWKSet,
  decodeJwt,
  decodeProtectedHeader,
  jwtVerify,
  type JWTPayload,
  type JWTVerifyResult,
} from "jose";

const LTI_VERSION_CLAIM = "https://purl.imsglobal.org/spec/lti/claim/version";
const LTI_MESSAGE_TYPE_CLAIM =
  "https://purl.imsglobal.org/spec/lti/claim/message_type";
const LTI_DEPLOYMENT_ID_CLAIM =
  "https://purl.imsglobal.org/spec/lti/claim/deployment_id";
const LTI_CONTEXT_CLAIM = "https://purl.imsglobal.org/spec/lti/claim/context";
const LTI_RESOURCE_LINK_CLAIM =
  "https://purl.imsglobal.org/spec/lti/claim/resource_link";
const LTI_ROLES_CLAIM = "https://purl.imsglobal.org/spec/lti/claim/roles";
const SUPPORTED_LTI_MESSAGE_TYPES = new Set([
  "LtiResourceLinkRequest",
  "LtiDeepLinkingRequest",
]);
const SUPPORTED_LTI_ALGORITHMS: string[] = [
  "RS256",
  "RS384",
  "RS512",
  "ES256",
  "ES384",
  "ES512",
];

type LtiPayload = JWTPayload & Record<string, unknown>;

/**
 * LTI 1.3 Provider Service
 *
 * - TODO: Implement PKCE / state param for OIDC login initiation flow
 * - TODO: Rotate our own RSA key pair and serve a real JWKS from database/secrets manager
 */
@Injectable()
export class LtiService {
  private readonly logger = new Logger(LtiService.name);
  private readonly remoteJwkSets = new Map<
    string,
    ReturnType<typeof createRemoteJWKSet>
  >();
  private readonly seenNonces = new Map<string, number>();

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
   * Verifies the launch token against the registered platform JWKS and then
   * provisions or reuses a local JSMath user.
   */
  async handleLaunch(idToken: string): Promise<{
    sessionToken: string;
    userId: string;
    contextId: string | null;
    resourceLinkId: string | null;
  }> {
    if (!idToken?.trim()) {
      throw new UnauthorizedException("Missing LTI id_token");
    }

    let unverifiedPayload: LtiPayload;
    try {
      const protectedHeader = decodeProtectedHeader(idToken);
      if (
        typeof protectedHeader.alg !== "string" ||
        !SUPPORTED_LTI_ALGORITHMS.includes(protectedHeader.alg)
      ) {
        throw new UnauthorizedException("Unsupported LTI signing algorithm");
      }
      unverifiedPayload = decodeJwt(idToken) as LtiPayload;
    } catch {
      throw new UnauthorizedException("Invalid LTI id_token format");
    }

    const issuer =
      typeof unverifiedPayload.iss === "string" ? unverifiedPayload.iss : undefined;
    if (!issuer) throw new UnauthorizedException("Missing iss claim");

    const platform = await this.prisma.ltiPlatform.findUnique({
      where: { issuer },
    });
    if (!platform || !platform.isActive) {
      throw new UnauthorizedException("Unknown or inactive LTI platform");
    }

    let verifiedToken: JWTVerifyResult<LtiPayload>;
    try {
      verifiedToken = await jwtVerify(
        idToken,
        this.getRemoteJwkSet(platform.jwksUri),
        {
          issuer: platform.issuer,
          audience: platform.clientId,
          algorithms: SUPPORTED_LTI_ALGORITHMS,
          maxTokenAge: "5m",
          clockTolerance: 30,
        },
      );
    } catch (error) {
      this.logger.warn(
        `Failed to verify LTI launch for issuer=${platform.issuer}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw new UnauthorizedException("Failed to verify LTI id_token");
    }

    const payload = verifiedToken.payload;
    this.assertRequiredClaims(payload, platform.deploymentId ?? null);

    const sub = payload.sub;
    if (!sub) {
      throw new UnauthorizedException("Missing sub claim");
    }

    this.assertFreshNonce(platform.id, payload.nonce);

    const claimedEmail =
      typeof payload.email === "string" && payload.email.length > 0
        ? payload.email
        : null;
    const email =
      claimedEmail ?? this.buildSyntheticEmail(platform.id, sub);
    const name =
      typeof payload.name === "string" && payload.name.length > 0
        ? payload.name
        : email;
    const role = this.resolveUserRole(payload[LTI_ROLES_CLAIM]);

    const contextClaim = payload[LTI_CONTEXT_CLAIM] as
      | Record<string, string>
      | undefined;
    const contextId = contextClaim?.["id"] ?? null;

    const resourceLinkClaim = payload[LTI_RESOURCE_LINK_CLAIM] as
      | Record<string, string>
      | undefined;
    const resourceLinkId = resourceLinkClaim?.["id"] ?? null;

    const identity = await this.prisma.ltiIdentity.findUnique({
      where: {
        platformId_subject: {
          platformId: platform.id,
          subject: sub,
        },
      },
      include: { user: true },
    });

    let user = identity?.user ?? null;
    if (user) {
      if (user.role !== "admin" && user.role !== role) {
        user = await this.prisma.user.update({
          where: { id: user.id },
          data: { role, name },
        });
      } else if (user.name !== name) {
        user = await this.prisma.user.update({
          where: { id: user.id },
          data: { name },
        });
      }

      if (identity && identity.email !== claimedEmail) {
        await this.prisma.ltiIdentity.update({
          where: { id: identity.id },
          data: { email: claimedEmail },
        });
      }
    } else {
      const existingUser = claimedEmail
        ? await this.prisma.user.findUnique({ where: { email: claimedEmail } })
        : null;
      if (existingUser) {
        throw new ConflictException(
          "Local account linking is required before this LTI user can sign in",
        );
      }

      user = await this.prisma.user.create({
        data: {
          email,
          name,
          passwordHash: "!lti-no-local-auth", // invalid bcrypt hash — LTI users cannot log in locally
          role,
        },
      });

      await this.prisma.ltiIdentity.create({
        data: {
          platformId: platform.id,
          userId: user.id,
          subject: sub,
          email: claimedEmail,
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

    throw new NotImplementedException(
      "LTI grade passback is not implemented yet",
    );
  }

  /**
   * Return our public JWKS so platforms can verify tokens we sign.
   *
   * TODO (production): store an RSA key pair and return the real public key here.
   */
  getJwks(): Record<string, unknown> {
    throw new ServiceUnavailableException("LTI JWKS is not configured");
  }

  private getRemoteJwkSet(jwksUri: string) {
    let jwks = this.remoteJwkSets.get(jwksUri);
    if (!jwks) {
      jwks = createRemoteJWKSet(new URL(jwksUri));
      this.remoteJwkSets.set(jwksUri, jwks);
    }
    return jwks;
  }

  private assertRequiredClaims(
    payload: LtiPayload,
    expectedDeploymentId: string | null,
  ) {
    if (payload[LTI_VERSION_CLAIM] !== "1.3.0") {
      throw new UnauthorizedException("Unsupported LTI version");
    }

    const messageType = payload[LTI_MESSAGE_TYPE_CLAIM];
    if (
      typeof messageType !== "string" ||
      !SUPPORTED_LTI_MESSAGE_TYPES.has(messageType)
    ) {
      throw new UnauthorizedException("Unsupported LTI message type");
    }

    if (typeof payload.nonce !== "string" || payload.nonce.length === 0) {
      throw new UnauthorizedException("Missing nonce claim");
    }

    if (expectedDeploymentId) {
      const deploymentId = payload[LTI_DEPLOYMENT_ID_CLAIM];
      if (deploymentId !== expectedDeploymentId) {
        throw new UnauthorizedException("Unexpected LTI deployment_id");
      }
    }
  }

  private assertFreshNonce(platformId: string, nonce: unknown) {
    if (typeof nonce !== "string" || nonce.length === 0) {
      throw new UnauthorizedException("Missing nonce claim");
    }

    const now = Date.now();
    for (const [key, expiresAt] of this.seenNonces.entries()) {
      if (expiresAt <= now) {
        this.seenNonces.delete(key);
      }
    }

    const cacheKey = `${platformId}:${nonce}`;
    const existing = this.seenNonces.get(cacheKey);
    if (existing && existing > now) {
      throw new UnauthorizedException("Replay detected for LTI nonce");
    }

    this.seenNonces.set(cacheKey, now + 5 * 60 * 1000);
  }

  private buildSyntheticEmail(platformId: string, subject: string) {
    const digest = createHash("sha256")
      .update(`${platformId}:${subject}`)
      .digest("hex")
      .slice(0, 24);
    return `lti-${digest}@lti.local`;
  }

  private resolveUserRole(rawRoles: unknown): "teacher" | "student" {
    if (!Array.isArray(rawRoles)) {
      return "student";
    }

    const roles = rawRoles
      .filter((role): role is string => typeof role === "string")
      .map((role) => role.toLowerCase());

    if (
      roles.some((role) =>
        role.includes("instructor") || role.includes("administrator"),
      )
    ) {
      return "teacher";
    }

    return "student";
  }
}
