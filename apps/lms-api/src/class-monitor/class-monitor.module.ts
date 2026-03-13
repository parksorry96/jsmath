import { Module } from "@nestjs/common";
import { ClassMonitorService } from "./class-monitor.service";
import { ClassMonitorController } from "./class-monitor.controller";

@Module({
  controllers: [ClassMonitorController],
  providers: [ClassMonitorService],
})
export class ClassMonitorModule {}
