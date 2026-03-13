import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AttendanceStatus } from "@prisma/client";

@Injectable()
export class AttendanceService {
  constructor(private prisma: PrismaService) {}

  async checkIn(
    studentId: string,
    classId: string,
    date?: string,
    status: AttendanceStatus = "present",
    note?: string,
  ) {
    const d = date ? new Date(date) : new Date();
    // Normalize to date-only (midnight UTC)
    const dateOnly = new Date(
      Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()),
    );

    return this.prisma.attendance.upsert({
      where: {
        studentId_classId_date: { studentId, classId, date: dateOnly },
      },
      update: { status, note, checkedInAt: new Date() },
      create: {
        studentId,
        classId,
        date: dateOnly,
        status,
        note,
        checkedInAt: new Date(),
      },
      include: {
        student: { select: { id: true, name: true } },
      },
    });
  }

  async bulkCheckIn(
    classId: string,
    date: string,
    records: { studentId: string; status: AttendanceStatus; note?: string }[],
  ) {
    const d = new Date(date);
    const dateOnly = new Date(
      Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()),
    );

    const results = await Promise.all(
      records.map((r) =>
        this.prisma.attendance.upsert({
          where: {
            studentId_classId_date: {
              studentId: r.studentId,
              classId,
              date: dateOnly,
            },
          },
          update: { status: r.status, note: r.note, checkedInAt: new Date() },
          create: {
            studentId: r.studentId,
            classId,
            date: dateOnly,
            status: r.status,
            note: r.note,
            checkedInAt: new Date(),
          },
          include: {
            student: { select: { id: true, name: true } },
          },
        }),
      ),
    );
    return results;
  }

  async getByClass(classId: string, month: string) {
    const start = new Date(month + "-01T00:00:00.000Z");
    const end = new Date(start);
    end.setUTCMonth(end.getUTCMonth() + 1);

    const [attendances, enrollments] = await Promise.all([
      this.prisma.attendance.findMany({
        where: {
          classId,
          date: { gte: start, lt: end },
        },
        include: {
          student: { select: { id: true, name: true } },
        },
        orderBy: [{ date: "asc" }],
      }),
      this.prisma.enrollment.findMany({
        where: { classId, role: "student" },
        include: {
          user: { select: { id: true, name: true } },
        },
      }),
    ]);

    return {
      students: enrollments.map((e) => e.user),
      attendances,
      month: month,
    };
  }

  async getByStudent(studentId: string, month: string) {
    const start = new Date(month + "-01T00:00:00.000Z");
    const end = new Date(start);
    end.setUTCMonth(end.getUTCMonth() + 1);

    return this.prisma.attendance.findMany({
      where: {
        studentId,
        date: { gte: start, lt: end },
      },
      include: {
        class: { select: { id: true, title: true } },
      },
      orderBy: { date: "asc" },
    });
  }

  async getStats(classId: string, month: string) {
    const start = new Date(month + "-01T00:00:00.000Z");
    const end = new Date(start);
    end.setUTCMonth(end.getUTCMonth() + 1);

    const attendances = await this.prisma.attendance.findMany({
      where: {
        classId,
        date: { gte: start, lt: end },
      },
      include: {
        student: { select: { id: true, name: true } },
      },
    });

    // Group by student
    const byStudent = new Map<
      string,
      { id: string; name: string; present: number; absent: number; late: number; excused: number }
    >();

    for (const a of attendances) {
      let entry = byStudent.get(a.studentId);
      if (!entry) {
        entry = {
          id: a.student.id,
          name: a.student.name,
          present: 0,
          absent: 0,
          late: 0,
          excused: 0,
        };
        byStudent.set(a.studentId, entry);
      }
      entry[a.status]++;
    }

    return Array.from(byStudent.values());
  }
}
