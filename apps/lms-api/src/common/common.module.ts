import { Module } from "@nestjs/common";
import { RedisEventBusService } from "./redis-event-bus.service";
import { RedisStreamService } from "./redis-stream.service";

@Module({
  providers: [RedisStreamService, RedisEventBusService],
  exports: [RedisStreamService, RedisEventBusService],
})
export class CommonModule {}
