import { IsString, IsNotEmpty, IsOptional, IsDateString, IsBoolean, IsInt, Min } from "class-validator";

export class AssignFromExamDto {
  @IsString()
  @IsNotEmpty()
  classId: string;

  @IsString()
  @IsOptional()
  title?: string;

  @IsDateString()
  @IsOptional()
  dueAt?: string;

  @IsBoolean()
  @IsOptional()
  attachPdf?: boolean;

  @IsInt()
  @Min(1)
  @IsOptional()
  maxScore?: number;
}
