import { IsIn, IsOptional, IsString, IsInt } from "class-validator";

export class UpdatePreferencesDto {
  @IsOptional()
  @IsString()
  @IsIn(["중1", "중2", "중3", "고1", "고2", "고3"])
  gradeLevel?: string;

  @IsOptional()
  @IsInt()
  @IsIn([2015, 2022])
  curriculumYear?: number;
}
