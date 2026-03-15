import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import { Job } from "bullmq";
import { PrismaService } from "../prisma/prisma.service";

interface AggregationJobData {
  date?: string; // YYYY-MM-DD override; defaults to yesterday
}

@Processor("event-aggregation")
export class EventAggregationProcessor extends WorkerHost {
  private readonly logger = new Logger(EventAggregationProcessor.name);

  constructor(private prisma: PrismaService) {
    super();
  }

  async process(job: Job<AggregationJobData>) {
    const targetDate = this.resolveDate(job.data?.date);
    this.logger.log(`Aggregating learning events for ${targetDate.toISOString().slice(0, 10)}`);

    const dayStart = new Date(targetDate);
    dayStart.setUTCHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

    // Fetch all events for the target day
    const events = await this.prisma.learningEvent.findMany({
      where: {
        clientTs: { gte: dayStart, lt: dayEnd },
      },
      select: {
        eventType: true,
        studentId: true,
        sessionId: true,
        payload: true,
      },
    });

    if (events.length === 0) {
      this.logger.log("No events found for the target date");
      return { upserted: 0 };
    }

    // Group by student
    const byStudent = new Map<
      string,
      {
        problemsViewed: number;
        problemsSolved: number;
        problemsCorrect: number;
        totalDurationMs: bigint;
        sessions: Set<string>;
      }
    >();

    for (const event of events) {
      let stats = byStudent.get(event.studentId);
      if (!stats) {
        stats = {
          problemsViewed: 0,
          problemsSolved: 0,
          problemsCorrect: 0,
          totalDurationMs: BigInt(0),
          sessions: new Set(),
        };
        byStudent.set(event.studentId, stats);
      }

      stats.sessions.add(event.sessionId);

      switch (event.eventType) {
        case "session_started":
          stats.problemsViewed++;
          break;
        case "answer_submitted": {
          const payload = event.payload as Record<string, unknown> | null;
          if (payload && payload.isCorrect !== undefined && payload.isCorrect !== null) {
            stats.problemsSolved++;
            if (payload.isCorrect === true) {
              stats.problemsCorrect++;
            }
          }
          break;
        }
        case "session_ended": {
          const payload = event.payload as Record<string, unknown> | null;
          const duration = payload?.durationMs;
          if (typeof duration === "number" && duration > 0) {
            stats.totalDurationMs += BigInt(Math.round(duration));
          }
          break;
        }
      }
    }

    // Upsert daily stats
    const statDate = dayStart;
    let upserted = 0;
    for (const [studentId, stats] of byStudent) {
      await this.prisma.learningEventDailyStat.upsert({
        where: {
          studentId_statDate: { studentId, statDate },
        },
        create: {
          studentId,
          statDate,
          problemsViewed: stats.problemsViewed,
          problemsSolved: stats.problemsSolved,
          problemsCorrect: stats.problemsCorrect,
          totalDurationMs: stats.totalDurationMs,
          sessionCount: stats.sessions.size,
        },
        update: {
          problemsViewed: stats.problemsViewed,
          problemsSolved: stats.problemsSolved,
          problemsCorrect: stats.problemsCorrect,
          totalDurationMs: stats.totalDurationMs,
          sessionCount: stats.sessions.size,
        },
      });
      upserted++;
    }

    this.logger.log(
      `Aggregated ${events.length} events → ${upserted} student daily stats`,
    );
    return { upserted };
  }

  private resolveDate(dateStr?: string): Date {
    if (dateStr) {
      return new Date(dateStr);
    }
    // Default: yesterday
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - 1);
    return d;
  }
}
