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
