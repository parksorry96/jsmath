import { IsString, IsNotEmpty, IsOptional, IsDateString } from "class-validator";

export class CreateLessonDto {
  @IsString()
  @IsNotEmpty()
  classId: string;

  @IsString()
  @IsNotEmpty()
  title: string;

  @IsDateString()
  startAt: string;

  @IsDateString()
  endAt: string;

  @IsString()
  @IsOptional()
  recurrenceRule?: string; // RFC 5545 RRULE e.g. "FREQ=WEEKLY;BYDAY=TU,TH"

  @IsString()
  @IsOptional()
  location?: string;

  @IsString()
  @IsOptional()
  memo?: string;
}
