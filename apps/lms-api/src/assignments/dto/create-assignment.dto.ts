import {
  IsString,
  IsOptional,
  IsNotEmpty,
  IsDateString,
  IsInt,
  Min,
  IsIn,
  IsArray,
  IsBoolean,
} from "class-validator";

export class CreateAssignmentDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsIn(["problem_set", "text_task"])
  @IsOptional()
  type?: "problem_set" | "text_task";

  @IsDateString()
  @IsOptional()
  dueAt?: string;

  @IsDateString()
  @IsOptional()
  dueDate?: string;

  @IsInt()
  @Min(1)
  @IsOptional()
  maxScore?: number;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  problemIds?: string[];

  @IsString()
  @IsOptional()
  examDocumentId?: string;

  @IsBoolean()
  @IsOptional()
  attachPdf?: boolean;
}
