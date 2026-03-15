import { Module, OnModuleInit, Logger } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { LearningEventsController } from "./learning-events.controller";
import { LearningEventsService } from "./learning-events.service";
import { EventAggregationProcessor } from "./event-aggregation.processor";

@Module({
  imports: [
    BullModule.registerQueue({ name: "event-aggregation" }),
  ],
  controllers: [LearningEventsController],
  providers: [LearningEventsService, EventAggregationProcessor],
  exports: [LearningEventsService],
})
export class LearningEventsModule implements OnModuleInit {
  private readonly logger = new Logger(LearningEventsModule.name);

  constructor(
    @InjectQueue("event-aggregation") private aggregationQueue: Queue,
  ) {}

  async onModuleInit() {
    // Schedule daily aggregation at 02:00 AM
    await this.aggregationQueue.add(
      "daily-aggregate",
      {},
      {
        repeat: { pattern: "0 2 * * *" },
        removeOnComplete: 7,
        removeOnFail: 14,
      },
    );
    this.logger.log("Scheduled daily event aggregation job (02:00 AM)");
  }
}
