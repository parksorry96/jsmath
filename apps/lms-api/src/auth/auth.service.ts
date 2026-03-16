import {
  Injectable,
  ConflictException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcrypt";
import * as jose from "jose";
import { PrismaService } from "../prisma/prisma.service";
import { RegisterDto } from "./dto/register.dto";
import { LoginDto } from "./dto/login.dto";
import { SocialLoginDto } from "./dto/social-login.dto";
import { UpdatePreferencesDto } from "./dto/update-preferences.dto";

interface SocialProfile {
  provider: "kakao" | "apple" | "google";
  providerAccountId: string;
  email: string | null;
  name: string | null;
}

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private config: ConfigService,
  ) {}

  async register(dto: RegisterDto) {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existing) throw new ConflictException("Email already registered");

    const hash = await bcrypt.hash(dto.password, 10);
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        name: dto.name,
        passwordHash: hash,
        role: "student",
      },
    });

    return this.issueToken(user.id, user.email, user.role);
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (!user || !user.passwordHash)
      throw new UnauthorizedException("Invalid credentials");

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) throw new UnauthorizedException("Invalid credentials");

    return this.issueToken(user.id, user.email, user.role);
  }

  async socialLogin(dto: SocialLoginDto) {
    const profile = await this.verifySocialToken(dto.provider, dto.accessToken);

    // Find existing user by provider+providerAccountId
    const existing = await this.prisma.user.findUnique({
      where: {
        provider_providerAccountId: {
          provider: profile.provider,
          providerAccountId: profile.providerAccountId,
        },
      },
    });

    if (existing) {
      return { ...this.issueToken(existing.id, existing.email, existing.role), isNewUser: false };
    }

    // If email matches an existing account, link the social provider
    if (profile.email) {
      const emailUser = await this.prisma.user.findUnique({
        where: { email: profile.email },
      });
      if (emailUser) {
        const updated = await this.prisma.user.update({
          where: { id: emailUser.id },
          data: {
            provider: profile.provider,
            providerAccountId: profile.providerAccountId,
          },
        });
        return { ...this.issueToken(updated.id, updated.email, updated.role), isNewUser: false };
      }
    }

    // Create new user
    const email =
      profile.email ??
      `${profile.provider}_${profile.providerAccountId}@social.jsmath.local`;
    const user = await this.prisma.user.create({
      data: {
        email,
        name: profile.name ?? profile.provider + " user",
        provider: profile.provider,
        providerAccountId: profile.providerAccountId,
        role: "student",
      },
    });

    return { ...this.issueToken(user.id, user.email, user.role), isNewUser: true };
  }

  async updatePreferences(userId: string, dto: UpdatePreferencesDto) {
    const data: Record<string, unknown> = {};
    if (dto.gradeLevel !== undefined) data.gradeLevel = dto.gradeLevel;
    if (dto.curriculumYear !== undefined)
      data.curriculumYear = dto.curriculumYear;

    const user = await this.prisma.user.update({
      where: { id: userId },
      data,
      select: {
        id: true,
        email: true,
        name: true,
        gradeLevel: true,
        curriculumYear: true,
      },
    });
    return user;
  }

  private async verifySocialToken(
    provider: string,
    token: string,
  ): Promise<SocialProfile> {
    switch (provider) {
      case "kakao":
        return this.verifyKakao(token);
      case "apple":
        return this.verifyApple(token);
      case "google":
        return this.verifyGoogle(token);
      default:
        throw new UnauthorizedException(`Unsupported provider: ${provider}`);
    }
  }

  private async verifyKakao(accessToken: string): Promise<SocialProfile> {
    const res = await fetch("https://kapi.kakao.com/v2/user/me", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new UnauthorizedException("Invalid Kakao token");

    const data = (await res.json()) as {
      id: number;
      kakao_account?: { email?: string; profile?: { nickname?: string } };
    };
    return {
      provider: "kakao",
      providerAccountId: String(data.id),
      email: data.kakao_account?.email ?? null,
      name: data.kakao_account?.profile?.nickname ?? null,
    };
  }

  private async verifyApple(identityToken: string): Promise<SocialProfile> {
    const JWKS = jose.createRemoteJWKSet(
      new URL("https://appleid.apple.com/auth/keys"),
    );
    const { payload } = await jose.jwtVerify(identityToken, JWKS, {
      issuer: "https://appleid.apple.com",
      audience: this.config.getOrThrow<string>("APPLE_CLIENT_ID"),
    }).catch(() => {
      throw new UnauthorizedException("Invalid Apple token");
    });

    return {
      provider: "apple",
      providerAccountId: payload.sub!,
      email: (payload.email as string) ?? null,
      name: null,
    };
  }

  private async verifyGoogle(accessToken: string): Promise<SocialProfile> {
    const res = await fetch(
      "https://www.googleapis.com/oauth2/v3/userinfo",
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!res.ok) throw new UnauthorizedException("Invalid Google token");

    const data = (await res.json()) as {
      sub: string;
      email?: string;
      name?: string;
    };
    return {
      provider: "google",
      providerAccountId: data.sub,
      email: data.email ?? null,
      name: data.name ?? null,
    };
  }

  private issueToken(userId: string, email: string, role: string) {
    const payload = { sub: userId, email, role };
    return { accessToken: this.jwt.sign(payload) };
  }
}
