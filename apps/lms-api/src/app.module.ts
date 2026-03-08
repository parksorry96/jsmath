import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AppController } from "./app.controller";
import { PrismaModule } from "./prisma/prisma.module";
import { AuthModule } from "./auth/auth.module";
import { UsersModule } from "./users/users.module";
import { OrganizationsModule } from "./organizations/organizations.module";
import { ClassesModule } from "./classes/classes.module";
import { EnrollmentsModule } from "./enrollments/enrollments.module";
import { AssignmentsModule } from "./assignments/assignments.module";
import { FilesModule } from "./files/files.module";
import { ProblemsModule } from "./problems/problems.module";
import { LessonsModule } from "./lessons/lessons.module";
import { SubmissionsModule } from "./submissions/submissions.module";
import { ParentLinksModule } from "./parent-links/parent-links.module";
import { NotificationsModule } from "./notifications/notifications.module";
import { AnalyticsModule } from "./analytics/analytics.module";
import { SubmissionPhotosModule } from "./submission-photos/submission-photos.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    UsersModule,
    OrganizationsModule,
    ClassesModule,
    EnrollmentsModule,
    AssignmentsModule,
    FilesModule,
    ProblemsModule,
    LessonsModule,
    SubmissionsModule,
    ParentLinksModule,
    NotificationsModule,
    AnalyticsModule,
    SubmissionPhotosModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
