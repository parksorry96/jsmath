export type Role = "admin" | "teacher" | "student" | "parent";

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

export type Difficulty = 1 | 2 | 3 | 4 | 5 | 6;

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

export interface CurriculumClassification {
  curriculumYear: 2015 | 2022;
  subject: string | null;
  unitMajor: string | null;
  unitMinor: string | null;
  unitSub: string | null;
  curriculumNodeId: string | null;
  confidence: number | null;
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
  classification2015: CurriculumClassification | null;
  classification2022: CurriculumClassification | null;
  difficulty: Difficulty | null;
  classificationConfidence: number | null;
  solutionConfidence: number | null;
  reviewConfidence: number | null;
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

// ─── Redis Streams (durable event delivery) ───

export const REDIS_STREAMS = {
  OCR_SUBMIT: 'stream:ocr:submit',
  OCR_COMPLETED: 'stream:ocr:completed',
  OCR_FAILED: 'stream:ocr:failed',
  ANALYSIS_REQUEST: 'stream:analysis:request',
  ANALYSIS_COMPLETED: 'stream:analysis:completed',
  ANALYSIS_FAILED: 'stream:analysis:failed',
  PHOTO_ANALYZE: 'stream:photo:analyze',
  PHOTO_COMPLETED: 'stream:photo:analysis:completed',
  PHOTO_FAILED: 'stream:photo:analysis:failed',
  PHOTO_RUBRIC: 'stream:photo:rubric',
  PHOTO_RUBRIC_COMPLETED: 'stream:photo:rubric:completed',
  PHOTO_RUBRIC_FAILED: 'stream:photo:rubric:failed',
} as const;

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

// ─── LMS Types ───

export interface Class {
  id: string;
  title: string;
  description: string | null;
  organizationId: string;
  createdAt: string;
  updatedAt: string;
}

export type LessonStatus = "scheduled" | "completed" | "cancelled";

export interface Lesson {
  id: string;
  classId: string;
  title: string;
  startAt: string;
  endAt: string;
  recurrenceRule: string | null;
  recurrenceParentId: string | null;
  status: LessonStatus;
  location: string | null;
  memo: string | null;
}

export type AssignmentType = "problem_set" | "text_task";

export interface Assignment {
  id: string;
  classId: string;
  title: string;
  description: string | null;
  type: AssignmentType;
  dueAt: string | null;
  maxScore: number;
  createdAt: string;
}

export type SubmissionType = "online" | "photo";
export type SubmissionStatus = "submitted" | "grading" | "graded" | "returned";

export interface Submission {
  id: string;
  assignmentId: string;
  studentId: string;
  type: SubmissionType;
  status: SubmissionStatus;
  score: number | null;
  maxScore: number | null;
  submittedAt: string;
  gradedAt: string | null;
}

export interface SubmissionAnswer {
  id: string;
  submissionId: string;
  problemId: string;
  studentAnswer: string | null;
  isCorrect: boolean | null;
  score: number | null;
  feedback: string | null;
}

export type PhotoAnalysisStatus = "pending" | "analyzing" | "completed" | "failed";

export interface PhotoFeedback {
  isCorrect: boolean;
  score: number;
  maxScore: number;
  steps: {
    step: number;
    content: string;
    correct: boolean;
    feedback?: string;
  }[];
  errorType: string | null;
  conceptHint: string | null;
  overallFeedback: string;
}

export interface Notification {
  id: string;
  userId: string;
  type: string;
  title: string;
  body: string;
  referenceType: string | null;
  referenceId: string | null;
  readAt: string | null;
  createdAt: string;
}

// ─── LMS Redis Event Payloads ───

export interface PhotoAnalysisRequestPayload {
  submissionPhotoId: string;
  s3Key: string;
  problemId: string;
  problemStemLatex: string;
  answerText: string | null;
  answerLatex: string | null;
}

export interface PhotoAnalysisCompletedPayload {
  submissionPhotoId: string;
  feedback: PhotoFeedback;
}

// ─── Gamification Types ───

export interface StudentGamificationProfile {
  xp: number;
  level: number;
  streaks: { streakType: string; currentStreak: number; longestStreak: number }[];
  achievements: { achievementKey: string; earnedAt: string }[];
}

export interface LeaderboardEntry {
  rank: number;
  studentId: string;
  name: string;
  xp: number;
  level: number;
}

// ─── Attendance Types ───

export type AttendanceStatus = "present" | "absent" | "late" | "excused";

// ─── Billing Types ───

export type BillingType = "tuition" | "material" | "extra_class" | "other";
export type BillingStatus = "pending" | "paid" | "overdue" | "cancelled";

// ─── Grade Prediction Types ───

export interface GradePrediction {
  subject: string;
  predictedScore: number;
  predictedGrade: number;
  percentile: number | null;
  confidence: number;
}

// ─── Parent Weekly Report Types ───

export interface WeeklyReportSummary {
  assignmentCompletionRate: number;
  avgScore: number | null;
  problemsSolved: number;
  correctRate: number | null;
  lessonsAttended: number;
  lessonsTotal: number;
}

// ─── Exam Blueprint Types ───

export interface UnitDistributionEntry {
  curriculumNodeId?: string;
  subject?: string;
  unitMajor?: string;
  label: string;
  percentage: number;
  minCount?: number;
  maxCount?: number;
}

export interface DifficultyDistributionEntry {
  min: number;
  max: number;
  label: string;
  percentage: number;
}

export interface TypeDistributionEntry {
  problemType: string;
  count: number;
}

// Student AI types
export type ErrorType = "concept_gap" | "pattern_gap" | "calculation_error" | "careless_mistake";

export interface WeaknessUnit {
  subject: string;
  unitMajor: string;
  accuracy: number;
  attemptCount: number;
  topErrorType: ErrorType | null;
}

export interface Recommendation {
  problemId: string;
  reason: "root_cause_basic" | "common_mistake" | "spaced_review" | "similar_expansion";
  reasonDetail: string;
  priority: number;
  difficulty: number;
}

export interface RecommendationResult {
  recommendations: Recommendation[];
  summary: string;
}
