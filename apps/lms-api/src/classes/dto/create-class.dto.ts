import { IsString, IsOptional, IsNotEmpty } from "class-validator";

export class CreateClassDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsNotEmpty()
  organizationId: string;
}
