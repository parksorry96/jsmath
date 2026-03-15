import { IsBoolean } from "class-validator";

export class RetryWrongAnswerDto {
  @IsBoolean()
  isCorrect: boolean;
}
