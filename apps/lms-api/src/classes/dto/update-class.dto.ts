import { IsString, IsOptional } from "class-validator";

export class UpdateClassDto {
  @IsString()
  @IsOptional()
  title?: string;

  @IsString()
  @IsOptional()
  description?: string;
}
