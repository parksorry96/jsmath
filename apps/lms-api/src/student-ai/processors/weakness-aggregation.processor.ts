import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import { Job } from "bullmq";
import { runWithConcurrency } from "../../common/concurrency";
import { PrismaService } from "../../prisma/prisma.service";
import { WeaknessProfileService } from "../weakness/weakness-profile.service";
import { SmartRecommendService } from "../recommend/smart-recommend.service";

const STUDENT_AI_BATCH_CONCURRENCY = 4;

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

  private async getActiveStudentIds(since: Date) {
    const [submissionStudents, tutorStudents] = await Promise.all([
      this.prisma.submission.findMany({
        where: { createdAt: { gte: since }, student: { role: "student" } },
        select: { studentId: true },
        distinct: ["studentId"],
      }),
      this.prisma.tutorSession.findMany({
        where: {
          student: { role: "student" },
          messages: {
            some: {
              createdAt: { gte: since },
            },
          },
        },
        select: { studentId: true },
        distinct: ["studentId"],
      }),
    ]);

    return [...new Set([...submissionStudents, ...tutorStudents].map((row) => row.studentId))]
      .map((studentId) => ({ studentId }));
  }

  private async runWeaknessSummary() {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const activeStudents = await this.getActiveStudentIds(sevenDaysAgo);

    this.logger.log(`Updating weakness profiles for ${activeStudents.length} students`);

    let processed = 0;
    await runWithConcurrency(
      activeStudents,
      STUDENT_AI_BATCH_CONCURRENCY,
      async ({ studentId }) => {
        try {
          await this.weaknessProfile.updateProfile(studentId);
          processed++;
        } catch (err) {
          this.logger.error(`Failed to update profile for ${studentId}`, err);
        }
      },
    );

    return { studentsProcessed: processed, total: activeStudents.length };
  }

  private async runRecommendations() {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const activeStudents = await this.getActiveStudentIds(sevenDaysAgo);

    this.logger.log(`Generating recommendations for ${activeStudents.length} students`);

    let processed = 0;
    await runWithConcurrency(
      activeStudents,
      STUDENT_AI_BATCH_CONCURRENCY,
      async ({ studentId }) => {
        try {
          await this.smartRecommend.generateRecommendations(studentId);
          processed++;
        } catch (err) {
          this.logger.error(`Failed to generate recommendations for ${studentId}`, err);
        }
      },
    );

    return { studentsProcessed: processed, total: activeStudents.length };
  }
}
