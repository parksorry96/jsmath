export interface MockExamItemInput {
  itemId?: string;
  problemId?: string;
  subject?: string | null;
  sourceExamYear?: number | null;
  sourceExamMonth?: number | null;
  sourceExamType?: string | null;
  correctAnswer?: string | null;
  correctRate: number;
  pointValue?: number | null;
  choiceRates?: Record<string, number> | null;
}

export interface HistoricalCutoffInput {
  grade: number;
  displayScore: number;
  percentile?: number | null;
}

export interface HistoricalExamInput {
  examYear: number;
  examMonth: number;
  examType: string;
  subject: string;
  items: MockExamItemInput[];
  cutoffs: HistoricalCutoffInput[];
}

export interface MockExamFeatureSummary {
  totalPoints: number;
  itemCount: number;
  weightedCorrectRate: number;
  weightedWrongRate: number;
  weightedCorrectRateStd: number;
  killerPointShare: number;
  semiKillerPointShare: number;
  volatilityIndex: number;
  trapIndex: number;
  ambiguityIndex: number;
  choiceCoverage: number;
}

export interface PredictedGradeCutoff {
  grade: number;
  predictedDisplayScore: number;
  predictedRatio: number;
  anchorRatio: number;
  regressionRatio: number | null;
  expectedPercentile: number | null;
}

export interface MockCutoffAnchorExam {
  examYear: number;
  examMonth: number;
  examType: string;
  subject: string;
  similarity: number;
  totalPoints: number;
  cutoffs: HistoricalCutoffInput[];
}

export interface MockCutoffEstimationResult {
  subject: string;
  totalPoints: number;
  confidence: number;
  featureSummary: MockExamFeatureSummary;
  predictedCutoffs: PredictedGradeCutoff[];
  anchorExams: MockCutoffAnchorExam[];
  usableHistoricalExams: number;
}

type FeatureName =
  | "weightedWrongRate"
  | "weightedCorrectRateStd"
  | "killerPointShare"
  | "semiKillerPointShare"
  | "volatilityIndex"
  | "trapIndex"
  | "ambiguityIndex";

interface PreparedExam {
  examYear: number;
  examMonth: number;
  examType: string;
  subject: string;
  totalPoints: number;
  features: MockExamFeatureSummary;
  cutoffs: HistoricalCutoffInput[];
}

interface RegressionModel {
  intercept: number;
  weights: number[];
  means: number[];
  stds: number[];
}

const FEATURE_NAMES: FeatureName[] = [
  "weightedWrongRate",
  "weightedCorrectRateStd",
  "killerPointShare",
  "semiKillerPointShare",
  "volatilityIndex",
  "trapIndex",
  "ambiguityIndex",
];

const FEATURE_WEIGHTS: Record<FeatureName, number> = {
  weightedWrongRate: 0.34,
  weightedCorrectRateStd: 0.16,
  killerPointShare: 0.18,
  semiKillerPointShare: 0.12,
  volatilityIndex: 0.1,
  trapIndex: 0.07,
  ambiguityIndex: 0.03,
};

const MIN_PROBABILITY = 0.02;
const MAX_PROBABILITY = 0.98;
const DEFAULT_POINT_VALUE = 1;
const REGRESSION_LAMBDA = 0.9;

