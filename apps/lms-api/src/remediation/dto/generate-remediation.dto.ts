import { Type } from "class-transformer";
import { IsInt, IsOptional, IsString, Max, Min } from "class-validator";

export class GenerateRemediationDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  maxProblems?: number;

  @IsOptional()
  @IsString()
  sourceAssignmentId?: string;
}
