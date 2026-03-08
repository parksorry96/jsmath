import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import Expo, { ExpoPushMessage } from "expo-server-sdk";

@Injectable()
export class NotificationsService {
  private expo = new Expo();

  constructor(private prisma: PrismaService) {}

  async create(
    userId: string,
    type: string,
    title: string,
    body: string,
    ref?: { type: string; id: string },
  ) {
    const notification = await this.prisma.notification.create({
      data: {
        userId,
        type,
        title,
        body,
        referenceType: ref?.type,
        referenceId: ref?.id,
      },
    });

    await this.sendPush(userId, title, body);

    return notification;
  }

  async createBulk(
    userIds: string[],
    type: string,
    title: string,
    body: string,
    ref?: { type: string; id: string },
  ) {
    await this.prisma.notification.createMany({
      data: userIds.map((userId) => ({
        userId,
        type,
        title,
        body,
        referenceType: ref?.type,
        referenceId: ref?.id,
      })),
    });

    await this.sendPushBulk(userIds, title, body);
  }

  async findByUser(userId: string, unreadOnly = false, page = 1, limit = 20) {
    const where = { userId, ...(unreadOnly ? { readAt: null } : {}) };
    const [items, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.notification.count({ where }),
    ]);
    return { items, total, page, limit };
  }

  async unreadCount(userId: string) {
    return this.prisma.notification.count({
      where: { userId, readAt: null },
    });
  }

  async markAsRead(id: string, userId: string) {
    return this.prisma.notification.updateMany({
      where: { id, userId },
      data: { readAt: new Date() },
    });
  }

  async markAllRead(userId: string) {
    return this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
  }

  async notifyParents(
    studentId: string,
    type: string,
    title: string,
    body: string,
    ref?: { type: string; id: string },
  ) {
    const links = await this.prisma.parentStudent.findMany({
      where: { studentId },
      select: { parentId: true },
    });
    const parentIds = links.map((l) => l.parentId);
    if (parentIds.length) {
      await this.createBulk(parentIds, type, title, body, ref);
    }
  }

  async savePushToken(userId: string, token: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { pushToken: token },
    });
  }

  private async sendPush(userId: string, title: string, body: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { pushToken: true },
    });
    if (!user?.pushToken || !Expo.isExpoPushToken(user.pushToken)) return;

    try {
      await this.expo.sendPushNotificationsAsync([
        { to: user.pushToken, title, body, sound: "default" },
      ]);
    } catch (e) {
      console.error("Push notification failed:", e);
    }
  }

  private async sendPushBulk(
    userIds: string[],
    title: string,
    body: string,
  ) {
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds }, pushToken: { not: null } },
      select: { pushToken: true },
    });

    const messages: ExpoPushMessage[] = users
      .filter((u) => u.pushToken && Expo.isExpoPushToken(u.pushToken))
      .map((u) => ({
        to: u.pushToken!,
        title,
        body,
        sound: "default" as const,
      }));

    if (messages.length === 0) return;

    const chunks = this.expo.chunkPushNotifications(messages);
    for (const chunk of chunks) {
      try {
        await this.expo.sendPushNotificationsAsync(chunk);
      } catch (e) {
        console.error("Push batch failed:", e);
      }
    }
  }
}
