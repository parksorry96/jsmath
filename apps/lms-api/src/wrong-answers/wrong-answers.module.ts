import { Module } from "@nestjs/common";
import { WrongAnswersService } from "./wrong-answers.service";
import { WrongAnswersController } from "./wrong-answers.controller";

@Module({
  controllers: [WrongAnswersController],
  providers: [WrongAnswersService],
  exports: [WrongAnswersService],
})
export class WrongAnswersModule {}
