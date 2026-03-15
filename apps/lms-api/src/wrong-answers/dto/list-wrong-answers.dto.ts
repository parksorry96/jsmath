import { IsEnum, IsOptional, IsBoolean, IsInt, Min } from "class-validator";
import { Transform } from "class-transformer";
import { ErrorType } from "@prisma/client";

function parseBooleanParam(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") {
      return true;
    }
    if (normalized === "false") {
      return false;
    }
  }

  return value;
}

function parseIntegerParam(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
    return Number.parseInt(value, 10);
  }

  return value;
}

export class ListWrongAnswersDto {
  @IsOptional()
  @IsEnum(ErrorType)
  errorType?: ErrorType;

  @IsOptional()
  @Transform(({ value }) => parseBooleanParam(value))
  @IsBoolean()
  resolved?: boolean;

  @IsOptional()
  @Transform(({ value }) => parseIntegerParam(value))
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Transform(({ value }) => parseIntegerParam(value))
  @IsInt()
  @Min(1)
  limit?: number;
}