export function estimateMockCutoffs(
  subject: string,
  candidateItems: MockExamItemInput[],
  historicalExams: HistoricalExamInput[],
): MockCutoffEstimationResult {
  const normalizedCandidateItems = candidateItems
    .map(normalizeItem)
    .filter((item): item is NormalizedItem => item !== null);

  if (normalizedCandidateItems.length === 0) {
    throw new Error("No candidate items with valid correctRate were provided");
  }

  const candidateFeatures = summarizeExam(normalizedCandidateItems);
  const preparedHistorical = historicalExams
    .map(prepareHistoricalExam)
    .filter((exam): exam is PreparedExam => exam !== null);

  if (preparedHistorical.length === 0) {
    throw new Error("No historical exams with both item stats and cutoff data were found");
  }

  const similarityEntries = buildSimilarityEntries(
    candidateFeatures,
    preparedHistorical,
  );
  const anchorExams = similarityEntries.slice(0, 5).map((entry) => ({
    examYear: entry.exam.examYear,
    examMonth: entry.exam.examMonth,
    examType: entry.exam.examType,
    subject: entry.exam.subject,
    similarity: round(entry.weight, 4),
    totalPoints: entry.exam.totalPoints,
    cutoffs: entry.exam.cutoffs
      .slice()
      .sort((a, b) => a.grade - b.grade)
      .map((cutoff) => ({
        grade: cutoff.grade,
        displayScore: cutoff.displayScore,
        percentile: cutoff.percentile ?? null,
      })),
  }));

  const predictedCutoffs = buildPredictedCutoffs(
    candidateFeatures.totalPoints,
    candidateFeatures,
    preparedHistorical,
    similarityEntries,
  );

  return {
    subject,
    totalPoints: candidateFeatures.totalPoints,
    confidence: computeConfidence(
      candidateFeatures,
      preparedHistorical.length,
      similarityEntries,
    ),
    featureSummary: candidateFeatures,
    predictedCutoffs,
    anchorExams,
    usableHistoricalExams: preparedHistorical.length,
  };
}

interface NormalizedItem {
  itemId?: string;
  problemId?: string;
  subject?: string | null;
  sourceExamYear?: number | null;
  sourceExamMonth?: number | null;
  sourceExamType?: string | null;
  pointValue: number;
  correctRate: number;
  trapIndex: number;
  ambiguityIndex: number;
  hasChoiceData: boolean;
}

function normalizeItem(item: MockExamItemInput): NormalizedItem | null {
  if (!Number.isFinite(item.correctRate)) {
    return null;
  }

  const correctRate = clamp(item.correctRate, MIN_PROBABILITY, MAX_PROBABILITY);
  const pointValue =
    item.pointValue && Number.isFinite(item.pointValue) && item.pointValue > 0
      ? item.pointValue
      : DEFAULT_POINT_VALUE;
  const choiceRates = normalizeChoiceRates(item.choiceRates ?? null);
  const correctKey =
    normalizeChoiceKey(item.correctAnswer) ??
    inferCorrectChoiceKey(choiceRates, correctRate);
  const wrongChoiceRates = Object.entries(choiceRates).filter(
    ([key]) => key !== correctKey,
  );
  const normalizedWrongRates = normalizeDistribution(
    wrongChoiceRates.map(([, value]) => value),
  );

  let trapIndex = 0;
  let ambiguityIndex = 0;

  if (normalizedWrongRates.length > 0) {
    const dominantWrongShare = Math.max(...normalizedWrongRates);
    const entropy = normalizedEntropy(normalizedWrongRates);
    const wrongRate = 1 - correctRate;
    trapIndex = wrongRate * dominantWrongShare;
    ambiguityIndex = wrongRate * entropy;
  }

  return {
    itemId: item.itemId,
    problemId: item.problemId,
    subject: item.subject ?? null,
    sourceExamYear: item.sourceExamYear ?? null,
    sourceExamMonth: item.sourceExamMonth ?? null,
    sourceExamType: item.sourceExamType ?? null,
    pointValue,
    correctRate,
    trapIndex,
    ambiguityIndex,
    hasChoiceData: normalizedWrongRates.length > 0,
  };
}

function prepareHistoricalExam(exam: HistoricalExamInput): PreparedExam | null {
  const items = exam.items
    .map(normalizeItem)
    .filter((item): item is NormalizedItem => item !== null);

  if (items.length === 0 || exam.cutoffs.length === 0) {
    return null;
  }

  const cutoffs = exam.cutoffs
    .filter((cutoff) => Number.isFinite(cutoff.displayScore))
    .map((cutoff) => ({
      grade: cutoff.grade,
      displayScore: cutoff.displayScore,
      percentile: cutoff.percentile ?? null,
    }))
    .sort((a, b) => a.grade - b.grade);

  if (cutoffs.length === 0) {
    return null;
  }

  const features = summarizeExam(items);

  return {
    examYear: exam.examYear,
    examMonth: exam.examMonth,
    examType: exam.examType,
    subject: exam.subject,
    totalPoints: features.totalPoints,
    features,
    cutoffs,
  };
}

