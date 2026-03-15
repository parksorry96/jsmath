import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import { Job } from "bullmq";
import { PrismaService } from "../../prisma/prisma.service";
import { WeaknessProfileService } from "../weakness/weakness-profile.service";
import { SmartRecommendService } from "../recommend/smart-recommend.service";

@Processor("student-ai-batch")
export class WeaknessAggregationProcessor extends WorkerHost {
  private logger = new Logger(WeaknessAggregationProcessor.name);

  constructor(
    private prisma: PrismaService,
    private weaknessProfile: WeaknessProfileService,
    private smartRecommend: SmartRecommendService,
  ) {
    super();
  }

  async process(job: Job) {
    if (job.name === "daily-weakness-summary") {
      return this.runWeaknessSummary();
    }
    if (job.name === "daily-recommendations") {
      return this.runRecommendations();
    }
    this.logger.warn(`Unknown job name: ${job.name}`);
  }

  private async runWeaknessSummary() {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const activeStudents = await this.prisma.submission.findMany({
      where: { createdAt: { gte: sevenDaysAgo }, student: { role: "student" } },
      select: { studentId: true },
      distinct: ["studentId"],
    });

    this.logger.log(`Updating weakness profiles for ${activeStudents.length} students`);

    let processed = 0;
    let consecutiveFailures = 0;
    for (const { studentId } of activeStudents) {
      try {
        await this.weaknessProfile.updateProfile(studentId);
        processed++;
        consecutiveFailures = 0;
      } catch (err) {
        this.logger.error(`Failed to update profile for ${studentId}`, err);
        consecutiveFailures++;
        if (consecutiveFailures >= 5) {
          this.logger.error("5 consecutive failures — aborting batch");
          break;
        }
      }
    }

    return { studentsProcessed: processed, total: activeStudents.length };
  }

  private async runRecommendations() {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const activeStudents = await this.prisma.submission.findMany({
      where: { createdAt: { gte: sevenDaysAgo }, student: { role: "student" } },
      select: { studentId: true },
      distinct: ["studentId"],
    });

    this.logger.log(`Generating recommendations for ${activeStudents.length} students`);

    let processed = 0;
    let consecutiveFailures = 0;
    for (const { studentId } of activeStudents) {
      try {
        await this.smartRecommend.generateRecommendations(studentId);
        processed++;
        consecutiveFailures = 0;
      } catch (err) {
        this.logger.error(`Failed to generate recommendations for ${studentId}`, err);
        consecutiveFailures++;
        if (consecutiveFailures >= 5) {
          this.logger.error("5 consecutive failures — aborting batch");
          break;
        }
      }
    }

    return { studentsProcessed: processed, total: activeStudents.length };
  }
}
