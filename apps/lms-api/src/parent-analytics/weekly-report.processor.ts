import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import { Job } from "bullmq";
import { ParentAnalyticsService } from "./parent-analytics.service";

@Processor("parent-weekly-reports")
export class WeeklyReportProcessor extends WorkerHost {
  private readonly logger = new Logger(WeeklyReportProcessor.name);

  constructor(private parentAnalytics: ParentAnalyticsService) {
    super();
  }

  async process(job: Job<{ type: "generate-all" }>) {
    this.logger.log("Generating weekly reports for all parent-student links...");
    const count = await this.parentAnalytics.generateAllReports();
    this.logger.log(`Generated ${count} weekly reports`);
    return { count };
  }
}
