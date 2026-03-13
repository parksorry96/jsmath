import {
  BadGatewayException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

interface SourceChoice {
  label: string;
  position: number;
  contentText: string;
  contentLatex: string;
}

interface TwinProblemSource {
  id: string;
  displayNumber: string | null;
  problemNumber: string | null;
  problemType: string;
  gradeLevel: string | null;
  subject: string | null;
  unitMajor: string | null;
  unitMinor: string | null;
  difficulty: number | null;
  stemText: string;
  stemLatex: string;
  answerText: string | null;
  answerLatex: string | null;
  solutionText: string | null;
  solutionLatex: string | null;
  bookSource: unknown;
  choices: SourceChoice[];
}

interface GeneratedChoice {
  label: string;
  contentText: string;
  contentLatex: string;
}

interface GeneratedTwinProblem {
  title: string;
  variationNote: string;
  teacherNote: string;
  subject: string | null;
  unitMajor: string | null;
  unitMinor: string | null;
  difficulty: number | null;
  stemText: string;
  stemLatex: string;
  choices: GeneratedChoice[];
  correctChoiceLabel: string | null;
  answerText: string;
  solutionText: string;
}

export interface TwinProblemResult {
  sourceProblemId: string;
  model: string;
  generatedAt: string;
  problem: GeneratedTwinProblem & {
    problemType: string;
  };
}

interface OpenAIChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
    finish_reason?: string | null;
  }>;
  error?: {
    message?: string;
  };
}

interface OpenAIChatMessage {
  role: "system" | "user";
  content: string;
}

const GENERATED_TWIN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "title",
    "variationNote",
    "teacherNote",
    "subject",
    "unitMajor",
    "unitMinor",
    "difficulty",
    "stemText",
    "stemLatex",
    "choices",
    "correctChoiceLabel",
    "answerText",
    "solutionText",
  ],
  properties: {
    title: { type: "string" },
    variationNote: { type: "string" },
    teacherNote: { type: "string" },
    subject: { type: ["string", "null"] },
    unitMajor: { type: ["string", "null"] },
    unitMinor: { type: ["string", "null"] },
    difficulty: { type: ["integer", "null"], minimum: 1, maximum: 5 },
    stemText: { type: "string" },
    stemLatex: { type: "string" },
    choices: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "contentText", "contentLatex"],
        properties: {
          label: { type: "string" },
          contentText: { type: "string" },
          contentLatex: { type: "string" },
        },
      },
    },
    correctChoiceLabel: { type: ["string", "null"] },
    answerText: { type: "string" },
    solutionText: { type: "string" },
  },
} as const;

const GENERATED_VARIANTS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["variants"],
  properties: {
    variants: {
      type: "array",
      items: GENERATED_TWIN_SCHEMA,
    },
  },
} as const;

function trimText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function nullableText(value: unknown): string | null {
  const text = trimText(value);
  return text.length > 0 ? text : null;
}

function clampDifficulty(value: unknown, fallback: number | null): number | null {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return fallback;
  }

  return Math.min(5, Math.max(1, Math.round(value)));
}

function normalizeChoices(choices: unknown): GeneratedChoice[] {
  if (!Array.isArray(choices)) {
    return [];
  }

  return choices
    .map((choice) => ({
      label: trimText((choice as GeneratedChoice).label),
      contentText: trimText((choice as GeneratedChoice).contentText),
      contentLatex:
        trimText((choice as GeneratedChoice).contentLatex) ||
        trimText((choice as GeneratedChoice).contentText),
    }))
    .filter((choice) => choice.label && (choice.contentLatex || choice.contentText));
}

function buildOriginalPayload(source: TwinProblemSource) {
  return {
    meta: {
      displayNumber: source.displayNumber,
      problemNumber: source.problemNumber,
      problemType: source.problemType,
      gradeLevel: source.gradeLevel,
      subject: source.subject,
      unitMajor: source.unitMajor,
      unitMinor: source.unitMinor,
      difficulty: source.difficulty,
      bookSource: source.bookSource,
    },
    originalProblem: {
      stemText: source.stemText,
      stemLatex: source.stemLatex,
      choices: source.choices.map((choice) => ({
        label: choice.label,
        contentText: choice.contentText,
        contentLatex: choice.contentLatex,
      })),
      answerText: source.answerText,
      answerLatex: source.answerLatex,
      solutionText: source.solutionText,
      solutionLatex: source.solutionLatex,
    },
  };
}

