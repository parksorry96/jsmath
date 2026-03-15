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
    previewPlan?: {
      columns?: number;
      pages?: {
        columns?: {
          items?: {
            globalIndex?: number;
            problemId?: string;
            span?: number;
          }[];
        }[];
      }[];
      rowsPerColumn?: number;
    };
  };

  @IsObject()
  @IsOptional()
  coverConfig?: {
    accentColor?: string;
    backgroundColor?: string;
    elements?: {
      author?: { align?: "left" | "center" | "right"; x?: number; y?: number };
      subtitle?: { align?: "left" | "center" | "right"; x?: number; y?: number };
      title?: { align?: "left" | "center" | "right"; x?: number; y?: number };
      year?: { align?: "left" | "center" | "right"; x?: number; y?: number };
    };
    mutedTextColor?: string;
    paletteId?: string;
    style?: "editorial" | "band" | "split";
    textColor?: string;
    title?: string;
    subtitle?: string;
    author?: string;
    year?: string;
  };

  @IsArray()
  @IsString({ each: true })
  problemIds: string[];

  @IsBoolean()
  @IsOptional()
  generateAnswerSheet?: boolean;

  @IsIn(["private", "public"])
  @IsOptional()
  visibility?: "private" | "public";
}
