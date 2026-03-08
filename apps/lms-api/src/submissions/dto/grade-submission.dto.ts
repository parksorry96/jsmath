import {
  IsOptional,
  IsNumber,
  IsArray,
  IsString,
  IsBoolean,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";

class GradeAnswerDto {
  @IsString()
  problemId: string;

  @IsNumber()
  score: number;

  @IsOptional()
  @IsString()
  feedback?: string;

  @IsOptional()
  @IsBoolean()
  isCorrect?: boolean;
}

export class GradeSubmissionDto {
  @IsOptional()
  @IsNumber()
  score?: number;

  @IsOptional()
  @IsString()
  feedback?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GradeAnswerDto)
  answers?: GradeAnswerDto[];
}