export function summarizeExam(items: MockExamItemInput[] | NormalizedItem[]): MockExamFeatureSummary {
  const normalizedItems = items
    .map((item) => normalizeItemLike(item))
    .filter((item): item is NormalizedItem => item !== null);

  if (normalizedItems.length === 0) {
    throw new Error("Cannot summarize an exam without valid items");
  }

  const totalPoints = normalizedItems.reduce(
    (sum, item) => sum + item.pointValue,
    0,
  );
  const weightedCorrectRate = sumBy(normalizedItems, (item) => item.pointValue * item.correctRate) / totalPoints;
  const weightedWrongRate = 1 - weightedCorrectRate;
  const weightedCorrectRateStd = Math.sqrt(
    sumBy(normalizedItems, (item) => {
      const diff = item.correctRate - weightedCorrectRate;
      return item.pointValue * diff * diff;
    }) / totalPoints,
  );
  const killerPointShare =
    sumBy(normalizedItems, (item) => (item.correctRate < 0.1 ? item.pointValue : 0)) /
    totalPoints;
  const semiKillerPointShare =
    sumBy(normalizedItems, (item) =>
      item.correctRate >= 0.1 && item.correctRate < 0.3 ? item.pointValue : 0,
    ) / totalPoints;
  const volatilityIndex =
    Math.sqrt(
      sumBy(normalizedItems, (item) =>
        item.pointValue * item.pointValue * item.correctRate * (1 - item.correctRate),
      ),
    ) / totalPoints;
  const trapIndex = sumBy(
    normalizedItems,
    (item) => item.pointValue * item.trapIndex,
  ) / totalPoints;
  const ambiguityIndex = sumBy(
    normalizedItems,
    (item) => item.pointValue * item.ambiguityIndex,
  ) / totalPoints;
  const choiceCoverage = sumBy(
    normalizedItems,
    (item) => item.pointValue * (item.hasChoiceData ? 1 : 0),
  ) / totalPoints;

  return {
    totalPoints,
    itemCount: normalizedItems.length,
    weightedCorrectRate: round(weightedCorrectRate, 4),
    weightedWrongRate: round(weightedWrongRate, 4),
    weightedCorrectRateStd: round(weightedCorrectRateStd, 4),
    killerPointShare: round(killerPointShare, 4),
    semiKillerPointShare: round(semiKillerPointShare, 4),
    volatilityIndex: round(volatilityIndex, 4),
    trapIndex: round(trapIndex, 4),
    ambiguityIndex: round(ambiguityIndex, 4),
    choiceCoverage: round(choiceCoverage, 4),
  };
}

function normalizeItemLike(
  item: MockExamItemInput | NormalizedItem,
): NormalizedItem | null {
  if ("hasChoiceData" in item && "trapIndex" in item && "ambiguityIndex" in item) {
    return item;
  }
  return normalizeItem(item);
}

