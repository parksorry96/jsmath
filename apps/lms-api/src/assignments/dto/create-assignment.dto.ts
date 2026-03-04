import { IsString, IsOptional, IsNotEmpty, IsDateString, IsInt, Min } from "class-validator";

export class CreateAssignmentDto {
  @IsString()
  @IsNotEmpty()
  title: string;

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
