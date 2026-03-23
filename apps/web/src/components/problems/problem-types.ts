import type { ProblemLayoutMeta } from "./problem-stem-display";
import type { RawExamSource } from "./constants";

export interface ProblemExamMeta {
  examYear: number;
  examMonth: number;
  examType: string;
  subject: string;
  questionNumber: number;
  correctAnswer: string | null;
  correctRate: number | null;
  pointValue: number | null;
  choiceRates: Record<string, number> | null;
  isCommon: boolean | null;
}

export interface ProblemChoice {
  label?: string;
  contentText?: string;
  contentLatex?: string;
}

export interface ProblemAsset {
  id: string;
  kind: string;
  s3Key: string;
}

export interface ProblemBookSource {
  title?: string;
  chapter?: string;
  section?: string;
}

export interface Problem {
  id: string;
  displayNumber: string | null;
  problemNumber: string | null;
  stemText: string;
  stemLatex: string;
  problemType: string;
  bbox?: ProblemLayoutMeta | null;
  reviewStatus: string;
  gradeLevel: string | null;
  subject: string | null;
  unitMajor: string | null;
  unitMinor: string | null;
  difficulty: number | null;
  classificationConfidence: number | null;
  sourceFile: string | null;
  startPage: number | null;
  createdAt: string;
  similarity?: number;
  choices?: ProblemChoice[];
  assets?: ProblemAsset[];
  bookSource?: ProblemBookSource | null;
  examSource?: RawExamSource | null;
  examMeta?: ProblemExamMeta | null;
}
