import {
  Controller,
  Post,
  Patch,
  Body,
  Res,
  UseGuards,
  Req,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Response } from "express";
import { AuthService } from "./auth.service";
import { RegisterDto } from "./dto/register.dto";
import { LoginDto } from "./dto/login.dto";
import { SocialLoginDto } from "./dto/social-login.dto";
import { UpdatePreferencesDto } from "./dto/update-preferences.dto";
import { AuthRateLimitGuard } from "./auth-rate-limit.guard";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { AUTH_COOKIE_NAME, buildAuthCookieOptions } from "./auth-cookie";

@Controller("auth")
export class AuthController {
  constructor(
    private auth: AuthService,
    private config: ConfigService,
  ) {}

  private setSessionCookie(res: Response, accessToken: string) {
    res.cookie(
      AUTH_COOKIE_NAME,
      accessToken,
      buildAuthCookieOptions(this.config.get("NODE_ENV") === "production"),
    );
  }

  @Post("register")
  @UseGuards(AuthRateLimitGuard)
  async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.register(dto);
    this.setSessionCookie(res, result.accessToken);
    return result;
  }

  @Post("login")
  @UseGuards(AuthRateLimitGuard)
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.login(dto);
    this.setSessionCookie(res, result.accessToken);
    return result;
  }

  @Post("social")
  @UseGuards(AuthRateLimitGuard)
  async socialLogin(
    @Body() dto: SocialLoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.socialLogin(dto);
    this.setSessionCookie(res, result.accessToken);
    return result;
  }

  @Post("logout")
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(
      AUTH_COOKIE_NAME,
      buildAuthCookieOptions(this.config.get("NODE_ENV") === "production"),
    );
    return { ok: true };
  }

  @Patch("me/preferences")
  @UseGuards(JwtAuthGuard)
  updatePreferences(
    @Req() req: { user: { id: string } },
    @Body() dto: UpdatePreferencesDto,
  ) {
    return this.auth.updatePreferences(req.user.id, dto);
  }
}
