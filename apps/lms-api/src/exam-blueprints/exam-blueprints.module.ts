import { Module } from "@nestjs/common";
import { ExamBlueprintsController } from "./exam-blueprints.controller";
import { ExamBlueprintsService } from "./exam-blueprints.service";
import { BlueprintComposerService } from "./blueprint-composer.service";
import { ProblemsModule } from "../problems/problems.module";

@Module({
  imports: [ProblemsModule],
  controllers: [ExamBlueprintsController],
  providers: [ExamBlueprintsService, BlueprintComposerService],
  exports: [ExamBlueprintsService],
})
export class ExamBlueprintsModule {}
