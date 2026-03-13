import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsDateString,
  IsEnum,
  IsInt,
  Min,
} from "class-validator";
import { BillingType, BillingStatus } from "@prisma/client";

export class CreateBillingDto {
  @IsString()
  @IsNotEmpty()
  studentId: string;

  @IsString()
  @IsOptional()
  classId?: string;

  @IsEnum(BillingType)
  type: BillingType;

  @IsInt()
  @Min(0)
  amount: number;

  @IsString()
  @IsOptional()
  description?: string;

  @IsDateString()
  billingMonth: string;
}

export class BulkGenerateBillingDto {
  @IsString()
  @IsNotEmpty()
  classId: string;

  @IsDateString()
  billingMonth: string;

  @IsEnum(BillingType)
  type: BillingType;

  @IsInt()
  @Min(0)
  amount: number;

  @IsString()
  @IsOptional()
  description?: string;
}

export class UpdateBillingStatusDto {
  @IsEnum(BillingStatus)
  status: BillingStatus;

  @IsDateString()
  @IsOptional()
  paidAt?: string;
}
