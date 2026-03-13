import { IsString, IsOptional, IsUrl } from "class-validator";

export class RegisterPlatformDto {
  @IsString()
  name: string;

  @IsString()
  issuer: string;

  @IsString()
  clientId: string;

  @IsUrl()
  authEndpoint: string;

  @IsUrl()
  tokenEndpoint: string;

  @IsUrl()
  jwksUri: string;

  @IsOptional()
  @IsString()
  deploymentId?: string;
}
