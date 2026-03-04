import { IsString, IsOptional, IsDateString, IsInt, Min } from "class-validator";

export class UpdateAssignmentDto {
  @IsString()
  @IsOptional()
  title?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsDateString()
  @IsOptional()
  dueAt?: string;

  @IsInt()
  @Min(1)
  @IsOptional()
  maxScore?: number;
}