function buildOutputSchemaGuide(problemType: string): string {
  const choicesRule =
    problemType === "multiple_choice"
      ? [
          '"choices": 정확히 5개 선지 배열',
          '"correctChoiceLabel": 반드시 ①, ②, ③, ④, ⑤ 중 하나',
        ]
      : [
          '"choices": 빈 배열 []',
          '"correctChoiceLabel": null',
        ];

  return [
    "{",
    '  "title": "문항 요약 태그",',
    '  "variationNote": "원문 대비 무엇을 바꿨는지 1~2문장",',
    '  "teacherNote": "유지한 핵심 개념/교육과정/난이도를 1~2문장",',
    '  "subject": "과목명 또는 null",',
    '  "unitMajor": "대단원 또는 null",',
    '  "unitMinor": "중단원 또는 null",',
    '  "difficulty": "1~5 정수 또는 null",',
    '  "stemText": "문제 본문",',
    '  "stemLatex": "문제 본문과 동일 의미의 LaTeX 친화 문자열",',
    `  ${choicesRule[0]},`,
    `  ${choicesRule[1]},`,
    '  "answerText": "최종 정답",',
    '  "solutionText": "풀이 핵심 3~5단계 + 마지막에 최종 정답을 명시"',
    "}",
  ].join("\n");
}

function buildSystemPrompt(source: TwinProblemSource): string {
  const choiceRule =
    source.problemType === "multiple_choice"
      ? [
          "- 객관식은 반드시 5지선다로 만드세요.",
          "- 선지는 정확히 5개, 라벨은 ①, ②, ③, ④, ⑤를 사용하세요.",
          "- 정답 선지는 정확히 1개만 성립하도록 만드세요.",
          "- 오답 선지는 그럴듯하지만 최종적으로는 명확히 틀리게 만드세요.",
          "- correctChoiceLabel, answerText, solutionText의 최종 결론이 서로 일치해야 합니다.",
        ].join(" ")
      : [
          "- 객관식이 아니므로 choices는 빈 배열 []로 두세요.",
          "- correctChoiceLabel은 null로 두세요.",
        ].join(" ");

  return [
    "# 역할",
    "당신은 한국 고등학교 수학 문항 출제 전문가입니다.",
    "",
    "# 목표",
    "입력 원문과 같은 단원, 같은 핵심 개념, 같은 교육과정 범위를 평가하되, 조건과 수치와 상황이 달라 독립된 새 문항으로 기능하는 쌍둥이 문항 1개를 생성하세요.",
    "",
    "# 입력 해석 우선순위",
    "- originalProblem의 stemLatex와 choices의 contentLatex를 수식 기준 정보로 우선 사용하세요.",
    "- stemText와 contentText는 한국어 서술 맥락 확인용으로 사용하세요.",
    "- answer/solution은 원문 개념과 난이도 파악용 참고 정보이며, 새 문항의 정답은 반드시 새로 계산하세요.",
    "",
    "# 변환 규칙",
    "## 필수 변경",
    "- 최소 2가지 이상 반드시 바꾸세요.",
    "- 수치, 계수, 상수, 범위, 조건 중 일부를 바꾸세요.",
    "- 함수, 도형, 수열 설정 또는 문항의 서술 상황 중 하나 이상을 바꾸세요.",
    "- 단순 숫자 치환을 넘어서 풀이의 표면 구조가 달라 보이게 만드세요.",
    "- 정답은 원문과 달라야 합니다.",
    "",
    "## 유지 사항",
    "- 핵심 개념과 교육과정 범위",
    "- 풀이에 필요한 사고 단계 수와 체감 난이도",
    "- 문항 유형",
    "",
    "## 금지 사항",
    "- 단순 숫자만 조금 바꾼 문항",
    "- 원문과 정답이 같아지는 변환",
    "- 교육과정 범위를 벗어나는 개념 추가",
    "- 조건이 모자라 정답이 하나로 정해지지 않는 문항",
    "- 계산은 가능하지만 교육용 문항으로 어색한 변형",
    "",
    "# 객관식/주관식 규칙",
    choiceRule,
    "",
    "# 출력 규칙",
    "- 출력은 한국어 JSON 객체 하나만 반환하세요.",
    "- 추가 키를 만들지 마세요.",
    "- title, variationNote, teacherNote를 비워 두지 마세요.",
    "- 수식이 있는 문자열은 LaTeX 친화적으로 작성하세요.",
    "- 인라인 수식은 $...$ 또는 \\(...\\), 블록 수식은 $$...$$ 또는 \\[...\\]처럼 명시적 구분자를 사용하세요.",
    "- 한 수식에서 구분자를 섞지 마세요. 예: \\left($...$\\right) 같은 표기는 금지합니다.",
    "- 한국어 문장은 수식 구분자 밖에 두고, 수식 안에 한글이 꼭 필요하면 \\text{...}만 사용하세요.",
    "- 첨자와 지수는 항상 중괄호를 써서 $S_{25}$, $a_{10}$처럼 표기하세요.",
    "- solutionText는 풀이 핵심 3~5단계와 마지막 최종 정답 문장을 포함해야 합니다.",
    "- variationNote에는 원문 대비 변경점이 드러나야 합니다.",
    "- teacherNote에는 유지한 개념, 단원, 난이도를 짧게 적으세요.",
    "",
    "# 자기 검증",
    "- 새 문항을 독립적으로 다시 풀었을 때 정답이 하나로 결정되는가?",
    "- 정답이 원문과 다른가?",
    "- 풀이 단계 수가 동급 난이도인가?",
    "- answerText와 solutionText의 마지막 결론이 같은가?",
    "- 객관식이면 정답 선지 1개만 참인가?",
    "- JSON 형식과 LaTeX 문자열이 깨지지 않는가?",
  ].join("\n");
}

