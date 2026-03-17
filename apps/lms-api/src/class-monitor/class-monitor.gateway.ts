import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  ConnectedSocket,
  MessageBody,
} from "@nestjs/websockets";
import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { Server, Socket } from "socket.io";
import { Redis } from "ioredis";
import { createAdapter } from "@socket.io/redis-adapter";
import { extractAuthTokenFromCookieHeader } from "../auth/auth-cookie";
import { PrismaService } from "../prisma/prisma.service";
import { ClassMonitorService, ClassMonitorStatus } from "./class-monitor.service";
import { canAccessClass } from "../common/access-control";

interface AuthenticatedSocket extends Socket {
  data: {
    userId: string;
    role: string;
  };
}

@WebSocketGateway({
  namespace: "/class-monitor",
  cors: {
    origin: process.env.CORS_ORIGINS?.split(",") ?? ["http://localhost:3000"],
    credentials: true,
  },
})
export class ClassMonitorGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(ClassMonitorGateway.name);

  constructor(
    private config: ConfigService,
    private jwt: JwtService,
    private prisma: PrismaService,
    private monitor: ClassMonitorService,
  ) {}

  async afterInit(server: Server) {
    try {
      const redisUrl = this.config.getOrThrow<string>("REDIS_URL");
      const pubClient = new Redis(redisUrl);
      const subClient = pubClient.duplicate();
      const adapter = createAdapter(pubClient, subClient);
      if (typeof server.adapter === "function") {
        server.adapter(adapter);
        this.logger.log("Redis adapter attached");
      } else {
        this.logger.warn("server.adapter() not available — running without Redis adapter");
      }
    } catch (error) {
      this.logger.warn(
        "Failed to attach Redis adapter — running without it",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  async handleConnection(client: AuthenticatedSocket) {
    try {
      const token =
        client.handshake.auth?.token ??
        client.handshake.headers?.authorization?.replace("Bearer ", "") ??
        extractAuthTokenFromCookieHeader(client.handshake.headers?.cookie);

      if (!token) {
        client.disconnect(true);
        return;
      }

      const payload = this.jwt.verify<{ sub: string; role: string }>(token);
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { id: true, role: true },
      });

      if (!user || (user.role !== "admin" && user.role !== "teacher")) {
        client.disconnect(true);
        return;
      }

      client.data = { userId: user.id, role: user.role };
      this.logger.debug(`Client connected: ${user.id}`);
    } catch {
      client.disconnect(true);
    }
  }

  handleDisconnect(client: AuthenticatedSocket) {
    this.logger.debug(`Client disconnected: ${client.data?.userId ?? client.id}`);
  }

  @SubscribeMessage("join:assignment")
  async handleJoinAssignment(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { classId: string; assignmentId?: string },
  ) {
    if (!client.data?.userId) {
      return { error: "Unauthorized" };
    }

    const allowed = await canAccessClass(
      this.prisma,
      client.data.userId,
      client.data.role,
      data.classId,
    );
    if (!allowed) {
      return { error: "Forbidden" };
    }

    const room = `assignment:${data.assignmentId ?? data.classId}`;

    // Leave all previous assignment rooms
    for (const r of client.rooms) {
      if (r !== client.id && r.startsWith("assignment:")) {
        client.leave(r);
      }
    }

    client.join(room);

    // Send initial status
    const status = await this.monitor.getStatus(data.classId, data.assignmentId);
    client.emit("status", status);

    return { joined: room };
  }

  /** Called by SubmissionsService after a student submits or is graded */
  emitSubmission(assignmentId: string, status: ClassMonitorStatus) {
    this.server.to(`assignment:${assignmentId}`).emit("status", status);
  }
}