function buildPredictedCutoffs(
  candidateTotalPoints: number,
  candidateFeatures: MockExamFeatureSummary,
  exams: PreparedExam[],
  similarityEntries: SimilarityEntry[],
): PredictedGradeCutoff[] {
  const predictions = Array.from({ length: 9 }, (_, index) => {
    const grade = index + 1;
    const gradeRows = exams
      .map((exam) => {
        const cutoff = exam.cutoffs.find((row) => row.grade === grade);
        if (!cutoff || exam.totalPoints <= 0) {
          return null;
        }
        return {
          exam,
          ratio: cutoff.displayScore / exam.totalPoints,
          percentile: cutoff.percentile ?? null,
        };
      })
      .filter((row): row is { exam: PreparedExam; ratio: number; percentile: number | null } => row !== null);

    if (gradeRows.length === 0) {
      const fallbackScore = grade === 9 ? 0 : candidateTotalPoints;
      return {
        grade,
        predictedDisplayScore: fallbackScore,
        predictedRatio: fallbackScore / candidateTotalPoints,
        anchorRatio: fallbackScore / candidateTotalPoints,
        regressionRatio: null,
        expectedPercentile: null,
      };
    }

    const weightMap = new Map(
      similarityEntries.map((entry) => [
        `${entry.exam.examYear}-${entry.exam.examMonth}-${entry.exam.examType}-${entry.exam.subject}`,
        entry.weight,
      ]),
    );
    const anchorRatio = weightedAverage(
      gradeRows.map((row) => ({
        value: row.ratio,
        weight:
          weightMap.get(
            `${row.exam.examYear}-${row.exam.examMonth}-${row.exam.examType}-${row.exam.subject}`,
          ) ?? 0,
      })),
    );
    const expectedPercentile = weightedAverageNullable(
      gradeRows.map((row) => ({
        value: row.percentile,
        weight:
          weightMap.get(
            `${row.exam.examYear}-${row.exam.examMonth}-${row.exam.examType}-${row.exam.subject}`,
          ) ?? 0,
      })),
    );

    const regressionModel =
      gradeRows.length >= FEATURE_NAMES.length + 2
        ? fitRegressionModel(
            gradeRows.map((row) => featureVector(row.exam.features)),
            gradeRows.map((row) => row.ratio),
          )
        : null;
    const regressionRatio = regressionModel
      ? predictRegression(regressionModel, featureVector(candidateFeatures))
      : null;

    const regressionBlendWeight =
      regressionModel && gradeRows.length > FEATURE_NAMES.length + 2
        ? Math.min(0.35, ((gradeRows.length - FEATURE_NAMES.length - 1) / 24) * 0.35)
        : 0;
    const blendedRatio = clamp(
      anchorRatio * (1 - regressionBlendWeight) +
        (regressionRatio ?? anchorRatio) * regressionBlendWeight,
      0,
      1,
    );

    return {
      grade,
      predictedDisplayScore: Math.round(blendedRatio * candidateTotalPoints),
      predictedRatio: blendedRatio,
      anchorRatio,
      regressionRatio,
      expectedPercentile,
    };
  });

  return enforceMonotoneCutoffs(predictions, candidateTotalPoints);
}

function enforceMonotoneCutoffs(
  cutoffs: PredictedGradeCutoff[],
  totalPoints: number,
): PredictedGradeCutoff[] {
  const sorted = cutoffs.slice().sort((a, b) => a.grade - b.grade);
  let previous = totalPoints;

  for (const cutoff of sorted) {
    cutoff.predictedDisplayScore = clampInteger(cutoff.predictedDisplayScore, 0, previous);
    cutoff.predictedRatio = totalPoints > 0 ? cutoff.predictedDisplayScore / totalPoints : 0;
    previous = cutoff.predictedDisplayScore;
  }

  const last = sorted[sorted.length - 1];
  last.predictedDisplayScore = 0;
  last.predictedRatio = 0;

  return sorted;
}

interface SimilarityEntry {
  exam: PreparedExam;
  weight: number;
  distance: number;
  candidateFeatures: MockExamFeatureSummary;
}

function buildSimilarityEntries(
  candidateFeatures: MockExamFeatureSummary,
  exams: PreparedExam[],
): SimilarityEntry[] {
  const matrices = exams.map((exam) => featureVector(exam.features));
  const stats = computeColumnStats(matrices);

  return exams
    .map((exam) => {
      const distance = weightedFeatureDistance(
        featureVector(candidateFeatures),
        featureVector(exam.features),
        stats.means,
        stats.stds,
      );
      const recencyWeight = 1 / (1 + Math.max(0, new Date().getFullYear() - exam.examYear) * 0.08);
      const weight = Math.exp(-distance) * recencyWeight;

      return {
        exam,
        weight,
        distance,
        candidateFeatures,
      };
    })
    .sort((a, b) => {
      if (b.weight === a.weight) {
        return a.distance - b.distance;
      }
      return b.weight - a.weight;
    });
}

