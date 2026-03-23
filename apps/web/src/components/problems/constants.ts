export const EXAM_TYPE_LABELS: Record<string, string> = {
  suneung: '수능',
  mock_pyeongga: '모의평가',
  mock_gyoyuk: '학력평가',
};

export const EXAM_TYPE_SHORT_LABELS: Record<string, string> = {
  suneung: '수능',
  mock_pyeongga: '모평',
  mock_gyoyuk: '학평',
};

export interface RawExamSource {
  academicYear?: number | null;
  year?: number | null;
  month?: number | null;
  type?: string | null;
  subject?: string | null;
  form?: string | null;
  number?: number | string | null;
  isCommon?: boolean | null;
}

export const EXAM_MONTHS = [3, 4, 6, 7, 9, 10, 11] as const;

export const POSITION_LABELS: Record<string, string> = {
  killer: '킬러',
  semi_killer: '준킬러',
  normal: '일반',
};

export const POSITION_COLORS: Record<string, string> = {
  killer: 'text-red-500 bg-red-500/10 border-red-500/30',
  semi_killer: 'text-yellow-500 bg-yellow-500/10 border-yellow-500/30',
  normal: 'text-muted-foreground bg-muted/50',
};

export function getPosition(correctRate: number | null): string | null {
  if (correctRate === null || correctRate === undefined) return null;
  if (correctRate < 0.10) return 'killer';
  if (correctRate <= 0.30) return 'semi_killer';
  return 'normal';
}

export function getCorrectRateColor(rate: number): string {
  if (rate < 0.10) return 'text-red-500';
  if (rate <= 0.30) return 'text-orange-500';
  if (rate <= 0.60) return 'text-yellow-500';
  if (rate <= 0.80) return 'text-green-500';
  return 'text-emerald-400';
}

export function formatExamSource(
  examYear?: number, examMonth?: number, examType?: string,
  questionNumber?: number, subject?: string, academicYear?: number,
): { line1: string; line2: string } {
  if (!examYear || !examType) return { line1: '', line2: '' };
  const typeLabel = EXAM_TYPE_SHORT_LABELS[examType] ?? examType;
  const monthPrefix = examMonth ? `${examMonth}월 ` : '';
  const yearLabel = academicYear ? `${academicYear}학년도` : `${examYear}년`;
  const line1 = examType === 'suneung'
    ? `${yearLabel} ${typeLabel}`
    : `${yearLabel} ${monthPrefix}${typeLabel}`;
  return {
    line1,
    line2: subject ?? '',
  };
}

export function formatRawExamSource(
  examSource?: RawExamSource | null,
): { line1: string; line2: string } {
  if (!examSource?.type || !examSource.year) return { line1: '', line2: '' };
  return formatExamSource(
    examSource.year,
    examSource.month ?? undefined,
    examSource.type,
    typeof examSource.number === 'number' ? examSource.number : undefined,
    examSource.subject ?? undefined,
    examSource.academicYear ?? undefined,
  );
}

function extractProblemNumber(problemNumber?: string | null, displayNumber?: string | null): string | null {
  const candidates = [problemNumber, displayNumber];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const match = candidate.match(/\d{1,3}/);
    if (match) return match[0];
  }
  return null;
}

function getElectiveSubjectLabel(subject?: string | null): string | null {
  if (!subject) return null;
  const normalized = subject.replace(/\s+/g, '');
  if (normalized === '확률과통계') return '확통';
  if (normalized === '미적분') return '미적분';
  if (normalized === '기하') return '기하';
  return null;
}

export function formatProblemNumberLabel(
  problemNumber?: string | null,
  displayNumber?: string | null,
  subject?: string | null,
): string {
  const numeric = extractProblemNumber(problemNumber, displayNumber);
  if (!numeric) return '?';
  const electiveLabel = getElectiveSubjectLabel(subject);
  return electiveLabel ? `${electiveLabel}-${numeric}번` : `${numeric}번`;
}

export const PROBLEM_TYPE_LABELS: Record<string, string> = {
  multiple_choice: '객관식',
  short_answer: '주관식',
  written_solution: '서술형',
  essay: '서술형',
  true_false: 'O/X',
};

export const REVIEW_STATUS_STYLES: Record<string, { label: string; className: string }> = {
  approved: {
    label: '승인',
    className: 'bg-green-900/30 text-green-400 border-green-400/30',
  },
  pending_review: {
    label: '검수대기',
    className: 'bg-yellow-900/30 text-yellow-400 border-yellow-400/30',
  },
  rejected: {
    label: '반려',
    className: 'bg-red-900/30 text-red-400 border-red-400/30',
  },
  auto_approved: {
    label: '자동승인',
    className: 'bg-green-900/30 text-green-400 border-green-400/30',
  },
};

export function difficultyLabel(d: number | null): string | null {
  if (d === null) return null;
  if (d <= 1) return '기초';
  if (d <= 2) return '쉬움';
  if (d <= 3) return '보통';
  if (d <= 4) return '어려움';
  if (d <= 5) return '최상';
  return '최상';
}

export function difficultyColor(d: number | null): string {
  if (d === null) return '';
  if (d <= 1) return 'bg-green-900/30 text-green-400';
  if (d <= 2) return 'bg-emerald-900/30 text-emerald-400';
  if (d <= 3) return 'bg-yellow-900/30 text-yellow-400';
  if (d <= 4) return 'bg-orange-900/30 text-orange-400';
  return 'bg-red-900/30 text-red-400';
}

export function difficultyBadgeClass(d: number): string {
  if (d <= 2) return 'bg-green-500/20 text-green-400 border-green-500/30';
  if (d <= 3) return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
  return 'bg-red-500/20 text-red-400 border-red-500/30';
}

export function getCorrectRateBarColor(rate: number): string {
  if (rate < 0.10) return 'bg-red-500';
  if (rate <= 0.30) return 'bg-orange-500';
  if (rate <= 0.60) return 'bg-yellow-500';
  if (rate <= 0.80) return 'bg-green-500';
  return 'bg-emerald-400';
}

export const QUESTION_FORMAT_LABELS: Record<string, string> = {
  multiple_choice_5: '5지선다',
  short_answer: '주관식',
};

export interface Preset {
  label: string;
  filters: Record<string, string | number>;
}

export const PRESETS: Preset[] = [
  { label: '전체', filters: {} },
  { label: '2025 수능', filters: { examYear: 2025, examMonth: 11, examType: 'suneung' } },
  { label: '2025 6월 모평', filters: { examYear: 2025, examMonth: 6, examType: 'mock_pyeongga' } },
  { label: '2025 9월 모평', filters: { examYear: 2025, examMonth: 9, examType: 'mock_pyeongga' } },
  { label: '킬러 모음', filters: { correctRateMax: 10 } },
  { label: '정답률 30% 이하', filters: { correctRateMax: 30 } },
  { label: '최근 3년 교육청', filters: { examYearMin: 2023, examType: 'mock_gyoyuk' } },
];
