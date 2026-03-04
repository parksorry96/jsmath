export type Role = "admin" | "teacher" | "student";

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  organizationId: string;
}

export type OcrJobStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed"
  | "manual_review";

export interface OcrJob {
  id: string;
  fileId: string;
  status: OcrJobStatus;
  problemCount: number | null;
  createdAt: string;
  completedAt: string | null;
}

export interface RedisEvent<T = unknown> {
  type: string;
  payload: T;
  timestamp: string;
}

// ─── Problem Domain Types ───

export type ProblemType =
  | "multiple_choice"
  | "short_answer"
  | "written_solution"
  | "essay";

export type ReviewStatus =
  | "auto_approved"
  | "pending_review"
  | "approved"
  | "rejected";

export type AssetKind =
  | "graph"
  | "geometry"
  | "statistics"
  | "number_line"
  | "tree_diagram"
  | "venn_diagram"
  | "table"
  | "other";

export type GradeLevel = "high_1" | "high_2" | "high_3";

export type Difficulty = 1 | 2 | 3 | 4 | 5;

export interface ProblemChoice {
  id: string;
  position: number;
  label: string;
  contentLatex: string;
  contentText: string;
  isCorrect: boolean | null;
}

export interface ProblemAsset {
  id: string;
  kind: AssetKind;
  subKind: string | null;
  s3Key: string;
  format: string;
  widthPx: number | null;
  heightPx: number | null;
}

export type AnalysisStatus = "pending" | "analyzing" | "completed" | "failed";
export type QuestionFormat = "multiple_choice_5" | "short_answer";
export type PositionType = "normal" | "semi_killer" | "killer";
export type CsatSubject = "수학I" | "수학II" | "확률과 통계" | "미적분" | "기하";

export interface ExamSource {
  year: number;
  month: number;
  type: "수능" | "모의평가" | "학력평가";
  number?: number;
}

export interface SolutionStep {
  step: number;
  description: string;
  concept: string;
}

export interface Problem {
  id: string;
  ocrJobId: string;
  textbookId: string | null;
  startPage: number;
  endPage: number;
  problemNumber: string | null;
  displayNumber: string | null;
  parentId: string | null;
  stemLatex: string;
  stemText: string;
  problemType: ProblemType;
  gradeLevel: GradeLevel | null;
  subject: string | null;
  unitMajor: string | null;
  unitMinor: string | null;
  unitSub: string | null;
  difficulty: Difficulty | null;
  classificationConfidence: number | null;
  reviewStatus: ReviewStatus;
  // CSAT metadata
  isCommon: boolean | null;
  pointValue: number | null;
  questionFormat: QuestionFormat | null;
  positionType: PositionType | null;
  examSource: ExamSource | null;
  // AI analysis
  solutionStrategy: string | null;
  requiredConcepts: string[] | null;
  solutionSteps: SolutionStep[] | null;
  estimatedTimeSec: number | null;
  commonMistakes: string[] | null;
  difficultyRefined: number | null;
  analysisStatus: AnalysisStatus;
  analyzedAt: string | null;
  choices: ProblemChoice[];
  assets: ProblemAsset[];
  createdAt: string;
  updatedAt: string;
}

export interface ProblemSearchParams {
  query?: string;
  gradeLevel?: GradeLevel;
  subject?: string;
  unitMajor?: string;
  difficulty?: Difficulty;
  problemType?: ProblemType;
  reviewStatus?: ReviewStatus;
  textbookId?: string;
  page?: number;
  limit?: number;
}

// ─── Redis Event Payloads ───

export interface OcrCompletedPayload {
  ocrJobId: string;
  problemCount: number;
}

export interface OcrFailedPayload {
  ocrJobId: string;
  reason: string;
  retryable: boolean;
}

export interface ReviewNeededPayload {
  problemId: string;
  reason: string;
  confidence: number;
}

export interface ProblemSimilarity {
  id: string;
  problemId: string;
  similarProblemId: string;
  similarityScore: number;
  similarityType: "content" | "concept" | "structure";
}

export interface AnalysisRequestPayload {
  ocrJobId: string;
  problemIds: string[];
}

export interface AnalysisCompletedPayload {
  ocrJobId: string;
  analyzedCount: number;
  autoApprovedCount: number;
}
