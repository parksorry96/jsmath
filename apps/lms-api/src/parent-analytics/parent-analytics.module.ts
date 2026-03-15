import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { ParentAnalyticsController } from "./parent-analytics.controller";
import { ParentAnalyticsService } from "./parent-analytics.service";
import { WeeklyReportProcessor } from "./weekly-report.processor";

@Module({
  imports: [
    BullModule.registerQueue({ name: "parent-weekly-reports" }),
  ],
  controllers: [ParentAnalyticsController],
  providers: [ParentAnalyticsService, WeeklyReportProcessor],
  exports: [ParentAnalyticsService],
})
export class ParentAnalyticsModule {}
