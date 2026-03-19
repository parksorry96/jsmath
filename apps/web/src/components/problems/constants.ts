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
  questionNumber?: number, subject?: string,
): { line1: string; line2: string } {
  if (!examYear || !examType) return { line1: '', line2: '' };
  const typeLabel = EXAM_TYPE_SHORT_LABELS[examType] ?? examType;
  const monthPrefix = examType !== 'suneung' && examMonth ? `${examMonth}월 ` : '';
  const qNum = questionNumber ? ` ${questionNumber}번` : '';
  return {
    line1: `${examYear}학년도 ${monthPrefix}${typeLabel}${qNum}`,
    line2: subject ?? '',
  };
}

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
