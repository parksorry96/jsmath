import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { LtiService } from "./lti.service";
import { LtiController } from "./lti.controller";
import { QtiExportService } from "./qti-export.service";
import { QtiController } from "./qti.controller";

@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>("JWT_SECRET"),
        signOptions: { expiresIn: config.get("JWT_EXPIRES_IN", "7d") },
      }),
    }),
  ],
  controllers: [LtiController, QtiController],
  providers: [LtiService, QtiExportService],
})
export class IntegrationsModule {}
