import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { BullModule } from "@nestjs/bullmq";
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
import { ExamDocumentsModule } from "./exam-documents/exam-documents.module";
import { CurriculumModule } from "./curriculum/curriculum.module";
import { WrongAnswersModule } from "./wrong-answers/wrong-answers.module";
import { MasteryModule } from "./mastery/mastery.module";
import { ReviewsModule } from "./reviews/reviews.module";
import { RemediationModule } from "./remediation/remediation.module";
import { DiagnosticsModule } from "./diagnostics/diagnostics.module";
import { TutorModule } from "./tutor/tutor.module";
import { GradePredictionModule } from "./grade-prediction/grade-prediction.module";
import { ParentAnalyticsModule } from "./parent-analytics/parent-analytics.module";
import { GamificationModule } from "./gamification/gamification.module";
import { ClassMonitorModule } from "./class-monitor/class-monitor.module";
import { OperationsModule } from "./operations/operations.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [".env", "../../.env"],
    }),
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          url: config.get("REDIS_URL", "redis://localhost:6379/0"),
        },
      }),
    }),
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
    ExamDocumentsModule,
    CurriculumModule,
    WrongAnswersModule,
    MasteryModule,
    ReviewsModule,
    RemediationModule,
    DiagnosticsModule,
    TutorModule,
    GradePredictionModule,
    ParentAnalyticsModule,
    GamificationModule,
    ClassMonitorModule,
    OperationsModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