function featureVector(features: MockExamFeatureSummary): number[] {
  return FEATURE_NAMES.map((name) => features[name]);
}

function weightedFeatureDistance(
  left: number[],
  right: number[],
  means: number[],
  stds: number[],
): number {
  let sum = 0;

  for (let index = 0; index < left.length; index++) {
    const scale = stds[index] > 0 ? stds[index] : 1;
    const diff = (left[index] - right[index]) / scale;
    sum += FEATURE_WEIGHTS[FEATURE_NAMES[index]] * diff * diff;
  }

  return Math.sqrt(sum);
}

function fitRegressionModel(samples: number[][], targets: number[]): RegressionModel | null {
  if (samples.length === 0 || samples.length !== targets.length) {
    return null;
  }

  const { means, stds } = computeColumnStats(samples);
  const design = samples.map((sample) => [
    1,
    ...sample.map((value, index) => (value - means[index]) / (stds[index] || 1)),
  ]);
  const xtx = Array.from({ length: design[0].length }, () =>
    Array.from({ length: design[0].length }, () => 0),
  );
  const xty = Array.from({ length: design[0].length }, () => 0);

  for (let rowIndex = 0; rowIndex < design.length; rowIndex++) {
    const row = design[rowIndex];
    const y = targets[rowIndex];

    for (let i = 0; i < row.length; i++) {
      xty[i] += row[i] * y;
      for (let j = 0; j < row.length; j++) {
        xtx[i][j] += row[i] * row[j];
      }
    }
  }

  for (let index = 1; index < xtx.length; index++) {
    xtx[index][index] += REGRESSION_LAMBDA;
  }

  const solution = solveLinearSystem(xtx, xty);
  if (!solution) {
    return null;
  }

  return {
    intercept: solution[0],
    weights: solution.slice(1),
    means,
    stds,
  };
}

function predictRegression(model: RegressionModel, sample: number[]): number {
  let value = model.intercept;

  for (let index = 0; index < sample.length; index++) {
    const standardized = (sample[index] - model.means[index]) / (model.stds[index] || 1);
    value += standardized * model.weights[index];
  }

  return value;
}

function solveLinearSystem(matrix: number[][], vector: number[]): number[] | null {
  const size = vector.length;
  const augmented = matrix.map((row, index) => [...row, vector[index]]);

  for (let pivot = 0; pivot < size; pivot++) {
    let pivotRow = pivot;
    for (let row = pivot + 1; row < size; row++) {
      if (Math.abs(augmented[row][pivot]) > Math.abs(augmented[pivotRow][pivot])) {
        pivotRow = row;
      }
    }

    if (Math.abs(augmented[pivotRow][pivot]) < 1e-8) {
      return null;
    }

    if (pivotRow !== pivot) {
      [augmented[pivot], augmented[pivotRow]] = [augmented[pivotRow], augmented[pivot]];
    }

    const pivotValue = augmented[pivot][pivot];
    for (let column = pivot; column <= size; column++) {
      augmented[pivot][column] /= pivotValue;
    }

    for (let row = 0; row < size; row++) {
      if (row === pivot) {
        continue;
      }
      const factor = augmented[row][pivot];
      for (let column = pivot; column <= size; column++) {
        augmented[row][column] -= factor * augmented[pivot][column];
      }
    }
  }

  return augmented.map((row) => row[size]);
}

function computeColumnStats(samples: number[][]): { means: number[]; stds: number[] } {
  const columns = samples[0]?.length ?? 0;
  const means = Array.from({ length: columns }, (_, index) =>
    samples.reduce((sum, row) => sum + row[index], 0) / samples.length,
  );
  const stds = Array.from({ length: columns }, (_, index) => {
    const variance =
      samples.reduce((sum, row) => {
        const diff = row[index] - means[index];
        return sum + diff * diff;
      }, 0) / Math.max(samples.length, 1);
    return Math.sqrt(variance) || 1;
  });

  return { means, stds };
}