function buildUserPrompt(source: TwinProblemSource): string {
  return [
    "# 입력",
    "<original>",
    JSON.stringify(buildOriginalPayload(source), null, 2),
    "</original>",
    "",
    "# 추가 지시",
    "- 원문을 그대로 복사하지 말고 독립된 새 문항처럼 보이게 작성하세요.",
    "- 단순 수치 교체만 하지 말고 구조적 변화가 보이게 하세요.",
    "- 원문이 객관식이면 선지 구성도 새 문항에 맞게 다시 설계하세요.",
    "- stemLatex, choices.contentLatex, answerText, solutionText의 수식은 명시적 LaTeX 구분자로 감싸고, 같은 식 안에서 구분자를 섞지 마세요.",
    "- solutionText는 계산 흐름이 검증 가능하도록 3~5단계로 쓰세요.",
    "- 마지막 줄 또는 마지막 문장에서 answerText와 동일한 최종 정답을 명시하세요.",
    "- 원문 메타데이터(subject/unit/difficulty)는 가능하면 유지하되, 입력이 비어 있으면 null을 허용하세요.",
    "",
    "# 출력 스키마",
    buildOutputSchemaGuide(source.problemType),
  ].join("\n");
}

function buildDifficultyDirective(
  sourceDifficulty: number | null,
  target: number,
): string {
  const source = sourceDifficulty ?? 3;
  if (target < source) {
    return [
      "# 난이도 조정 (EASIER)",
      `- 원문 난이도 ${source} → 목표 난이도 ${target}`,
      "- 조건을 간소화하세요.",
      "- 숫자를 더 작고 다루기 쉬운 값으로 바꾸세요.",
      "- 풀이 단계를 줄이세요.",
      "- 복합 조건 대신 단일 조건으로 단순화하세요.",
    ].join("\n");
  }
  if (target > source) {
    return [
      "# 난이도 조정 (HARDER)",
      `- 원문 난이도 ${source} → 목표 난이도 ${target}`,
      "- 조건을 추가하거나 복잡하게 만드세요.",
      "- 숫자를 더 크거나 복잡한 값으로 바꾸세요.",
      "- 풀이 단계를 늘리세요.",
      "- 여러 개념을 결합하되, 교육과정 범위를 벗어나지 마세요.",
    ].join("\n");
  }
  return "";
}

