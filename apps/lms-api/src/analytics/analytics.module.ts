import { Module } from "@nestjs/common";
import { AnalyticsService } from "./analytics.service";
import { KnowledgeGraphService } from "./knowledge-graph.service";
import { AnalyticsController } from "./analytics.controller";

@Module({
  controllers: [AnalyticsController],
  providers: [AnalyticsService, KnowledgeGraphService],
  exports: [AnalyticsService, KnowledgeGraphService],
})
export class AnalyticsModule {}
