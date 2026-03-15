import { Module } from "@nestjs/common";
import { ProblemsService } from "./problems.service";
import { ProblemsController } from "./problems.controller";
import { TwinProblemService } from "./twin-problem.service";
import { EmbeddingService } from "./embedding.service";
import { ProblemUsageLogService } from "./problem-usage-log.service";
import { ProblemRevisionService } from "./problem-revision.service";
import { ProblemStatisticsService } from "./problem-statistics.service";
import { ProblemQualityService } from "./problem-quality.service";

@Module({
  controllers: [ProblemsController],
  providers: [
    ProblemsService,
    TwinProblemService,
    EmbeddingService,
    ProblemUsageLogService,
    ProblemRevisionService,
    ProblemStatisticsService,
    ProblemQualityService,
  ],
  exports: [ProblemUsageLogService, ProblemRevisionService],
})
export class ProblemsModule {}
