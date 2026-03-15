import {
  IsString,
  IsOptional,
  IsInt,
  IsBoolean,
  IsArray,
  Min,
  Max,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";

class UnitDistributionEntryDto {
  @IsOptional() @IsString() curriculumNodeId?: string;
  @IsOptional() @IsString() subject?: string;
  @IsOptional() @IsString() unitMajor?: string;
  @IsString() label: string;
  @Min(0) percentage: number;
  @IsOptional() @IsInt() @Min(0) minCount?: number;
  @IsOptional() @IsInt() @Min(0) maxCount?: number;
}

class DifficultyDistributionEntryDto {
  @Min(1) min: number;
  @Min(1) max: number;
  @IsString() label: string;
  @Min(0) percentage: number;
}

class TypeDistributionEntryDto {
  @IsString() problemType: string;
  @IsInt() @Min(0) count: number;
}

export class CreateBlueprintDto {
  @IsString()
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  gradeLevel?: string;

  @IsInt()
  @Min(1)
  @Max(200)
  totalQuestions: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  totalPoints?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  timeLimitMin?: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UnitDistributionEntryDto)
  unitDistribution: UnitDistributionEntryDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DifficultyDistributionEntryDto)
  difficultyDistribution: DifficultyDistributionEntryDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TypeDistributionEntryDto)
  typeDistribution: TypeDistributionEntryDto[];

  @IsOptional()
  @IsInt()
  @Min(0)
  excludeRecentDays?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  excludeProblemIds?: string[];

  @IsOptional()
  @IsBoolean()
  isTemplate?: boolean;
}
