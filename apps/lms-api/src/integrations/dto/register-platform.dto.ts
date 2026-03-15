import { IsString, IsOptional, IsUrl } from "class-validator";

const HTTPS_URL = { protocols: ["https"], require_protocol: true };

export class RegisterPlatformDto {
  @IsString()
  name: string;

  @IsString()
  issuer: string;

  @IsString()
  clientId: string;

  @IsUrl(HTTPS_URL)
  authEndpoint: string;

  @IsUrl(HTTPS_URL)
  tokenEndpoint: string;

  @IsUrl(HTTPS_URL)
  jwksUri: string;

  @IsOptional()
  @IsString()
  deploymentId?: string;
}