function computeConfidence(
  candidateFeatures: MockExamFeatureSummary,
  historicalExamCount: number,
  similarityEntries: SimilarityEntry[],
): number {
  const itemCountScore = Math.min(1, candidateFeatures.itemCount / 20);
  const historicalScore = Math.min(1, historicalExamCount / 18);
  const similarityScore =
    similarityEntries.length === 0
      ? 0
      : Math.min(
          1,
          similarityEntries
            .slice(0, 3)
            .reduce((sum, entry) => sum + entry.weight, 0) /
            3,
        );

  return round(
    clamp(
      0.18 +
        itemCountScore * 0.22 +
        historicalScore * 0.28 +
        candidateFeatures.choiceCoverage * 0.12 +
        similarityScore * 0.2,
      0.2,
      0.94,
    ),
    4,
  );
}

function normalizeChoiceRates(
  choiceRates: Record<string, number> | null,
): Record<string, number> {
  if (!choiceRates) {
    return {};
  }

  const entries = Object.entries(choiceRates)
    .map(([key, value]) => [normalizeChoiceKey(key), value] as const)
    .filter(
      (entry): entry is readonly [string, number] =>
        Boolean(entry[0]) && Number.isFinite(entry[1]) && entry[1] > 0,
    );

  const total = entries.reduce((sum, [, value]) => sum + value, 0);
  if (total <= 0) {
    return {};
  }

  return Object.fromEntries(
    entries.map(([key, value]) => [key, value / total]),
  );
}

function normalizeChoiceKey(value?: string | null): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  const circledMap: Record<string, string> = {
    "①": "1",
    "②": "2",
    "③": "3",
    "④": "4",
    "⑤": "5",
    "⑥": "6",
    "⑦": "7",
    "⑧": "8",
    "⑨": "9",
  };

  if (circledMap[trimmed]) {
    return circledMap[trimmed];
  }

  const digitMatch = trimmed.match(/\d+/);
  if (digitMatch) {
    return digitMatch[0];
  }

  return trimmed || null;
}

function inferCorrectChoiceKey(
  choiceRates: Record<string, number>,
  correctRate: number,
): string | null {
  let selectedKey: string | null = null;
  let minDiff = Infinity;

  for (const [key, value] of Object.entries(choiceRates)) {
    const diff = Math.abs(value - correctRate);
    if (diff < minDiff) {
      minDiff = diff;
      selectedKey = key;
    }
  }

  return selectedKey;
}

function normalizeDistribution(values: number[]): number[] {
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total <= 0) {
    return [];
  }
  return values.map((value) => value / total);
}

function normalizedEntropy(values: number[]): number {
  if (values.length <= 1) {
    return 0;
  }

  const entropy = -values.reduce((sum, value) => {
    if (value <= 0) {
      return sum;
    }
    return sum + value * Math.log(value);
  }, 0);

  return entropy / Math.log(values.length);
}

function weightedAverage(rows: Array<{ value: number; weight: number }>): number {
  const totalWeight = rows.reduce((sum, row) => sum + row.weight, 0);
  if (totalWeight <= 0) {
    return rows.reduce((sum, row) => sum + row.value, 0) / rows.length;
  }

  return rows.reduce((sum, row) => sum + row.value * row.weight, 0) / totalWeight;
}

function weightedAverageNullable(
  rows: Array<{ value: number | null; weight: number }>,
): number | null {
  const filtered = rows.filter(
    (row): row is { value: number; weight: number } => row.value != null,
  );

  if (filtered.length === 0) {
    return null;
  }

  return round(weightedAverage(filtered), 2);
}

function sumBy<T>(items: T[], iteratee: (item: T) => number): number {
  return items.reduce((sum, item) => sum + iteratee(item), 0);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function round(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
