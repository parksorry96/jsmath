import { IsString, IsOptional, IsInt, Min } from "class-validator";

export class AnswerDiagnosticDto {
  @IsString()
  studentAnswer: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  responseTimeSec?: number;
}
