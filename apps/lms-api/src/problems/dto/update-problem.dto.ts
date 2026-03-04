import { IsOptional, IsString, IsInt, Min, Max } from "class-validator";

export class UpdateProblemDto {
  @IsOptional()
  @IsString()
  stemLatex?: string;

  @IsOptional()
  @IsString()
  stemText?: string;

  @IsOptional()
  @IsString()
  problemType?: string;

  @IsOptional()
  @IsString()
  gradeLevel?: string;

  @IsOptional()
  @IsString()
  subject?: string;

  @IsOptional()
  @IsString()
  unitMajor?: string;

  @IsOptional()
  @IsString()
  unitMinor?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  difficulty?: number;
}