function buildVariantSystemPrompt(
  source: TwinProblemSource,
  count: number,
  difficultyTarget?: number,
): string {
  const base = buildSystemPrompt(source);
  const countDirective = [
    "",
    "# 배치 생성 규칙",
    `- 한 번에 ${count}개의 서로 다른 변형 문항을 생성하세요.`,
    "- 각 변형은 수치, 조건, 상황이 서로 달라야 합니다.",
    "- 각 변형의 정답은 서로 다르고, 원문과도 달라야 합니다.",
    '- JSON 출력은 { "variants": [ ... ] } 형식의 배열입니다.',
  ].join("\n");

  const difficultyDirective =
    difficultyTarget != null
      ? "\n" + buildDifficultyDirective(source.difficulty, difficultyTarget)
      : "";

  return base + countDirective + difficultyDirective;
}

function buildVariantUserPrompt(
  source: TwinProblemSource,
  count: number,
): string {
  return [
    "# 입력",
    "<original>",
    JSON.stringify(buildOriginalPayload(source), null, 2),
    "</original>",
    "",
    "# 추가 지시",
    `- ${count}개의 독립된 변형 문항을 생성하세요.`,
    "- 각 변형은 원문을 그대로 복사하지 말고 독립된 새 문항처럼 보이게 작성하세요.",
    "- 단순 수치 교체만 하지 말고 구조적 변화가 보이게 하세요.",
    "- 원문이 객관식이면 선지 구성도 새 문항에 맞게 다시 설계하세요.",
    "- stemLatex, choices.contentLatex, answerText, solutionText의 수식은 명시적 LaTeX 구분자로 감싸고, 같은 식 안에서 구분자를 섞지 마세요.",
    "- solutionText는 계산 흐름이 검증 가능하도록 3~5단계로 쓰세요.",
    "- 마지막 줄 또는 마지막 문장에서 answerText와 동일한 최종 정답을 명시하세요.",
    "- 원문 메타데이터(subject/unit/difficulty)는 가능하면 유지하되, 입력이 비어 있으면 null을 허용하세요.",
    "",
    "# 출력 스키마",
    '{ "variants": [',
    buildOutputSchemaGuide(source.problemType),
    ", ...",
    "] }",
  ].join("\n");
}

function buildVerificationSystemPrompt(): string {
  return [
    "# 역할",
    "당신은 한국 고등학교 수학 문항 검수자입니다.",
    "",
    "# 목표",
    "생성된 쌍둥이 문제 JSON을 수학적으로 검토하고, 문제 본문, 정답, 선지, 풀이가 모두 일관된 최종본으로 고치세요.",
    "",
    "# 검수 원칙",
    "- original은 유지해야 할 개념/단원/난이도의 기준이고, candidate는 수정 가능한 초안입니다.",
    "- candidate가 이미 올바르면 같은 스키마로 정리해서 그대로 반환하세요.",
    "- 오류가 있으면 필요한 필드만 최소 수정하되, 문제 성립에 필요하면 stem과 answer와 solution을 함께 고치세요.",
    "",
    "# 검수 규칙",
    "- candidate의 answerText를 그대로 믿지 말고 문제를 다시 풀어 검산하세요.",
    "- answerText와 solutionText의 마지막 결론은 반드시 같아야 합니다.",
    "- 객관식이면 correctChoiceLabel, choices, answerText가 서로 모순되면 수정하세요.",
    "- 객관식이면 정답 선지는 정확히 1개만 성립해야 합니다.",
    "- 문제 자체가 성립하지 않으면 stemText, stemLatex, answerText, solutionText를 함께 고치세요.",
    "- LaTeX 구분자가 섞이거나 깨진 식이 있으면 올바른 구분자로 정리하세요.",
    "- 인라인 수식은 $...$ 또는 \\(...\\), 블록 수식은 $$...$$ 또는 \\[...\\]만 사용하세요.",
    "- \\left($...$\\right) 같은 혼합 표기는 반드시 고치세요.",
    "- 원문과 같은 개념, 같은 단원, 같은 난이도를 유지하세요.",
    "- 원문과 최종 정답이 같아지면 안 됩니다.",
    "",
    "# 출력 규칙",
    "- 동일한 JSON 스키마의 객체 하나만 반환하세요.",
    "- JSON 외 텍스트는 출력하지 마세요.",
  ].join("\n");
}

