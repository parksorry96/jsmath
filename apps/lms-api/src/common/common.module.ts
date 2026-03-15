import { Module } from "@nestjs/common";
import { RedisStreamService } from "./redis-stream.service";

@Module({
  providers: [RedisStreamService],
  exports: [RedisStreamService],
})
export class CommonModule {}
