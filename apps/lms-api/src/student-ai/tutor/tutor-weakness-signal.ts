export type TutorWeaknessErrorType =
  | "concept_gap"
  | "pattern_gap"
  | "calculation_error"
  | "careless_mistake";

export interface TutorWeaknessSignal {
  source: "tutor_message" | "worked_solution";
  problemId: string;
  curriculumNodeId: string | null;
  subject: string | null;
  unitMajor: string | null;
  errorType: TutorWeaknessErrorType | null;
  confidence: number;
  evidence: string;
}

export function extractTutorWeaknessSignal(
  metadata: unknown,
): TutorWeaknessSignal | null {
  if (!metadata || typeof metadata !== "object" || !("weaknessSignal" in metadata)) {
    return null;
  }

  const signal = (metadata as { weaknessSignal?: unknown }).weaknessSignal;
  if (!signal || typeof signal !== "object") {
    return null;
  }

  const candidate = signal as Partial<TutorWeaknessSignal>;
  if (
    candidate.source !== "tutor_message" &&
    candidate.source !== "worked_solution"
  ) {
    return null;
  }

  if (typeof candidate.problemId !== "string" || candidate.problemId.length === 0) {
    return null;
  }

  if (typeof candidate.confidence !== "number" || Number.isNaN(candidate.confidence)) {
    return null;
  }

  if (typeof candidate.evidence !== "string") {
    return null;
  }

  const errorType =
    candidate.errorType === "concept_gap" ||
    candidate.errorType === "pattern_gap" ||
    candidate.errorType === "calculation_error" ||
    candidate.errorType === "careless_mistake"
      ? candidate.errorType
      : null;

  return {
    source: candidate.source,
    problemId: candidate.problemId,
    curriculumNodeId:
      typeof candidate.curriculumNodeId === "string"
        ? candidate.curriculumNodeId
        : null,
    subject: typeof candidate.subject === "string" ? candidate.subject : null,
    unitMajor:
      typeof candidate.unitMajor === "string" ? candidate.unitMajor : null,
    errorType,
    confidence: candidate.confidence,
    evidence: candidate.evidence,
  };
}

export function tutorRootCauseKey(
  signal: Pick<TutorWeaknessSignal, "subject" | "unitMajor">,
): string | null {
  if (!signal.subject || !signal.unitMajor) {
    return null;
  }

  return `${signal.subject}::${signal.unitMajor}`;
}
