import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsDateString,
  IsEnum,
  IsArray,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import { AttendanceStatus } from "@prisma/client";

export class CheckInDto {
  @IsString()
  @IsNotEmpty()
  studentId: string;

  @IsString()
  @IsNotEmpty()
  classId: string;

  @IsDateString()
  @IsOptional()
  date?: string;

  @IsEnum(AttendanceStatus)
  @IsOptional()
  status?: AttendanceStatus;

  @IsString()
  @IsOptional()
  note?: string;
}

class BulkCheckInRecord {
  @IsString()
  @IsNotEmpty()
  studentId: string;

  @IsEnum(AttendanceStatus)
  status: AttendanceStatus;

  @IsString()
  @IsOptional()
  note?: string;
}

export class BulkCheckInDto {
  @IsString()
  @IsNotEmpty()
  classId: string;

  @IsDateString()
  date: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BulkCheckInRecord)
  records: BulkCheckInRecord[];
}
