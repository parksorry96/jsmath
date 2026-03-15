import { Module } from "@nestjs/common";
import { RemediationService } from "./remediation.service";
import { RemediationController } from "./remediation.controller";

@Module({
  controllers: [RemediationController],
  providers: [RemediationService],
  exports: [RemediationService],
})
export class RemediationModule {}
