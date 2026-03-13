import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { BillingType, BillingStatus } from "@prisma/client";

@Injectable()
export class BillingService {
  constructor(private prisma: PrismaService) {}

  async create(
    studentId: string,
    data: {
      classId?: string;
      type: BillingType;
      amount: number;
      description?: string;
      billingMonth: string;
    },
  ) {
    return this.prisma.billingRecord.create({
      data: {
        studentId,
        classId: data.classId,
        type: data.type,
        amount: data.amount,
        description: data.description,
        billingMonth: new Date(data.billingMonth),
      },
      include: {
        student: { select: { id: true, name: true } },
      },
    });
  }

  async bulkGenerate(
    classId: string,
    billingMonth: string,
    type: BillingType,
    amount: number,
    description?: string,
  ) {
    const enrollments = await this.prisma.enrollment.findMany({
      where: { classId, role: "student" },
      select: { userId: true },
    });

    const monthDate = new Date(billingMonth);

    const records = await Promise.all(
      enrollments.map((e) =>
        this.prisma.billingRecord.create({
          data: {
            studentId: e.userId,
            classId,
            type,
            amount,
            description,
            billingMonth: monthDate,
          },
          include: {
            student: { select: { id: true, name: true } },
          },
        }),
      ),
    );

    return records;
  }

  async getByStudent(studentId: string, month?: string) {
    const where: any = { studentId };
    if (month) {
      const start = new Date(month);
      const end = new Date(start);
      end.setUTCMonth(end.getUTCMonth() + 1);
      where.billingMonth = { gte: start, lt: end };
    }

    return this.prisma.billingRecord.findMany({
      where,
      include: {
        student: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async getByClass(classId: string, month?: string) {
    const where: any = { classId };
    if (month) {
      const start = new Date(month);
      const end = new Date(start);
      end.setUTCMonth(end.getUTCMonth() + 1);
      where.billingMonth = { gte: start, lt: end };
    }

    return this.prisma.billingRecord.findMany({
      where,
      include: {
        student: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async updateStatus(id: string, status: BillingStatus, paidAt?: string) {
    const record = await this.prisma.billingRecord.findUnique({
      where: { id },
    });
    if (!record) throw new NotFoundException("Billing record not found");

    return this.prisma.billingRecord.update({
      where: { id },
      data: {
        status,
        paidAt: paidAt ? new Date(paidAt) : status === "paid" ? new Date() : null,
      },
      include: {
        student: { select: { id: true, name: true } },
      },
    });
  }

  async getMonthlyStatement(classId: string, month: string) {
    const start = new Date(month);
    const end = new Date(start);
    end.setUTCMonth(end.getUTCMonth() + 1);

    const records = await this.prisma.billingRecord.findMany({
      where: {
        classId,
        billingMonth: { gte: start, lt: end },
      },
      include: {
        student: { select: { id: true, name: true } },
      },
    });

    let totalBilled = 0;
    let totalPaid = 0;
    let totalPending = 0;
    let totalOverdue = 0;

    for (const r of records) {
      totalBilled += r.amount;
      if (r.status === "paid") totalPaid += r.amount;
      else if (r.status === "overdue") totalOverdue += r.amount;
      else if (r.status === "pending") totalPending += r.amount;
    }

    return {
      month,
      classId,
      records,
      summary: {
        totalBilled,
        totalPaid,
        totalPending,
        totalOverdue,
        count: records.length,
      },
    };
  }
}
