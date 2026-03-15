import { Module } from "@nestjs/common";
import { LtiService } from "./lti.service";
import { LtiController } from "./lti.controller";
import { QtiExportService } from "./qti-export.service";
import { QtiController } from "./qti.controller";

@Module({
  controllers: [LtiController, QtiController],
  providers: [LtiService, QtiExportService],
})
export class IntegrationsModule {}
