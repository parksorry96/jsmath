import { IsEnum } from "class-validator";
import { ErrorType } from "@prisma/client";

export class ClassifyErrorDto {
  @IsEnum(ErrorType)
  errorType: ErrorType;
}
