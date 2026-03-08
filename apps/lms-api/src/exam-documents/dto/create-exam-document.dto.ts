import { IsString, IsIn, IsObject, IsOptional, IsArray, IsBoolean } from "class-validator";

export class CreateExamDocumentDto {
  @IsString()
  title: string;

  @IsIn(["exam", "workbook"])
  type: "exam" | "workbook";

  @IsObject()
  @IsOptional()
  headerConfig?: {
    title?: string;
    schoolName?: string;
    date?: string;
    duration?: number;
  };

  @IsObject()
  layoutConfig: {
    problemsPerPage?: number;
    showNameField?: boolean;
  };

  @IsObject()
  @IsOptional()
  coverConfig?: {
    title?: string;
    subtitle?: string;
    author?: string;
    year?: string;
    backgroundColor?: string;
  };

  @IsArray()
  @IsString({ each: true })
  problemIds: string[];

  @IsBoolean()
  @IsOptional()
  generateAnswerSheet?: boolean;
}
