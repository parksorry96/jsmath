import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CreateLessonDto } from "./dto/create-lesson.dto";
import { UpdateLessonDto } from "./dto/update-lesson.dto";
import { RRule } from "rrule";
import { canAccessClass, getAccessibleClassIds } from "../common/access-control";

@Injectable()
export class LessonsService {
  constructor(private prisma: PrismaService) {}

  private serializeLesson(lesson: {
    id: string;
    classId: string;
    title: string;
    startAt: Date;
    endAt: Date;
    recurrenceRule: string | null;
    status: string;
    location: string | null;
    memo: string | null;
    class?: { id: string; title: string } | null;
  }) {
    return {
      ...lesson,
      startTime: lesson.startAt.toISOString(),
      endTime: lesson.endAt.toISOString(),
      date: lesson.startAt.toISOString().slice(0, 10),
      className: lesson.class?.title ?? null,
      rrule: lesson.recurrenceRule ?? null,
      class: lesson.class
        ? {
            ...lesson.class,
            name: lesson.class.title,
          }
        : undefined,
    };
  }

  private normalizeCreate(dto: CreateLessonDto) {
    const startAt = dto.startAt ?? dto.startTime;
    const endAt = dto.endAt ?? dto.endTime;
    const recurrenceRule = dto.recurrenceRule ?? dto.rrule;

    if (!startAt || !endAt) {
      throw new ForbiddenException("Lesson start/end time is required");
    }

    return {
      ...dto,
      startAt,
      endAt,
      recurrenceRule,
    };
  }

  private normalizeUpdate(dto: UpdateLessonDto) {
    return {
      ...dto,
      startAt: dto.startAt ?? dto.startTime,
      endAt: dto.endAt ?? dto.endTime,
      recurrenceRule: dto.rrule,
    };
  }

  async create(dto: CreateLessonDto) {
    const normalized = this.normalizeCreate(dto);

    if (normalized.recurrenceRule) {
      return this.expandRecurrence(normalized);
    }

    const created = await this.prisma.lesson.create({
      data: {
        classId: normalized.classId,
        title: normalized.title,
        startAt: new Date(normalized.startAt),
        endAt: new Date(normalized.endAt),
        location: normalized.location,
        memo: normalized.memo,
      },
      include: {
        class: { select: { id: true, title: true } },
      },
    });
    return this.serializeLesson(created);
  }

  async findByDateRange(
    start: string,
    end: string,
    classId?: string,
    userId?: string,
    userRole?: string,
  ) {
    const where: any = {
      startAt: { gte: new Date(start) },
      endAt: { lte: new Date(end) },
    };

    if (classId) {
      if (userId && userRole) {
        const allowed = await canAccessClass(this.prisma, userId, userRole, classId);
        if (!allowed) {
          throw new ForbiddenException("Not authorized to access this class");
        }
      }
      where.classId = classId;
    } else if (userId && userRole) {
      const accessibleClassIds = await getAccessibleClassIds(
        this.prisma,
        userId,
        userRole,
      );
      if (accessibleClassIds !== null) {
        where.classId = { in: accessibleClassIds };
      }
    }

    const lessons = await this.prisma.lesson.findMany({
      where,
      include: {
        class: { select: { id: true, title: true } },
      },
      orderBy: { startAt: "asc" },
    });

    return lessons.map((lesson) => this.serializeLesson(lesson));
  }

  async update(id: string, dto: UpdateLessonDto) {
    await this.assertLessonExists(id);
    const normalized = this.normalizeUpdate(dto);

    const data: any = {};
    if (normalized.title !== undefined) data.title = normalized.title;
    if (normalized.startAt !== undefined) data.startAt = new Date(normalized.startAt);
    if (normalized.endAt !== undefined) data.endAt = new Date(normalized.endAt);
    if (normalized.location !== undefined) data.location = normalized.location;
    if (normalized.memo !== undefined) data.memo = normalized.memo;
    if (normalized.recurrenceRule !== undefined) {
      data.recurrenceRule = normalized.recurrenceRule;
    }

    const updated = await this.prisma.lesson.update({
      where: { id },
      data,
      include: {
        class: { select: { id: true, title: true } },
      },
    });
    return this.serializeLesson(updated);
  }

  async cancel(id: string) {
    await this.assertLessonExists(id);
    const updated = await this.prisma.lesson.update({
      where: { id },
      data: { status: "cancelled" },
      include: {
        class: { select: { id: true, title: true } },
      },
    });
    return this.serializeLesson(updated);
  }

  async complete(id: string) {
    await this.assertLessonExists(id);
    const updated = await this.prisma.lesson.update({
      where: { id },
      data: { status: "completed" },
      include: {
        class: { select: { id: true, title: true } },
      },
    });
    return this.serializeLesson(updated);
  }

  async deleteSeries(recurrenceParentId: string) {
    const now = new Date();
    // Delete future lessons in the series (including parent if future)
    return this.prisma.lesson.deleteMany({
      where: {
        OR: [
          { recurrenceParentId, startAt: { gte: now } },
          { id: recurrenceParentId, startAt: { gte: now } },
        ],
      },
    });
  }

  private async expandRecurrence(dto: CreateLessonDto) {
    const rule = RRule.fromString(dto.recurrenceRule!);
    const startDate = new Date(dto.startAt!);
    const duration =
      new Date(dto.endAt!).getTime() - startDate.getTime();

    // Generate occurrences for next 12 weeks
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + 84);

    const dates = rule.between(startDate, endDate, true);

    // Create parent lesson first
    const parent = await this.prisma.lesson.create({
      data: {
        classId: dto.classId,
        title: dto.title,
        startAt: startDate,
        endAt: new Date(dto.endAt!),
        recurrenceRule: dto.recurrenceRule,
        location: dto.location,
        memo: dto.memo,
      },
      include: {
        class: { select: { id: true, title: true } },
      },
    });

    // Create child lessons for remaining dates
    const children = dates.slice(1).map((date) => ({
      classId: dto.classId,
      title: dto.title,
      startAt: date,
      endAt: new Date(date.getTime() + duration),
      recurrenceParentId: parent.id,
      location: dto.location,
      memo: dto.memo,
    }));

    if (children.length > 0) {
      await this.prisma.lesson.createMany({ data: children });
    }

    return this.serializeLesson(parent);
  }

  private async assertLessonExists(id: string) {
    const lesson = await this.prisma.lesson.findUnique({ where: { id } });
    if (!lesson) throw new NotFoundException("Lesson not found");
    return lesson;
  }
}
