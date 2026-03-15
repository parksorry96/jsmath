import { Module } from "@nestjs/common";
import { AssignmentsService } from "./assignments.service";
import { AssignmentsController } from "./assignments.controller";
import { StudentAiModule } from "../student-ai/student-ai.module";
import { ProblemsModule } from "../problems/problems.module";

@Module({
  imports: [StudentAiModule, ProblemsModule],
  controllers: [AssignmentsController],
  providers: [AssignmentsService],
})
export class AssignmentsModule {}