function buildVerificationUserPrompt(
  source: TwinProblemSource,
  candidate: GeneratedTwinProblem,
): string {
  return [
    "# 원문",
    "<original>",
    JSON.stringify(buildOriginalPayload(source), null, 2),
    "</original>",
    "",
    "# 검수 대상 후보",
    "<candidate>",
    JSON.stringify(candidate, null, 2),
    "</candidate>",
    "",
    "# 해야 할 일",
    "- 문제를 다시 풀어 정답을 검산하세요.",
    "- 정답과 풀이가 다르면 반드시 수정하세요.",
    "- 객관식이면 선지와 정답 선지의 정합성을 다시 확인하세요.",
    "- variationNote와 teacherNote는 최종 결과 기준으로 다시 다듬으세요.",
    "- 최종 JSON만 반환하세요.",
  ].join("\n");
}

function normalizeAnswerValue(value: string): string {
  return value
    .replace(/\\(?:text|mathrm|operatorname)\{([^{}]+)\}/gu, "$1")
    .replace(/\\boxed\{([^{}]+)\}/gu, "$1")
    .replace(/\\left/gu, "")
    .replace(/\\right/gu, "")
    .replace(/\$\$/g, "")
    .replace(/\$/g, "")
    .replace(/\\\(|\\\)/g, "")
    .replace(/\\\[/g, "")
    .replace(/\\\]/g, "")
    .replace(/[{}]/g, "")
    .replace(/\s+/g, "")
    .replace(/[.。,]/g, "")
    .trim()
    .toLowerCase();
}

function extractChoiceLabels(value: string): string[] {
  return [...value.matchAll(/[①②③④⑤]/gu)].map((match) => match[0]);
}

function stripChoiceLabels(value: string): string {
  return value.replace(/[①②③④⑤]/gu, " ");
}

function extractExplicitMathSegments(value: string): string[] {
  return [
    ...value.matchAll(
      /\$\$([^$]+)\$\$|\\\[([\s\S]+?)\\\]|\$([^\n$]+)\$|\\\(([\s\S]+?)\\\)/gu,
    ),
  ]
    .map((match) => trimText(match[1] ?? match[2] ?? match[3] ?? match[4]))
    .filter(Boolean);
}

function extractSolutionAnswerCandidates(solutionText: string): string[] {
  const candidates: string[] = [];
  const patterns = [
    /정답(?:은|:)?\s*(?:\$\$?([^$]+)\$\$?|([^\n.]+))/gu,
    /답(?:은|:)?\s*(?:\$\$?([^$]+)\$\$?|([^\n.]+))/gu,
  ];

  for (const pattern of patterns) {
    for (const match of solutionText.matchAll(pattern)) {
      const candidate = trimText(match[1] ?? match[2]);
      if (candidate) {
        candidates.push(candidate);
        candidates.push(...extractExplicitMathSegments(candidate));
      }
    }
  }

  const displayMath = extractExplicitMathSegments(solutionText).filter(
    (segment) =>
      solutionText.includes(`$$${segment}$$`) || solutionText.includes(`\\[${segment}\\]`),
  );
  if (displayMath.length > 0) {
    candidates.push(displayMath[displayMath.length - 1]);
  }

  if (candidates.length === 0) {
    const trailingInlineMath = extractExplicitMathSegments(solutionText).filter(
      (segment) =>
        solutionText.includes(`$${segment}$`) || solutionText.includes(`\\(${segment}\\)`),
    );

    if (trailingInlineMath.length > 0) {
      candidates.push(trailingInlineMath[trailingInlineMath.length - 1]);
    }
  }

  return candidates;
}

@Injectable()
export class TwinProblemService {
  private readonly logger = new Logger(TwinProblemService.name);

  constructor(private readonly config: ConfigService) {}

