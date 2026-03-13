import { Module } from "@nestjs/common";
import { GradePredictionController } from "./grade-prediction.controller";
import { GradePredictionService } from "./grade-prediction.service";

@Module({
  controllers: [GradePredictionController],
  providers: [GradePredictionService],
  exports: [GradePredictionService],
})
export class GradePredictionModule {}
