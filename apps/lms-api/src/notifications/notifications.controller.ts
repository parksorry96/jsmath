import {
  Controller,
  Get,
  Patch,
  Post,
  Param,
  Query,
  Body,
  UseGuards,
  Request,
} from "@nestjs/common";
import { NotificationsService } from "./notifications.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";

interface AuthRequest {
  user: { id: string; email: string; role: string };
}

@Controller()
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private notifications: NotificationsService) {}

  @Get("notifications")
  findAll(
    @Request() req: AuthRequest,
    @Query("unread") unread?: string,
    @Query("page") page?: string,
    @Query("limit") limit?: string,
  ) {
    return this.notifications.findByUser(
      req.user.id,
      unread === "true",
      +(page || 1),
      +(limit || 20),
    );
  }

  @Get("notifications/count")
  unreadCount(@Request() req: AuthRequest) {
    return this.notifications.unreadCount(req.user.id);
  }

  @Patch("notifications/:id/read")
  markRead(@Param("id") id: string, @Request() req: AuthRequest) {
    return this.notifications.markAsRead(id, req.user.id);
  }

  @Patch("notifications/read-all")
  markAllRead(@Request() req: AuthRequest) {
    return this.notifications.markAllRead(req.user.id);
  }

  @Post("users/me/push-token")
  savePushToken(@Body("token") token: string, @Request() req: AuthRequest) {
    return this.notifications.savePushToken(req.user.id, token);
  }
}
