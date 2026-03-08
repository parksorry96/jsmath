import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CreateLessonDto } from "./dto/create-lesson.dto";
import { UpdateLessonDto } from "./dto/update-lesson.dto";
import { RRule } from "rrule";

@Injectable()
export class LessonsService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateLessonDto) {
    if (dto.recurrenceRule) {
      return this.expandRecurrence(dto);
    }

    return this.prisma.lesson.create({
      data: {
        classId: dto.classId,
        title: dto.title,
        startAt: new Date(dto.startAt),
        endAt: new Date(dto.endAt),
        location: dto.location,
        memo: dto.memo,
      },
    });
  }

  async findByDateRange(
    start: string,
    end: string,
    classId?: string,
    userId?: string,
  ) {
    const where: any = {
      startAt: { gte: new Date(start) },
      endAt: { lte: new Date(end) },
    };

    if (classId) {
      where.classId = classId;
    } else if (userId) {
      const enrollments = await this.prisma.enrollment.findMany({
        where: { userId },
        select: { classId: true },
      });
      where.classId = { in: enrollments.map((e) => e.classId) };
    }

    return this.prisma.lesson.findMany({
      where,
      include: {
        class: { select: { id: true, title: true } },
      },
      orderBy: { startAt: "asc" },
    });
  }

  async update(id: string, dto: UpdateLessonDto) {
    await this.assertLessonExists(id);

    const data: any = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.startAt !== undefined) data.startAt = new Date(dto.startAt);
    if (dto.endAt !== undefined) data.endAt = new Date(dto.endAt);
    if (dto.location !== undefined) data.location = dto.location;
    if (dto.memo !== undefined) data.memo = dto.memo;

    return this.prisma.lesson.update({
      where: { id },
      data,
    });
  }

  async cancel(id: string) {
    await this.assertLessonExists(id);
    return this.prisma.lesson.update({
      where: { id },
      data: { status: "cancelled" },
    });
  }

  async complete(id: string) {
    await this.assertLessonExists(id);
    return this.prisma.lesson.update({
      where: { id },
      data: { status: "completed" },
    });
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
    const startDate = new Date(dto.startAt);
    const duration =
      new Date(dto.endAt).getTime() - startDate.getTime();

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
        endAt: new Date(dto.endAt),
        recurrenceRule: dto.recurrenceRule,
        location: dto.location,
        memo: dto.memo,
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

    return parent;
  }

  private async assertLessonExists(id: string) {
    const lesson = await this.prisma.lesson.findUnique({ where: { id } });
    if (!lesson) throw new NotFoundException("Lesson not found");
    return lesson;
  }
}
