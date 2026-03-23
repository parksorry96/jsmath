import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from "class-validator";

export class PredictMockCutoffItemDto {
  @IsOptional()
  @IsString()
  problemId?: string;

  @IsOptional()
  @IsString()
  subject?: string;

  @IsOptional()
  @IsInt()
  sourceExamYear?: number;

  @IsOptional()
  @IsInt()
  sourceExamMonth?: number;

  @IsOptional()
  @IsString()
  sourceExamType?: string;

  @IsOptional()
  @IsString()
  correctAnswer?: string;

  @IsNumber()
  @Min(0)
  @Max(1)
  correctRate!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  pointValue?: number;

  @IsOptional()
  @IsObject()
  choiceRates?: Record<string, number>;
}

export class PredictMockCutoffsDto {
  @IsOptional()
  @IsString()
  subject?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsString({ each: true })
  problemIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => PredictMockCutoffItemDto)
  items?: PredictMockCutoffItemDto[];

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(12)
  @IsString({ each: true })
  examTypes?: string[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(15)
  lookbackYears?: number;
}
