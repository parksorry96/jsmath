import {
  buildPrintLayout,
  buildSlotHeightExpression,
  escapeLatexText,
  paginateProblemsForPrint,
  renderChoiceLatexOrText,
  renderInlineLatexOrText,
  renderLatexOrText,
  renderNarrativeLatexOrText,
  renderSolutionStep,
  resolveProblemForPrint,
  resolvePrintPages,
} from "./latex-template.helpers";

describe("latexTemplateHelpers", () => {
  it("escapes LaTeX special characters in plain text", () => {
    expect(escapeLatexText("제목_1 50% #1")).toBe("제목\\_1 50\\% \\#1");
  });

  it("keeps LaTeX fields raw and escapes text fallback", () => {
    expect(renderLatexOrText("b_n = 2n", "unused_text")).toBe(
      "\\ensuremath{b_n = 2n}",
    );
    expect(renderLatexOrText("", "b_1 = 2")).toBe("b\\_1 = 2");
  });

  it("downgrades forbidden LaTeX commands to escaped text", () => {
    expect(renderLatexOrText("\\input{/etc/passwd}", "fallback")).toBe("fallback");
    expect(renderInlineLatexOrText("\\write18{touch pwned}", "")).toBe(
      "\\textbackslash{}write18\\{touch pwned\\}",
    );
  });

  it("wraps display math environments that arrive without delimiters", () => {
    expect(renderLatexOrText("\\begin{cases}x^2 & x > 0\\\\0 & x \\le 0\\end{cases}", "")).toBe(
      "\\[\\begin{cases}x^2 & x > 0\\\\0 & x \\le 0\\end{cases}\\]",
    );
    expect(
      renderLatexOrText(
        "함수 f(x)가 다음을 만족한다. \\\\begin{cases}x^2 & x > 0\\\\\\\\0 & x \\le 0\\\\end{cases}",
        "",
      ),
    ).toBe(
      "함수 f(x)가 다음을 만족한다. \\textbackslash{}\\[\\begin{cases}x^2 & x > 0\\\\\\\\0 & x \\le 0\\\\end{cases}\\]",
    );
  });

  it("repairs dangling inline math delimiters inside Korean narrative", () => {
    expect(
      renderLatexOrText(
        "\\quad \\sum_{k=1}^{8}\\left|\\frac{1}{(2 k-7)(2 k-11)}\\right|$ 의 값은?",
        "",
      ),
    ).toBe(
      "\\ensuremath{\\quad \\sum_{k=1}^{8}\\left|\\frac{1}{(2 k-7)(2 k-11)}\\right|} 의 값은?",
    );
    expect(
      renderLatexOrText(
        "\\sum_{k=1}^{5}(k+a)^{4}-\\sum_{k=1}^{5}\\{k(k+2 a)\\}^{2}=250 a^{2}$ 을 만족시키는 양수 $a$ 의 값은?",
        "",
      ),
    ).toBe(
      "\\ensuremath{\\sum_{k=1}^{5}(k+a)^{4}-\\sum_{k=1}^{5}\\{k(k+2 a)\\}^{2}=250 a^{2}} 을 만족시키는 양수 \\ensuremath{a} 의 값은?",
    );
  });

  it("strips choice prefixes before rendering", () => {
    expect(renderChoiceLatexOrText("(1) \\frac{3}{4}", "")).toBe(
      "\\ensuremath{\\frac{3}{4}}",
    );
  });

  it("derives multiple-choice options from the stem when the relation is empty", () => {
    const printableProblem = resolveProblemForPrint({
      choices: [],
      stemLatex:
        "문항이다. (1) \\frac{1}{2} (2) \\frac{3}{4} (3) 1 (4) \\frac{5}{4} (5) \\frac{3}{2}",
      stemText:
        "문항이다. (1) 1/2 (2) 3/4 (3) 1 (4) 5/4 (5) 3/2",
    });

    expect(printableProblem.stemLatex).toBe("문항이다.");
    expect(printableProblem.choices).toHaveLength(5);
    expect(printableProblem.choices[0]).toEqual({
      contentLatex: "\\frac{1}{2}",
      contentText: "1/2",
      label: "①",
      position: 1,
    });
    expect(printableProblem.choiceLayout).toBe("spread");
  });

  it("wraps short bare math answers in ensuremath", () => {
    expect(renderInlineLatexOrText("(5) \\frac{511}{256}", "")).toBe(
      "(5) \\ensuremath{\\frac{511}{256}}",
    );
    expect(renderInlineLatexOrText("b_n = 2n", "")).toBe(
      "\\ensuremath{b_n = 2n}",
    );
  });

  it("keeps plain text answers escaped", () => {
    expect(renderInlineLatexOrText("", "정답 없음")).toBe("정답 없음");
  });

  it("builds fixed print layouts by problems per page", () => {
    expect(buildPrintLayout({ problemsPerPage: 4 })).toEqual({
      columns: 2,
      fontCommand: "\\small",
      pageSize: 4,
      rowsPerColumn: 2,
    });
    expect(buildPrintLayout({ problemsPerPage: 6 })).toEqual({
      columns: 2,
      fontCommand: "\\scriptsize",
      pageSize: 6,
      rowsPerColumn: 3,
    });
  });

  it("paginates problems into print columns", () => {
    const printLayout = buildPrintLayout({ problemsPerPage: 5 });
    const pages = paginateProblemsForPrint([1, 2, 3, 4, 5, 6], printLayout);

    expect(pages).toHaveLength(2);
    expect(pages[0].columns[0].items).toEqual([1, 2, 3]);
    expect(pages[0].columns[1].items).toEqual([4, 5]);
    expect(pages[1].columns[0].items).toEqual([6]);
    expect(pages[1].columns[0].blanks).toBe(2);
  });

  it("reuses the preview plan when provided", () => {
    const problems = [
      { id: "a" },
      { id: "b" },
      { id: "c" },
      { id: "d" },
      { id: "e" },
    ];

    const pages = resolvePrintPages(problems, {
      previewPlan: {
        columns: 2,
        pages: [
          {
            columns: [
              {
                items: [
                  { globalIndex: 0, problemId: "a", span: 1 },
                  { globalIndex: 1, problemId: "b", span: 1 },
                ],
              },
              {
                items: [{ globalIndex: 2, problemId: "c", span: 2 }],
              },
            ],
          },
          {
            columns: [
              {
                items: [
                  { globalIndex: 3, problemId: "d", span: 1 },
                  { globalIndex: 4, problemId: "e", span: 1 },
                ],
              },
              {
                items: [],
              },
            ],
          },
        ],
        rowsPerColumn: 2,
      },
      problemsPerPage: 4,
    });

    expect(pages).toHaveLength(2);
    expect(pages[0].columns[1].items[0]).toEqual({
      globalIndex: 2,
      problem: { id: "c" },
      span: 2,
    });
    expect(pages[1].columns[0].items[1].globalIndex).toBe(4);
    expect(pages[1].columns[1].blanks).toBe(2);
  });

  it("builds span-aware slot height expressions", () => {
    expect(buildSlotHeightExpression("\\regularPageProblemSlotHeight", 2)).toBe(
      "\\dimexpr 2\\regularPageProblemSlotHeight + 1\\problemSlotGap\\relax",
    );
  });

  it("formats solution steps as escaped plain text", () => {
    expect(
      renderSolutionStep({
        concept: "일반항",
        description: "b_1=2, b_2=4이므로 일반항은 b_n=2n이다.",
      }),
    ).toBe(
      "\\textbf{일반항}: \\ensuremath{b_{1}=2, b_{2}=4}이므로 일반항은 \\ensuremath{b_{n}=2n}이다.",
    );
  });

  it("renders mixed narrative text with explicit math delimiters", () => {
    expect(
      renderNarrativeLatexOrText("양변을 $x^2$로 나누면 $a_n$을 얻는다."),
    ).toBe(
      "양변을 \\ensuremath{x^2}로 나누면 \\ensuremath{a_n}을 얻는다.",
    );
  });

  it("keeps LaTeX in solution step descriptions when delimiters are provided", () => {
    expect(
      renderSolutionStep({
        concept: "치환",
        description: "$t=x^2$로 두면 $$t^2-3t+2=0$$ 이다.",
      }),
    ).toBe(
      "\\textbf{치환}: \\ensuremath{t=x^2}로 두면 \\[t^2-3t+2=0\\] 이다.",
    );
  });

  it("restores control characters that came from misparsed LaTeX escapes", () => {
    expect(
      renderSolutionStep({
        concept: "텔레스코핑",
        description:
          `분자 $a_{k+1}$ 를 부분합으로 바꾸면 $$\u000C` +
          `rac{a_{k+1}}{S_{k}S_{k+1}}=\u0009` +
          `extstyle\\sum_{k=1}^{n}\\frac{1}{S_{k}}.$$`,
      }),
    ).toBe(
      "\\textbf{텔레스코핑}: 분자 \\ensuremath{a_{k+1}} 를 부분합으로 바꾸면 \\[\\frac{a_{k+1}}{S_{k}S_{k+1}}=\\textstyle\\sum_{k=1}^{n}\\frac{1}{S_{k}}.\\]",
    );
  });

  it("keeps inline math pairs that contain Hangul text commands", () => {
    expect(
      renderNarrativeLatexOrText(
        "수학적 귀납법 가정과 다음 항 추가를 통한 직접 계산으로 $(\\mathrm{가}), f(m), g(m)$ 을 확인한 뒤 계산한다.",
      ),
    ).toBe(
      "수학적 귀납법 가정과 다음 항 추가를 통한 직접 계산으로 \\ensuremath{(\\text{가}), f(m), g(m)} 을 확인한 뒤 계산한다.",
    );
  });
});
