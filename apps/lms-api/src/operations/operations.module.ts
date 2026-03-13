import { Module } from "@nestjs/common";
import { AttendanceService } from "./attendance.service";
import { BillingService } from "./billing.service";
import { OperationsController } from "./operations.controller";
import { PrismaModule } from "../prisma/prisma.module";

@Module({
  imports: [PrismaModule],
  controllers: [OperationsController],
  providers: [AttendanceService, BillingService],
  exports: [AttendanceService, BillingService],
})
export class OperationsModule {}
