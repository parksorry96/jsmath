import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { PassportModule } from "@nestjs/passport";
import { AuthService } from "./auth.service";
import { AuthController } from "./auth.controller";
import { JwtStrategy } from "./jwt.strategy";
import { PrismaModule } from "../prisma/prisma.module";
import { AuthRateLimitGuard } from "./auth-rate-limit.guard";

@Module({
  imports: [PrismaModule, PassportModule, ConfigModule],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, AuthRateLimitGuard],
  exports: [AuthService],
})
export class AuthModule {}
