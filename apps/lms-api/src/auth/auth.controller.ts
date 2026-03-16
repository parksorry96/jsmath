import {
  Controller,
  Post,
  Patch,
  Body,
  UseGuards,
  Req,
} from "@nestjs/common";
import { AuthService } from "./auth.service";
import { RegisterDto } from "./dto/register.dto";
import { LoginDto } from "./dto/login.dto";
import { SocialLoginDto } from "./dto/social-login.dto";
import { UpdatePreferencesDto } from "./dto/update-preferences.dto";
import { AuthRateLimitGuard } from "./auth-rate-limit.guard";
import { JwtAuthGuard } from "./jwt-auth.guard";

@Controller("auth")
export class AuthController {
  constructor(private auth: AuthService) {}

  @Post("register")
  @UseGuards(AuthRateLimitGuard)
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Post("login")
  @UseGuards(AuthRateLimitGuard)
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @Post("social")
  @UseGuards(AuthRateLimitGuard)
  socialLogin(@Body() dto: SocialLoginDto) {
    return this.auth.socialLogin(dto);
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
