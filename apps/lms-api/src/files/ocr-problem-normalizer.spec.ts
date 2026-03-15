import { ProblemType } from "@prisma/client";
import { normalizeOcrProblem } from "../ingestion/ocr-problem-normalizer";

describe("normalizeOcrProblem", () => {
  it("parses embedded choices from the stem and upgrades the type", () => {
    const normalized = normalizeOcrProblem({
      problemType: "short_answer",
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
});
