import { IsInt, IsOptional, Min, Max } from "class-validator";

export class GenerateVariantsDto {
  @IsInt()
  @Min(1)
  @Max(10)
  count: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(6)
  difficultyTarget?: number;
}
