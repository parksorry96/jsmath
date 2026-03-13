import { IsEnum, IsOptional, IsBoolean, IsInt, Min } from "class-validator";
import { Transform } from "class-transformer";
import { ErrorType } from "@prisma/client";

export class ListWrongAnswersDto {
  @IsOptional()
  @IsEnum(ErrorType)
  errorType?: ErrorType;

  @IsOptional()
  @Transform(({ value }) => value === "true")
  @IsBoolean()
  resolved?: boolean;

  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsInt()
  @Min(1)
  limit?: number;
}
