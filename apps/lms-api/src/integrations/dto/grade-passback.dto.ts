import { IsNumber, IsString, IsUrl, Min } from "class-validator";

const HTTPS_URL = { protocols: ["https"], require_protocol: true };

export class GradePassbackDto {
  @IsUrl(HTTPS_URL)
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
