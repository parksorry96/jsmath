import { Module } from "@nestjs/common";
import { RemediationService } from "./remediation.service";
import { RemediationController } from "./remediation.controller";
import { EmbeddingService } from "../problems/embedding.service";

@Module({
  controllers: [RemediationController],
  providers: [RemediationService, EmbeddingService],
  exports: [RemediationService],
})
export class RemediationModule {}
