import { IsOptional, IsString, IsInt, Min, Max } from "class-validator";

export class RecommendRequestDto {
  @IsOptional()
  @IsString()
  sourceAssignmentId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  limit?: number;
}
