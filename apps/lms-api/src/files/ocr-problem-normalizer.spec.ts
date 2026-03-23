import { ProblemType } from "@prisma/client";
import { normalizeOcrProblem } from "../ingestion/ocr-problem-normalizer";

describe("normalizeOcrProblem", () => {
  it("parses embedded choices from the stem and upgrades the type when unclassified", () => {
    const normalized = normalizeOcrProblem({
      stemLatex:
        "다음 중 옳은 것은?\n① 1\n② 2\n③ 3\n④ 4\n⑤ 5",
      stemText:
        "다음 중 옳은 것은?\n① 1\n② 2\n③ 3\n④ 4\n⑤ 5",
    });

    expect(normalized.problemType).toBe(ProblemType.multiple_choice);
    expect(normalized.stemText).toBe("다음 중 옳은 것은?");
    expect(normalized.stemLatex).toBe("다음 중 옳은 것은?");
    expect(normalized.choices).toHaveLength(5);
    expect(normalized.choices[0]).toMatchObject({
      position: 1,
      label: "①",
      contentText: "1",
      contentLatex: "1",
    });
    expect(normalized.choices[4]).toMatchObject({
      position: 5,
      label: "⑤",
      contentText: "5",
      contentLatex: "5",
    });
  });

  it("falls back to stem parsing when OCR sent a collapsed single choice", () => {
    const normalized = normalizeOcrProblem({
      problemType: "multiple_choice",
      stemLatex:
        "함수 f(x)=x^2일 때 옳은 것은?\n① f(1)=0  ② f(1)=1  ③ f(2)=2  ④ f(2)=3  ⑤ f(2)=4",
      stemText:
        "함수 f(x)=x^2일 때 옳은 것은?\n① f(1)=0  ② f(1)=1  ③ f(2)=2  ④ f(2)=3  ⑤ f(2)=4",
      choices: [
        {
          position: 1,
          label: "①",
          contentLatex: "f(1)=0  ② f(1)=1  ③ f(2)=2  ④ f(2)=3  ⑤ f(2)=4",
          contentText: "f(1)=0  ② f(1)=1  ③ f(2)=2  ④ f(2)=3  ⑤ f(2)=4",
        },
      ],
    });

    expect(normalized.problemType).toBe(ProblemType.multiple_choice);
    expect(normalized.stemText).toBe("함수 f(x)=x^2일 때 옳은 것은?");
    expect(normalized.choices).toHaveLength(5);
    expect(normalized.choices.map((choice) => choice.label)).toEqual([
      "①",
      "②",
      "③",
      "④",
      "⑤",
    ]);
    expect(normalized.choices[1].contentText).toBe("f(1)=1");
    expect(normalized.choices[4].contentText).toBe("f(2)=4");
  });

  it("parses out-of-order line choices and upgrades the type when unclassified", () => {
    const normalized = normalizeOcrProblem({
      stemLatex:
        "1. 값은?\n(2) 2\n(4) 4\n(1) 1\n(3) 3\n(5) 5",
      stemText:
        "1. 값은?\n(2) 2\n(4) 4\n(1) 1\n(3) 3\n(5) 5",
    });

    expect(normalized.problemType).toBe(ProblemType.multiple_choice);
    expect(normalized.stemText).toBe("값은?");
    expect(normalized.choices.map((choice) => choice.position)).toEqual([
      1, 2, 3, 4, 5,
    ]);
    expect(normalized.choices.map((choice) => choice.contentText)).toEqual([
      "1", "2", "3", "4", "5",
    ]);
  });

  it("ignores stray choice lines outside the main choice block", () => {
    const normalized = normalizeOcrProblem({
      stemLatex:
        "10. 어떤 값은?\n설명이 이어진다.\n(3) 0\n본문이 계속된다.\n정답을 고르시오.\n(1) 11\n(2) 12\n(3) 13\n(5) 15\n(4) 14\n[4점]\n(4) 99\n(5) 100",
      stemText:
        "10. 어떤 값은?\n설명이 이어진다.\n(3) 0\n본문이 계속된다.\n정답을 고르시오.\n(1) 11\n(2) 12\n(3) 13\n(5) 15\n(4) 14\n[4점]\n(4) 99\n(5) 100",
    });

    expect(normalized.problemType).toBe(ProblemType.multiple_choice);
    expect(normalized.stemText).toBe(
      "어떤 값은?\n설명이 이어진다.\n본문이 계속된다.\n정답을 고르시오.",
    );
    expect(normalized.choices.map((choice) => choice.contentText)).toEqual([
      "11", "12", "13", "14", "15",
    ]);
  });

  it("does not force-upgrade explicit short_answer even when stem contains numbered lines", () => {
    const normalized = normalizeOcrProblem({
      problemType: "short_answer",
      stemLatex:
        "다음 절차를 순서대로 나열하시오.\n① 첫 번째\n② 두 번째\n③ 세 번째\n④ 네 번째\n⑤ 다섯 번째",
      stemText:
        "다음 절차를 순서대로 나열하시오.\n① 첫 번째\n② 두 번째\n③ 세 번째\n④ 네 번째\n⑤ 다섯 번째",
    });

    expect(normalized.problemType).toBe(ProblemType.short_answer);
    expect(normalized.choices).toHaveLength(0);
    expect(normalized.stemText).toContain("다음 절차를 순서대로 나열하시오.");
  });

  it("strips a leading problem number from stored stems even without choices", () => {
    const normalized = normalizeOcrProblem({
      problemType: "short_answer",
      stemLatex: "29. 함수의 값을 구하시오.",
      stemText: "29. 함수의 값을 구하시오.",
    });

    expect(normalized.stemText).toBe("함수의 값을 구하시오.");
    expect(normalized.stemLatex).toBe("함수의 값을 구하시오.");
  });
});
