import { IsEmail, IsString, MinLength, IsOptional, IsIn } from "class-validator";

export const PUBLIC_REGISTRATION_ROLES = [
  "student",
] as const;

export type PublicRegistrationRole = (typeof PUBLIC_REGISTRATION_ROLES)[number];

export class RegisterDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(2)
  name: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsOptional()
  @IsIn(PUBLIC_REGISTRATION_ROLES)
  role?: PublicRegistrationRole;
}
