import { Module } from "@nestjs/common";
import { AssignmentsService } from "./assignments.service";
import { AssignmentsController } from "./assignments.controller";
import { RemediationModule } from "../remediation/remediation.module";
import { ProblemsModule } from "../problems/problems.module";

@Module({
  imports: [RemediationModule, ProblemsModule],
  controllers: [AssignmentsController],
  providers: [AssignmentsService],
})
export class AssignmentsModule {}
