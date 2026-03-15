import { IsString, MaxLength, IsOptional } from "class-validator";

export class SendTutorMessageDto {
  @IsString()
  @MaxLength(2000)
  content: string;

  @IsOptional()
  @IsString()
  imageS3Key?: string;
}
