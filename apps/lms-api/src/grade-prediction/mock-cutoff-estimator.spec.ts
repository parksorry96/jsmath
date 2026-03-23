import {
  estimateMockCutoffs,
  HistoricalExamInput,
  MockExamItemInput,
} from "./mock-cutoff-estimator";

describe("mockCutoffEstimator", () => {
  const history = buildHistory();

  it("predicts a higher 1-grade cutoff for an easier mock exam", () => {
    const easierCandidate = makeItems(0.83, 0.04, 0.55);
    const harderCandidate = makeItems(0.5, 0.05, 0.4);

    const easier = estimateMockCutoffs("수학", easierCandidate, history);
    const harder = estimateMockCutoffs("수학", harderCandidate, history);

    expect(getGradeScore(easier, 1)).toBeGreaterThan(getGradeScore(harder, 1));
    expect(getGradeScore(easier, 3)).toBeGreaterThan(getGradeScore(harder, 3));
  });

  it("anchors the prediction to the most similar recent exams", () => {
    const candidate = makeItems(0.53, 0.04, 0.48);
    const result = estimateMockCutoffs("수학", candidate, history);

    expect(result.anchorExams[0]).toBeDefined();
    expect([2022, 2023, 2024]).toContain(result.anchorExams[0].examYear);
    expect(result.anchorExams[0].similarity).toBeGreaterThan(0);
  });

  it("keeps predicted cutoffs monotone and ends grade 9 at zero", () => {
    const candidate = makeItems(0.62, 0.06, 0.5);
    const result = estimateMockCutoffs("수학", candidate, history);
    const scores = result.predictedCutoffs.map((row) => row.predictedDisplayScore);

    for (let index = 1; index < scores.length; index++) {
      expect(scores[index - 1]).toBeGreaterThanOrEqual(scores[index]);
    }

    expect(scores[8]).toBe(0);
    expect(result.confidence).toBeGreaterThan(0.2);
  });
});

function buildHistory(): HistoricalExamInput[] {
  return [
    makeExam(2016, 11, 0.86, 0.03, 94),
    makeExam(2017, 11, 0.82, 0.03, 91),
    makeExam(2018, 11, 0.78, 0.04, 88),
    makeExam(2019, 11, 0.73, 0.04, 84),
    makeExam(2020, 11, 0.67, 0.05, 80),
    makeExam(2021, 11, 0.6, 0.05, 76),
    makeExam(2022, 11, 0.52, 0.06, 72),
    makeExam(2023, 11, 0.48, 0.06, 69),
    makeExam(2024, 11, 0.55, 0.05, 74),
  ];
}

function makeExam(
  year: number,
  month: number,
  baseCorrectRate: number,
  spread: number,
  grade1: number,
): HistoricalExamInput {
  return {
    examYear: year,
    examMonth: month,
    examType: "suneung",
    subject: "수학",
    items: makeItems(baseCorrectRate, spread, 0.45),
    cutoffs: buildCutoffs(grade1),
  };
}

function makeItems(
  baseCorrectRate: number,
  spread: number,
  dominantWrongShare: number,
): MockExamItemInput[] {
  return Array.from({ length: 25 }, (_, index) => {
    const centeredOffset = ((index % 5) - 2) * spread;
    const correctRate = clamp(baseCorrectRate + centeredOffset, 0.05, 0.95);
    return {
      problemId: `p-${baseCorrectRate}-${index}`,
      subject: "수학",
      sourceExamType: "suneung",
      correctAnswer: "1",
      correctRate,
      pointValue: 4,
      choiceRates: buildChoiceRates(correctRate, dominantWrongShare),
    };
  });
}

function buildCutoffs(grade1: number) {
  const values = [
    grade1,
    Math.max(grade1 - 10, 0),
    Math.max(grade1 - 19, 0),
    Math.max(grade1 - 29, 0),
    Math.max(grade1 - 40, 0),
    Math.max(grade1 - 52, 0),
    Math.max(grade1 - 64, 0),
    Math.max(grade1 - 78, 0),
    0,
  ];

  return values.map((displayScore, index) => ({
    grade: index + 1,
    displayScore,
    percentile: [96, 89, 77, 60, 40, 23, 11, 4, 0][index],
  }));
}

function buildChoiceRates(
  correctRate: number,
  dominantWrongShare: number,
): Record<string, number> {
  const wrongRate = 1 - correctRate;
  const dominantWrong = wrongRate * dominantWrongShare;
  const tail = (wrongRate - dominantWrong) / 3;

  return {
    "1": correctRate,
    "2": dominantWrong,
    "3": tail,
    "4": tail,
    "5": tail,
  };
}

function getGradeScore(
  result: ReturnType<typeof estimateMockCutoffs>,
  grade: number,
): number {
  return (
    result.predictedCutoffs.find((row) => row.grade === grade)?.predictedDisplayScore ??
    0
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
