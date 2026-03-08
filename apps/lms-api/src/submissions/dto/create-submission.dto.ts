import { IsString, IsIn, IsOptional, IsArray, ValidateNested } from "class-validator";
import { Type } from "class-transformer";

class SubmissionAnswerDto {
  @IsString()
  problemId: string;

  @IsString()
  studentAnswer: string;
}

export class CreateSubmissionDto {
  @IsString()
  assignmentId: string;

  @IsIn(["online", "photo"])
  type: "online" | "photo";

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SubmissionAnswerDto)
  answers?: SubmissionAnswerDto[];
}
