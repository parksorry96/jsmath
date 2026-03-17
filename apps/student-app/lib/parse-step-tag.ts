export interface StepTag {
  currentStep: number;
  totalSteps: number;
  cleanContent: string;
}

export function parseStepTag(content: string): StepTag | null {
  const match = content.match(/^\s*\[STEP:(\d+)\/(\d+)\]\s*/);
  if (!match) return null;

  const currentStep = parseInt(match[1], 10);
  const totalSteps = parseInt(match[2], 10);

  if (currentStep < 1 || totalSteps < 1 || currentStep > totalSteps || totalSteps > 8) {
    return null;
  }

  return {
    currentStep,
    totalSteps,
    cleanContent: content.replace(/^\s*\[STEP:\d+\/\d+\]\s*/, ''),
  };
}

export function normalizeTutorMessage(content: string) {
  const parsed = parseStepTag(content);

  return {
    content: parsed?.cleanContent ?? content,
    stepProgress: parsed
      ? { current: parsed.currentStep, total: parsed.totalSteps }
      : null,
  };
}
