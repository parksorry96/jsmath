import { Type } from "class-transformer";
import {
  IsString,
  IsOptional,
  IsDateString,
  IsObject,
  ValidateNested,
  ArrayMaxSize,
  IsIn,
} from "class-validator";

const ALLOWED_EVENT_TYPES = [
  "answer_submitted",
  "session_started",
  "session_ended",
] as const;

export class LearningEventDto {
  @IsIn(ALLOWED_EVENT_TYPES)
  eventType: string;

  @IsString()
  sessionId: string;

  @IsOptional()
  @IsString()
  problemId?: string;

  @IsOptional()
  @IsString()
  assignmentId?: string;

  @IsObject()
  payload: Record<string, unknown>;

  @IsDateString()
  clientTs: string;

  @IsOptional()
  @IsString()
  deviceType?: string;

  @IsOptional()
  @IsString()
  appVersion?: string;
}

export class BatchEventsDto {
  @ValidateNested({ each: true })
  @Type(() => LearningEventDto)
  @ArrayMaxSize(100)
  events: LearningEventDto[];
}
