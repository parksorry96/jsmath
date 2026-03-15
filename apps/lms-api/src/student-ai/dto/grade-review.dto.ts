import { IsInt, Min, Max } from "class-validator";

export class GradeReviewDto {
  @IsInt()
  @Min(0)
  @Max(5)
  quality: number;
}