  private async requestStructuredCompletion(params: {
    apiKey: string;
    baseUrl: string;
    model: string;
    sourceProblemId: string;
    messages: OpenAIChatMessage[];
    schemaName: string;
    schema: Record<string, unknown>;
    timeoutMs?: number;
  }): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      params.timeoutMs ?? 45000,
    );

    let response: Response;
    try {
      response = await fetch(`${params.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${params.apiKey}`,
        },
        body: JSON.stringify({
          model: params.model,
          messages: params.messages,
          response_format: {
            type: "json_schema",
            json_schema: {
              name: params.schemaName,
              strict: true,
              schema: params.schema,
            },
          },
        }),
        signal: controller.signal,
      });
    } catch (error) {
      this.logger.error(
        `Twin problem request failed for ${params.sourceProblemId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw new BadGatewayException("쌍둥이 문제 생성 요청에 실패했습니다.");
    } finally {
      clearTimeout(timeoutId);
    }

    const rawText = await response.text();
    if (!response.ok) {
      this.logger.error(
        `Twin problem API error for ${params.sourceProblemId}: ${response.status} ${rawText}`,
      );
      throw new BadGatewayException("쌍둥이 문제 생성 API 호출이 실패했습니다.");
    }

    let payload: OpenAIChatCompletionResponse;
    try {
      payload = JSON.parse(rawText) as OpenAIChatCompletionResponse;
    } catch {
      this.logger.error(
        `Twin problem API returned invalid JSON for ${params.sourceProblemId}`,
      );
      throw new BadGatewayException("쌍둥이 문제 응답을 해석하지 못했습니다.");
    }

    const content = payload.choices?.[0]?.message?.content;
    if (!content) {
      this.logger.error(
        `Twin problem API returned empty content for ${params.sourceProblemId}`,
      );
      throw new BadGatewayException("쌍둥이 문제 응답이 비어 있습니다.");
    }

    try {
      return JSON.parse(content) as Record<string, unknown>;
    } catch {
      this.logger.error(
        `Twin problem content was not valid JSON for ${params.sourceProblemId}`,
      );
      throw new BadGatewayException("쌍둥이 문제 JSON 파싱에 실패했습니다.");
    }
  }

  private async requestStructuredTwinProblem(params: {
    apiKey: string;
    baseUrl: string;
    model: string;
    sourceProblemId: string;
    messages: OpenAIChatMessage[];
  }): Promise<Record<string, unknown>> {
    return this.requestStructuredCompletion({
      ...params,
      schemaName: "generated_twin_problem",
      schema: GENERATED_TWIN_SCHEMA as unknown as Record<string, unknown>,
    });
  }

  private toResult(
    source: TwinProblemSource,
    model: string,
    generated: Record<string, unknown>,
  ): TwinProblemResult {
    const choices =
      source.problemType === "multiple_choice"
        ? normalizeChoices(generated.choices)
        : [];

    if (source.problemType === "multiple_choice" && choices.length !== 5) {
      this.logger.error(
        `Twin problem choice count mismatch for ${source.id}: ${choices.length}`,
      );
      throw new BadGatewayException("객관식 쌍둥이 문제 선지 생성이 올바르지 않습니다.");
    }

    return {
      sourceProblemId: source.id,
      model,
      generatedAt: new Date().toISOString(),
      problem: {
        title: trimText(generated.title) || "쌍둥이 문제",
        variationNote:
          trimText(generated.variationNote) || "조건과 수치를 바꾼 동형 문항입니다.",
        teacherNote:
          trimText(generated.teacherNote) ||
          "원문과 동일한 핵심 개념과 풀이 유형을 유지했습니다.",
        problemType: source.problemType,
        subject: nullableText(generated.subject) ?? source.subject,
        unitMajor: nullableText(generated.unitMajor) ?? source.unitMajor,
        unitMinor: nullableText(generated.unitMinor) ?? source.unitMinor,
        difficulty: clampDifficulty(generated.difficulty, source.difficulty),
        stemText: trimText(generated.stemText) || source.stemText,
        stemLatex:
          trimText(generated.stemLatex) ||
          trimText(generated.stemText) ||
          source.stemLatex ||
          source.stemText,
        choices,
        correctChoiceLabel:
          source.problemType === "multiple_choice"
            ? nullableText(generated.correctChoiceLabel)
            : null,
        answerText: trimText(generated.answerText),
        solutionText: trimText(generated.solutionText),
      },
    };
  }

  private assertConsistency(result: TwinProblemResult): void {
    if (!result.problem.answerText || !result.problem.solutionText) {
      throw new BadGatewayException("쌍둥이 문제 정답 또는 풀이가 비어 있습니다.");
    }

    const solutionCandidates = extractSolutionAnswerCandidates(
      result.problem.solutionText,
    );

    if (result.problem.problemType === "multiple_choice") {
      this.assertMultipleChoiceConsistency(result, solutionCandidates);
      return;
    }

    const normalizedAnswer = normalizeAnswerValue(result.problem.answerText);
    const normalizedSolutionCandidates = solutionCandidates
      .map(normalizeAnswerValue)
      .filter(Boolean);

    if (
      normalizedSolutionCandidates.length > 0 &&
      !normalizedSolutionCandidates.some((candidate) => candidate === normalizedAnswer)
    ) {
      this.logger.error(
        `Twin problem answer/solution mismatch for ${result.sourceProblemId}: answer=${result.problem.answerText}, solutionCandidates=${normalizedSolutionCandidates.join(",")}`,
      );
      throw new BadGatewayException(
        "쌍둥이 문제의 정답과 풀이가 일치하지 않아 다시 생성이 필요합니다.",
      );
    }
  }

  private assertMultipleChoiceConsistency(
    result: TwinProblemResult,
    solutionCandidates: string[],
  ): void {
    const labels = new Set(result.problem.choices.map((choice) => choice.label));
    if (
      !result.problem.correctChoiceLabel ||
      !labels.has(result.problem.correctChoiceLabel)
    ) {
      throw new BadGatewayException(
        "객관식 쌍둥이 문제의 정답 선지가 올바르지 않습니다.",
      );
    }

    const answerLabels = extractChoiceLabels(result.problem.answerText);
    if (
      answerLabels.length > 0 &&
      answerLabels.some((label) => label !== result.problem.correctChoiceLabel)
    ) {
      this.logger.error(
        `Twin problem answer label mismatch for ${result.sourceProblemId}: answer=${result.problem.answerText}, correctChoiceLabel=${result.problem.correctChoiceLabel}`,
      );
      throw new BadGatewayException(
        "객관식 쌍둥이 문제의 정답과 정답 선지가 일치하지 않습니다.",
      );
    }

    const solutionLabels = new Set(
      solutionCandidates.flatMap((candidate) => extractChoiceLabels(candidate)),
    );
    if (
      solutionLabels.size > 0 &&
      !solutionLabels.has(result.problem.correctChoiceLabel)
    ) {
      this.logger.error(
        `Twin problem solution label mismatch for ${result.sourceProblemId}: correctChoiceLabel=${result.problem.correctChoiceLabel}, solutionCandidates=${solutionCandidates.join(",")}`,
      );
      throw new BadGatewayException(
        "객관식 쌍둥이 문제의 정답과 풀이가 일치하지 않아 다시 생성이 필요합니다.",
      );
    }

    const normalizedAnswer = normalizeAnswerValue(result.problem.answerText);
    const normalizedAnswerBody = normalizeAnswerValue(
      stripChoiceLabels(result.problem.answerText),
    );
    const correctChoice = result.problem.choices.find(
      (choice) => choice.label === result.problem.correctChoiceLabel,
    );
    const normalizedChoiceBodies = correctChoice
      ? [correctChoice.contentText, correctChoice.contentLatex]
          .map(normalizeAnswerValue)
          .filter(Boolean)
      : [];
    const normalizedSolutionCandidates = solutionCandidates
      .map(normalizeAnswerValue)
      .filter(Boolean);
    const hasAnswerBodyMatch =
      normalizedSolutionCandidates.some(
        (candidate) =>
          candidate === normalizedAnswer || candidate === normalizedAnswerBody,
      ) ||
      normalizedChoiceBodies.some(
        (choiceValue) =>
          choiceValue === normalizedAnswer || choiceValue === normalizedAnswerBody,
      ) ||
      normalizedSolutionCandidates.some((candidate) =>
        normalizedChoiceBodies.includes(candidate),
      );

    if (solutionLabels.size === 0 && !hasAnswerBodyMatch) {
      this.logger.error(
        `Twin problem answer/solution mismatch for ${result.sourceProblemId}: answer=${result.problem.answerText}, solutionCandidates=${solutionCandidates.join(",")}`,
      );
      throw new BadGatewayException(
        "쌍둥이 문제의 정답과 풀이가 일치하지 않아 다시 생성이 필요합니다.",
      );
    }
  }

  async generate(source: TwinProblemSource): Promise<TwinProblemResult> {
    const apiKey =
      this.config.get<string>("AI_API_KEY") ??
      this.config.get<string>("OPENAI_API_KEY") ??
      null;

    if (!apiKey) {
      throw new ServiceUnavailableException("AI_API_KEY is not configured");
    }

    const baseUrl = (
      this.config.get<string>("AI_API_BASE_URL") ?? "https://api.openai.com/v1"
    ).replace(/\/$/, "");
    const model = this.config.get<string>("AI_TWIN_PROBLEM_MODEL") ?? "gpt-5.4";
    const verifyModel =
      this.config.get<string>("AI_TWIN_PROBLEM_VERIFY_MODEL") ?? model;

    const generated = await this.requestStructuredTwinProblem({
      apiKey,
      baseUrl,
      model,
      sourceProblemId: source.id,
      messages: [
        { role: "system", content: buildSystemPrompt(source) },
        { role: "user", content: buildUserPrompt(source) },
      ],
    });

    const initialResult = this.toResult(source, model, generated);

    const verified = await this.requestStructuredTwinProblem({
      apiKey,
      baseUrl,
      model: verifyModel,
      sourceProblemId: source.id,
      messages: [
        { role: "system", content: buildVerificationSystemPrompt() },
        {
          role: "user",
          content: buildVerificationUserPrompt(source, initialResult.problem),
        },
      ],
    });

    const finalResult = this.toResult(source, model, verified);
    this.assertConsistency(finalResult);
    return finalResult;
  }

  async generateVariants(
    source: TwinProblemSource,
    count: number,
    difficultyTarget?: number,
  ): Promise<TwinProblemResult[]> {
    const apiKey =
      this.config.get<string>("AI_API_KEY") ??
      this.config.get<string>("OPENAI_API_KEY") ??
      null;

    if (!apiKey) {
      throw new ServiceUnavailableException("AI_API_KEY is not configured");
    }

    const baseUrl = (
      this.config.get<string>("AI_API_BASE_URL") ?? "https://api.openai.com/v1"
    ).replace(/\/$/, "");
    const model = this.config.get<string>("AI_TWIN_PROBLEM_MODEL") ?? "gpt-5.4";
    const verifyModel =
      this.config.get<string>("AI_TWIN_PROBLEM_VERIFY_MODEL") ?? model;

    // Split into batches of 3 for count > 3, parallel execution
    const batchSize = 3;
    const batches: number[] = [];
    let remaining = count;
    while (remaining > 0) {
      const size = Math.min(remaining, batchSize);
      batches.push(size);
      remaining -= size;
    }

    const batchResults = await Promise.all(
      batches.map(async (batchCount) => {
        const response = await this.requestStructuredCompletion({
          apiKey,
          baseUrl,
          model,
          sourceProblemId: source.id,
          messages: [
            {
              role: "system",
              content: buildVariantSystemPrompt(source, batchCount, difficultyTarget),
            },
            { role: "user", content: buildVariantUserPrompt(source, batchCount) },
          ],
          schemaName: "generated_variants",
          schema: GENERATED_VARIANTS_SCHEMA as unknown as Record<string, unknown>,
          timeoutMs: 90000,
        });

        const variants = response.variants;
        if (!Array.isArray(variants)) {
          this.logger.error(
            `Variant generation returned non-array for ${source.id}`,
          );
          throw new BadGatewayException("변형 문제 생성 응답이 올바르지 않습니다.");
        }

        return variants as Record<string, unknown>[];
      }),
    );

    const allRaw = batchResults.flat();

    // Verify each variant and collect results (skip failed verifications)
    const results: TwinProblemResult[] = [];
    for (const raw of allRaw) {
      const initial = this.toResult(source, model, raw);

      try {
        const verified = await this.requestStructuredTwinProblem({
          apiKey,
          baseUrl,
          model: verifyModel,
          sourceProblemId: source.id,
          messages: [
            { role: "system", content: buildVerificationSystemPrompt() },
            {
              role: "user",
              content: buildVerificationUserPrompt(source, initial.problem),
            },
          ],
        });

        const finalResult = this.toResult(source, model, verified);
        this.assertConsistency(finalResult);
        results.push(finalResult);
      } catch (error) {
        this.logger.warn(
          `Variant verification failed for ${source.id}, skipping: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    return results;
  }
}
