import { IsString, IsNumber, Min, Max } from "class-validator";

export class GradePassbackDto {
  @IsString()
  lineItemUrl: string;

  @IsString()
  userId: string;

  @IsNumber()
  @Min(0)
  score: number;

  @IsNumber()
  @Min(1)
  maxScore: number;
}
