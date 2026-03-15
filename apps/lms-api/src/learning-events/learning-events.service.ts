import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { LearningEventDto } from "./dto/batch-events.dto";

@Injectable()
export class LearningEventsService {
  private readonly logger = new Logger(LearningEventsService.name);

  constructor(private prisma: PrismaService) {}

  async processBatch(
    studentId: string,
    organizationId: string | null,
    events: LearningEventDto[],
    ipHash: string,
  ) {
    const now = Date.now();
    const futureTolerance = 30_000; // 30 seconds
    const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days

    const valid: LearningEventDto[] = [];
    let rejected = 0;

    for (const event of events) {
      const ts = new Date(event.clientTs).getTime();
      if (ts > now + futureTolerance || ts < now - maxAge) {
        rejected++;
        continue;
      }
      valid.push(event);
    }

    if (valid.length > 0) {
      await this.prisma.learningEvent.createMany({
        data: valid.map((e) => ({
          eventType: e.eventType,
          studentId,
          sessionId: e.sessionId,
          problemId: e.problemId ?? null,
          assignmentId: e.assignmentId ?? null,
          organizationId,
          payload: e.payload as Prisma.InputJsonValue,
          clientTs: new Date(e.clientTs),
          deviceType: e.deviceType ?? null,
          appVersion: e.appVersion ?? null,
          ipHash,
        })),
      });
    }

    if (rejected > 0) {
      this.logger.warn(
        `Rejected ${rejected}/${events.length} events for student ${studentId}`,
      );
    }

    return { accepted: valid.length, rejected };
  }
}
