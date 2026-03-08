import { IsString, IsNotEmpty, IsOptional, IsDateString } from "class-validator";

export class CreateLessonDto {
  @IsString()
  @IsNotEmpty()
  classId: string;

  @IsString()
  @IsNotEmpty()
  title: string;

  @IsDateString()
  @IsOptional()
  startAt?: string;

  @IsDateString()
  @IsOptional()
  endAt?: string;

  @IsDateString()
  @IsOptional()
  startTime?: string;

  @IsDateString()
  @IsOptional()
  endTime?: string;

  @IsString()
  @IsOptional()
  recurrenceRule?: string; // RFC 5545 RRULE e.g. "FREQ=WEEKLY;BYDAY=TU,TH"

  @IsString()
  @IsOptional()
  rrule?: string;

  @IsString()
  @IsOptional()
  location?: string;

  @IsString()
  @IsOptional()
  memo?: string;
}
