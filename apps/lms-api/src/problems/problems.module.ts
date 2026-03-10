import { Module } from "@nestjs/common";
import { ProblemsService } from "./problems.service";
import { ProblemsController } from "./problems.controller";
import { TwinProblemService } from "./twin-problem.service";
import { EmbeddingService } from "./embedding.service";

@Module({
  controllers: [ProblemsController],
  providers: [ProblemsService, TwinProblemService, EmbeddingService],
})
export class ProblemsModule {}
