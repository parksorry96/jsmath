import { Module } from "@nestjs/common";
import { ClassMonitorService } from "./class-monitor.service";
import { ClassMonitorController } from "./class-monitor.controller";
import { ClassMonitorGateway } from "./class-monitor.gateway";

@Module({
  controllers: [ClassMonitorController],
  providers: [ClassMonitorService, ClassMonitorGateway],
  exports: [ClassMonitorGateway, ClassMonitorService],
})
export class ClassMonitorModule {}
