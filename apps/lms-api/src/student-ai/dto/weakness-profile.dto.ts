import { IsOptional, IsString } from "class-validator";

export class WeaknessQueryDto {
  @IsOptional()
  @IsString()
  subject?: string;
}
