import { ConfigService } from "@nestjs/config";
import { TwinProblemService, type TwinProblemResult } from "./twin-problem.service";

function buildMultipleChoiceResult(
  overrides: Partial<TwinProblemResult["problem"]> = {},
): TwinProblemResult {
  return {
    sourceProblemId: "problem-1",
    model: "gpt-5.4",
    generatedAt: "2026-03-10T00:00:00.000Z",
    problem: {
      title: "쌍둥이 문제",
      variationNote: "조건을 바꿨습니다.",
      teacherNote: "개념은 유지했습니다.",
      problemType: "multiple_choice",
      subject: "수학",
      unitMajor: "수열",
      unitMinor: "등차수열",
      difficulty: 3,
      stemText: "문제 본문",
      stemLatex: "문제 본문",
      choices: [
        { label: "①", contentText: "-18", contentLatex: "-18" },
        { label: "②", contentText: "-15", contentLatex: "-15" },
        { label: "③", contentText: "-12", contentLatex: "-12" },
        { label: "④", contentText: "-9", contentLatex: "-9" },
        { label: "⑤", contentText: "-6", contentLatex: "-6" },
      ],
      correctChoiceLabel: "②",
      answerText: "② -15",
      solutionText:
        "1. 계산한다.\n2. 따라서 공차는 3이다.\n3. 정답은 $$\\boxed{\\text{②}}$$ 이다.",
      ...overrides,
    },
  };
}

describe("TwinProblemService", () => {
  const service = new TwinProblemService(new ConfigService());

  it("accepts multiple-choice answers when the answer includes label and value", () => {
    const result = buildMultipleChoiceResult();

    expect(() => service["assertConsistency"](result)).not.toThrow();
  });

  it("rejects multiple-choice answers when the answer label disagrees with correctChoiceLabel", () => {
    const result = buildMultipleChoiceResult({
      answerText: "③ -15",
    });

    expect(() => service["assertConsistency"](result)).toThrow(
      "객관식 쌍둥이 문제의 정답과 정답 선지가 일치하지 않습니다.",
    );
  });

  it("keeps strict answer-solution matching for non-multiple-choice problems", () => {
    const result = buildMultipleChoiceResult({
      problemType: "short_answer",
      choices: [],
      correctChoiceLabel: null,
      answerText: "5",
      solutionText: "계산하면 답은 4이다.",
    });

    expect(() => service["assertConsistency"](result)).toThrow(
      "쌍둥이 문제의 정답과 풀이가 일치하지 않아 다시 생성이 필요합니다.",
    );
  });

  it("accepts short-answer solutions whose final answer is written in bracketed display math", () => {
    const result = buildMultipleChoiceResult({
      problemType: "short_answer",
      choices: [],
      correctChoiceLabel: null,
      answerText: "\\frac{20500}{63}",
      solutionText:
        "1. 식을 정리한다.\n2. 따라서 최종값은 \\[\\frac{20500}{63}\\] 이다.",
    });

    expect(() => service["assertConsistency"](result)).not.toThrow();
  });

  it("accepts short-answer solutions whose final answer is written in parenthesized inline math", () => {
    const result = buildMultipleChoiceResult({
      problemType: "short_answer",
      choices: [],
      correctChoiceLabel: null,
      answerText: "x=2",
      solutionText: "정리하면 최종 정답은 \\(x=2\\) 이다.",
    });

    expect(() => service["assertConsistency"](result)).not.toThrow();
  });
});
