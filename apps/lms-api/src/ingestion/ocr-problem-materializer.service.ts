import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { UploadPolicyService } from "../files/upload-policy.service";
import {
  type NormalizedOcrProblem,
  normalizeOcrProblem,
} from "./ocr-problem-normalizer";

type ExistingProblemRecord = {
  id: string;
  problemType: string;
  problemNumber: string | null;
  displayNumber: string | null;
  startPage: number;
  endPage: number;
  stemLatex: string;
  stemText: string;
  bbox: unknown;
  choices: Array<{
    position: number;
    label: string;
    contentLatex: string;
    contentText: string;
  }>;
  assets: Array<{ s3Key: string }>;
};

type PreparedIncomingProblem = {
  raw: Record<string, unknown>;
  normalized: NormalizedOcrProblem;
  fingerprint: string;
};

type ExamMetaLookup = {
  examYear: number;
  examMonth: number;
  examType: string;
  questionNumber: number;
  subjectCandidates: string[];
  matchAllSubjects: boolean;
};

type ExamMetaCandidate = {
  id: string;
  problemId: string | null;
  subject: string;
};

type StoredProblemForMetaSync = {
  id: string;
  problemNumber: string | null;
  displayNumber: string | null;
  subject: string | null;
  isCommon: boolean | null;
  examSource: unknown;
  ocrJob: {
    sourceFile: {
      filename: string;
    } | null;
  } | null;
};

type ParsedSourceFilename = {
  examYear: number | null;
  examMonth: number | null;
  examType: string | null;
  subjectCandidates: string[];
};

@Injectable()
export class OcrProblemMaterializerService {
  private readonly logger = new Logger(OcrProblemMaterializerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly uploadPolicy: UploadPolicyService,
  ) {}

  private normalizeFingerprintText(value: unknown): string {
    if (typeof value !== "string") {
      return "";
    }

    return value
      .normalize("NFKC")
      .replace(/^\s*\d{1,3}\s*[.．](?!\d)\s*/u, "")
      .replace(/\s+/gu, " ")
      .trim();
  }

  private buildProblemFingerprint(
    problem: {
      problemType?: unknown;
      stemLatex?: unknown;
      stemText?: unknown;
    },
    choices: Array<{
      position?: unknown;
      contentLatex?: unknown;
      contentText?: unknown;
    }> = [],
  ): string {
    return JSON.stringify([
      typeof problem.problemType === "string" ? problem.problemType : "",
      this.normalizeFingerprintText(problem.stemText),
      this.normalizeFingerprintText(problem.stemLatex),
      choices
        .map((choice, index) => ({
          position:
            typeof choice.position === "number" ? choice.position : index + 1,
          contentLatex: this.normalizeFingerprintText(choice.contentLatex),
          contentText: this.normalizeFingerprintText(choice.contentText),
        }))
        .sort((a, b) => a.position - b.position),
    ]);
  }

  private toRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    return value as Record<string, unknown>;
  }

  private parseIntLike(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value)) {
      return Math.trunc(value);
    }

    if (typeof value !== "string") {
      return null;
    }

    const match = value.normalize("NFKC").match(/\d{1,4}/u);
    if (!match) {
      return null;
    }

    const parsed = Number.parseInt(match[0], 10);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private parseQuestionNumber(...values: unknown[]): number | null {
    for (const value of values) {
      const parsed = this.parseIntLike(value);
      if (parsed !== null) {
        return parsed;
      }
    }
    return null;
  }

  private parseSourceFilename(filename: string | null | undefined): ParsedSourceFilename {
    const normalized = this.normalizeFingerprintText(filename)
      .toLowerCase()
      .replace(/[_./\\-]+/g, " ");
    if (!normalized) {
      return {
        examYear: null,
        examMonth: null,
        examType: null,
        subjectCandidates: [],
      };
    }

    const academicYearMatch = normalized.match(/(20\d{2})\s*학년도/u);
    const examYearMatch = normalized.match(/\b(20\d{2})\b/u);
    const examMonthMatch = normalized.match(/\b(3|5|6|7|9|10|11)\s*월?\b/u);
    const rawExamMonth = examMonthMatch ? Number.parseInt(examMonthMatch[1], 10) : null;
    const detectedExamType = this.normalizeExamType(null, {
      examMonth: rawExamMonth,
      hints: [normalized],
    });
    const academicYear = academicYearMatch ? Number.parseInt(academicYearMatch[1], 10) : null;
    const examYear = academicYear !== null
      ? academicYear - 1
      : examYearMatch
        ? Number.parseInt(examYearMatch[1], 10)
        : null;
    const examMonth = rawExamMonth ?? (detectedExamType === "suneung" && academicYear !== null ? 11 : null);

    const subjectCandidates = new Set<string>();
    if (/(?:확률과\s*통계|확률과통계)/u.test(normalized)) {
      subjectCandidates.add("확률과통계");
    }
    if (/미적분/u.test(normalized)) {
      subjectCandidates.add("미적분");
    }
    if (/기하/u.test(normalized)) {
      subjectCandidates.add("기하");
    }
    if (/(?:수학\s*[\(\[]?\s*가[\)\]]?|수학\s*a\b|수학a\b)/u.test(normalized)) {
      subjectCandidates.add("수학(가)");
      subjectCandidates.add("수학A");
    }
    if (/(?:수학\s*[\(\[]?\s*나[\)\]]?|수학\s*b\b|수학b\b)/u.test(normalized)) {
      subjectCandidates.add("수학(나)");
      subjectCandidates.add("수학B");
    }

    return {
      examYear,
      examMonth,
      examType: this.normalizeExamType(null, {
        examMonth,
        hints: [normalized],
      }),
      subjectCandidates: [...subjectCandidates],
    };
  }

  private normalizeExamType(
    rawType: unknown,
    options: {
      examMonth: number | null;
      hints?: Array<string | null | undefined>;
    },
  ): string | null {
    const texts = [
      typeof rawType === "string" ? rawType : null,
      ...(options.hints ?? []),
    ]
      .filter((value): value is string => typeof value === "string" && value.length > 0)
      .map((value) => this.normalizeFingerprintText(value).toLowerCase());

    for (const text of texts) {
      if (text === "suneung" || text.includes("수능")) {
        return "suneung";
      }

      if (text === "mock_gyoyuk" || text.includes("교육청") || text.includes("학평") || text.includes("학력평가")) {
        return "mock_gyoyuk";
      }

      if (text === "mock_pyeongga" || text.includes("평가원")) {
        return "mock_pyeongga";
      }

      if (
        text.includes("모의평가") ||
        text.includes("모평")
      ) {
        if (text.includes("교육청")) {
          return "mock_gyoyuk";
        }
        if (text.includes("6월") || text.includes("9월")) {
          return "mock_pyeongga";
        }
        if (options.examMonth === 6 || options.examMonth === 9) {
          return "mock_pyeongga";
        }
      }
    }

    if (options.examMonth === 11) {
      return "suneung";
    }

    return null;
  }

  private buildSubjectCandidates(subject: unknown, examYear: number): string[] {
    const normalized = this.normalizeFingerprintText(subject).replace(/\s+/gu, "");
    if (!normalized) {
      return [];
    }

    if (normalized.includes("확률과통계")) {
      return examYear >= 2022 ? ["확률과통계"] : ["확률과통계", "수학A", "수학(나)"];
    }
    if (normalized.includes("미적분")) {
      return examYear >= 2022 ? ["미적분"] : ["미적분", "수학B", "수학(가)"];
    }
    if (normalized.includes("기하")) {
      return examYear >= 2022 ? ["기하"] : ["기하", "수학B", "수학(가)"];
    }
    if (normalized.includes("수학(가)") || normalized.includes("수학가")) {
      return ["수학(가)", "수학A"];
    }
    if (normalized.includes("수학(나)") || normalized.includes("수학나")) {
      return ["수학(나)", "수학B"];
    }
    if (normalized.includes("수학a")) {
      return ["수학A", "수학(가)"];
    }
    if (normalized.includes("수학b")) {
      return ["수학B", "수학(나)"];
    }

    return [];
  }

  private resolveExamMetaLookup(
    problem: {
      problemNumber?: unknown;
      displayNumber?: unknown;
      subject?: unknown;
      isCommon?: unknown;
      examSource?: unknown;
    },
    sourceFilename: string | null | undefined,
  ): ExamMetaLookup | null {
    const examSource = this.toRecord(problem.examSource);
    const fileContext = this.parseSourceFilename(sourceFilename);

    const examYear = this.parseIntLike(examSource?.year) ?? fileContext.examYear;
    const examMonth = this.parseIntLike(examSource?.month) ?? fileContext.examMonth;
    if (examYear === null || examMonth === null) {
      return null;
    }

    const examType = this.normalizeExamType(examSource?.type, {
      examMonth,
      hints: [
        typeof examSource?.label === "string" ? examSource.label : null,
        typeof examSource?.raw === "string" ? examSource.raw : null,
        sourceFilename,
      ],
    }) ?? fileContext.examType;
    if (!examType) {
      return null;
    }

    const questionNumber = this.parseQuestionNumber(
      examSource?.number,
      problem.problemNumber,
      problem.displayNumber,
    );
    if (questionNumber === null) {
      return null;
    }

    const isCommon =
      typeof examSource?.isCommon === "boolean"
        ? examSource.isCommon
        : typeof problem.isCommon === "boolean"
        ? problem.isCommon
        : examYear >= 2022 && questionNumber <= 22;

    const subjectCandidates = new Set<string>(fileContext.subjectCandidates);
    const hintedSubject =
      typeof examSource?.subject === "string"
        ? examSource.subject
        : typeof problem.subject === "string"
          ? problem.subject
          : null;
    for (const candidate of this.buildSubjectCandidates(hintedSubject, examYear)) {
      subjectCandidates.add(candidate);
    }

    const matchAllSubjects = isCommon && subjectCandidates.size === 0;

    return {
      examYear,
      examMonth,
      examType,
      questionNumber,
      subjectCandidates: [...subjectCandidates],
      matchAllSubjects,
    };
  }

  private async findExamMetaCandidates(
    lookup: ExamMetaLookup,
  ): Promise<ExamMetaCandidate[]> {
    const select = {
      id: true,
      problemId: true,
      subject: true,
    } as const;

    const baseWhere = {
      examYear: lookup.examYear,
      examMonth: lookup.examMonth,
      examType: lookup.examType,
      questionNumber: lookup.questionNumber,
    };

    if (lookup.matchAllSubjects) {
      return this.prisma.examQuestionMeta.findMany({
        where: baseWhere,
        select,
      });
    }

    if (lookup.subjectCandidates.length > 0) {
      const matches = await this.prisma.examQuestionMeta.findMany({
        where: {
          ...baseWhere,
          subject: { in: lookup.subjectCandidates },
        },
        select,
      });
      if (matches.length > 0) {
        return matches;
      }
    }

    const fallback = await this.prisma.examQuestionMeta.findMany({
      where: baseWhere,
      select,
    });
    return fallback.length === 1 ? fallback : [];
  }

  private describeExamMetaLookup(lookup: ExamMetaLookup): string {
    const subjectText = lookup.matchAllSubjects
      ? "all-subjects"
      : lookup.subjectCandidates.join("|") || "no-subject";
    return `${lookup.examYear}-${lookup.examMonth}-${lookup.examType}-Q${lookup.questionNumber}-${subjectText}`;
  }

  private async attachExamMetaToProblem(
    problemId: string,
    lookup: ExamMetaLookup,
    candidates: ExamMetaCandidate[],
  ): Promise<void> {
    if (candidates.length === 0) {
      return;
    }

    const linkedProblemIds = new Set(
      candidates
        .map((candidate) => candidate.problemId)
        .filter((value): value is string => typeof value === "string" && value.length > 0),
    );

    if (linkedProblemIds.size > 1) {
      this.logger.warn(
        `Skipped exam metadata link for ${problemId}: conflicting linked problems (${this.describeExamMetaLookup(lookup)})`,
      );
      return;
    }

    if (linkedProblemIds.size === 1 && !linkedProblemIds.has(problemId)) {
      this.logger.debug(
        `Skipped exam metadata reassignment for ${problemId}: already linked elsewhere (${this.describeExamMetaLookup(lookup)})`,
      );
      return;
    }

    const idsToUpdate = candidates
      .filter((candidate) => candidate.problemId !== problemId)
      .map((candidate) => candidate.id);
    if (idsToUpdate.length === 0) {
      return;
    }

    await this.prisma.examQuestionMeta.updateMany({
      where: { id: { in: idsToUpdate } },
      data: { problemId },
    });
  }

  private async syncExamMetaForIncomingProblem(
    problemId: string,
    problem: Record<string, unknown>,
    sourceFilename: string | null | undefined,
  ): Promise<void> {
    const lookup = this.resolveExamMetaLookup(problem, sourceFilename);
    if (!lookup) {
      return;
    }

    const candidates = await this.findExamMetaCandidates(lookup);
    await this.attachExamMetaToProblem(problemId, lookup, candidates);
  }

  private async loadExistingProblemRecord(
    problemId: string,
  ): Promise<ExistingProblemRecord | null> {
    return this.prisma.problem.findUnique({
      where: { id: problemId },
      select: {
        id: true,
        problemType: true,
        problemNumber: true,
        displayNumber: true,
        startPage: true,
        endPage: true,
        stemLatex: true,
        stemText: true,
        bbox: true,
        choices: {
          select: {
            position: true,
            label: true,
            contentLatex: true,
            contentText: true,
          },
          orderBy: { position: "asc" },
        },
        assets: {
          select: { s3Key: true },
        },
      },
    });
  }

  private async findExistingProblemByExamMeta(
    problem: Record<string, unknown>,
    sourceFilename: string | null | undefined,
    existingById: Map<string, ExistingProblemRecord>,
  ): Promise<ExistingProblemRecord | null> {
    const lookup = this.resolveExamMetaLookup(problem, sourceFilename);
    if (!lookup) {
      return null;
    }

    const candidates = await this.findExamMetaCandidates(lookup);
    const linkedProblemIds = new Set(
      candidates
        .map((candidate) => candidate.problemId)
        .filter((value): value is string => typeof value === "string" && value.length > 0),
    );
    if (linkedProblemIds.size !== 1) {
      return null;
    }

    const existingProblemId = [...linkedProblemIds][0];
    const cached = existingById.get(existingProblemId);
    if (cached) {
      return cached;
    }

    const loaded = await this.loadExistingProblemRecord(existingProblemId);
    if (loaded) {
      existingById.set(loaded.id, loaded);
    }
    return loaded;
  }

  private async ensureAssets(
    problemId: string,
    existingAssetKeys: Set<string>,
    payload: Record<string, unknown>,
  ) {
    const assetsToCreate: Array<{
      kind: "page_image" | "problem_crop";
      s3Key: string;
      format: "png" | "webp";
    }> = [];

    const pageImageKey = payload.pageImageS3Key;
    if (
      typeof pageImageKey === "string" &&
      pageImageKey &&
      !existingAssetKeys.has(pageImageKey)
    ) {
      assetsToCreate.push({
        kind: "page_image",
        s3Key: pageImageKey,
        format: "png",
      });
    }

    const problemImageKey = payload.problemImageS3Key;
    if (
      typeof problemImageKey === "string" &&
      problemImageKey &&
      !existingAssetKeys.has(problemImageKey)
    ) {
      assetsToCreate.push({
        kind: "problem_crop",
        s3Key: problemImageKey,
        format: "webp",
      });
    }

    for (const asset of assetsToCreate) {
      await this.prisma.problemAsset.create({
        data: {
          problemId,
          kind: asset.kind,
          s3Key: asset.s3Key,
          format: asset.format,
        },
      });
      existingAssetKeys.add(asset.s3Key);
    }
  }

  private async syncLayoutMetadata(
    problemId: string,
    existingBbox: unknown,
    payload: Record<string, unknown>,
  ) {
    if (!payload.bbox || typeof payload.bbox !== "object" || Array.isArray(payload.bbox)) {
      return;
    }

    const nextBbox = payload.bbox as Record<string, unknown>;
    const currentBbox =
      existingBbox && typeof existingBbox === "object" && !Array.isArray(existingBbox)
        ? (existingBbox as Record<string, unknown>)
        : null;

    const hasStructuredLayout =
      Array.isArray(nextBbox.boxed_blocks) && nextBbox.boxed_blocks.length > 0;
    const currentHasStructuredLayout =
      currentBbox &&
      Array.isArray(currentBbox.boxed_blocks) &&
      currentBbox.boxed_blocks.length > 0;

    if (!hasStructuredLayout && currentHasStructuredLayout) {
      return;
    }

    if (JSON.stringify(currentBbox) === JSON.stringify(nextBbox)) {
      return;
    }

    await this.prisma.problem.update({
      where: { id: problemId },
      data: { bbox: nextBbox as any },
    });
  }

  async syncExamMetadata(problemIds: string[]): Promise<void> {
    const dedupedIds = [...new Set(problemIds.filter((id) => typeof id === "string" && id.length > 0))];
    if (dedupedIds.length === 0) {
      return;
    }

    const problems = await this.prisma.problem.findMany({
      where: { id: { in: dedupedIds } },
      select: {
        id: true,
        problemNumber: true,
        displayNumber: true,
        subject: true,
        isCommon: true,
        examSource: true,
        ocrJob: {
          select: {
            sourceFile: {
              select: { filename: true },
            },
          },
        },
      },
    });

    for (const problem of problems as StoredProblemForMetaSync[]) {
      const lookup = this.resolveExamMetaLookup(
        {
          problemNumber: problem.problemNumber,
          displayNumber: problem.displayNumber,
          subject: problem.subject,
          isCommon: problem.isCommon,
          examSource: problem.examSource,
        },
        problem.ocrJob?.sourceFile?.filename,
      );
      if (!lookup) {
        continue;
      }

      const candidates = await this.findExamMetaCandidates(lookup);
      await this.attachExamMetaToProblem(problem.id, lookup, candidates);
    }
  }

  async materialize(
    ocrJobId: string,
    sourceFileId: string,
    problems: Array<Record<string, unknown>>,
  ): Promise<{ createdIds: string[]; skippedCount: number; failedCount: number }> {
    const sourceFile = await this.prisma.sourceFile.findUnique({
      where: { id: sourceFileId },
      select: { filename: true },
    });
    const preparedProblems: PreparedIncomingProblem[] = problems.map((raw) => {
      const normalized = normalizeOcrProblem(raw);
      return {
        raw,
        normalized,
        fingerprint: this.buildProblemFingerprint(
          {
            problemType: normalized.problemType,
            stemLatex: normalized.stemLatex,
            stemText: normalized.stemText,
          },
          normalized.choices,
        ),
      };
    });

    const stemTexts = [...new Set(preparedProblems.map((problem) => problem.normalized.stemText).filter(Boolean))];
    const stemLatexes = [...new Set(preparedProblems.map((problem) => problem.normalized.stemLatex).filter(Boolean))];
    const whereClauses: Array<
      | { stemText: { in: string[] } }
      | { stemLatex: { in: string[] } }
    > = [];
    if (stemTexts.length > 0) {
      whereClauses.push({ stemText: { in: stemTexts } });
    }
    if (stemLatexes.length > 0) {
      whereClauses.push({ stemLatex: { in: stemLatexes } });
    }

    const existingProblems: ExistingProblemRecord[] = whereClauses.length
      ? await this.prisma.problem.findMany({
          where: { ocrJobId, OR: whereClauses },
          select: {
            id: true,
            problemType: true,
            problemNumber: true,
            displayNumber: true,
            startPage: true,
            endPage: true,
            stemLatex: true,
            stemText: true,
            bbox: true,
            choices: {
              select: {
                position: true,
                label: true,
                contentLatex: true,
                contentText: true,
              },
              orderBy: { position: "asc" },
            },
            assets: {
              select: { s3Key: true },
            },
          },
        }) as ExistingProblemRecord[]
      : [];

    const existingByFingerprint = new Map<string, ExistingProblemRecord>();
    const existingById = new Map<string, ExistingProblemRecord>();
    for (const problem of existingProblems) {
      const fingerprint = this.buildProblemFingerprint(problem, problem.choices);
      if (!existingByFingerprint.has(fingerprint)) {
        existingByFingerprint.set(fingerprint, problem);
      }
      existingById.set(problem.id, problem);
    }

    const createdIds: string[] = [];
    let skippedCount = 0;
    let failedCount = 0;
    for (const prepared of preparedProblems) {
      const p = prepared.raw;
      try {
        const normalizedProblem = prepared.normalized;
        const choices = normalizedProblem.choices;
        const fingerprint = prepared.fingerprint;
        let existingProblem = existingByFingerprint.get(fingerprint) ?? null;
        if (!existingProblem) {
          existingProblem = await this.findExistingProblemByExamMeta(
            p,
            sourceFile?.filename,
            existingById,
          );
          if (existingProblem) {
            existingByFingerprint.set(
              this.buildProblemFingerprint(existingProblem, existingProblem.choices),
              existingProblem,
            );
          }
        }

        if (existingProblem) {
          skippedCount++;
          await this.syncLayoutMetadata(existingProblem.id, existingProblem.bbox, p);
          await this.ensureAssets(
            existingProblem.id,
            new Set(existingProblem.assets.map((asset) => asset.s3Key)),
            p,
          );
          await this.syncExamMetaForIncomingProblem(
            existingProblem.id,
            p,
            sourceFile?.filename,
          );
          continue;
        }
        const sanitizedBookSource = this.uploadPolicy.sanitizeBookSource(
          p.bookSource,
        );

        const created = await this.prisma.problem.create({
          data: {
            ocrJobId,
            sourceFileId,
            problemNumber:
              typeof p.problemNumber === "string" ? p.problemNumber : null,
            displayNumber:
              typeof p.displayNumber === "string" ? p.displayNumber : null,
            problemType: normalizedProblem.problemType,
            startPage: typeof p.startPage === "number" ? p.startPage : 0,
            endPage: typeof p.endPage === "number" ? p.endPage : 0,
            stemLatex: normalizedProblem.stemLatex,
            stemText: normalizedProblem.stemText,
            ...(p.bbox && typeof p.bbox === "object" && !Array.isArray(p.bbox)
              ? { bbox: p.bbox as any }
              : {}),
            gradeLevel:
              typeof p.gradeLevel === "string" ? p.gradeLevel : null,
            subject: typeof p.subject === "string" ? p.subject : null,
            unitMajor:
              typeof p.unitMajor === "string" ? p.unitMajor : null,
            unitMinor:
              typeof p.unitMinor === "string" ? p.unitMinor : null,
            unitSub: typeof p.unitSub === "string" ? p.unitSub : null,
            difficulty:
              typeof p.difficulty === "number" ? p.difficulty : null,
            classificationConfidence:
              typeof p.classificationConfidence === "number"
                ? p.classificationConfidence
                : null,
            ...(sanitizedBookSource
              ? {
                  bookSource: sanitizedBookSource as any,
                }
              : {}),
            ...(p.examSource && typeof p.examSource === "object"
              ? { examSource: p.examSource as any }
              : {}),
            answerMatchStatus:
              typeof p.answerMatchStatus === "string"
                ? p.answerMatchStatus
                : null,
            solutionLatex:
              typeof p.solutionLatex === "string" ? p.solutionLatex : null,
            solutionText:
              typeof p.solutionText === "string" ? p.solutionText : null,
            ...(typeof p.answerText === "string"
              ? { answerText: p.answerText }
              : {}),
            reviewStatus: "pending_review",
            ...(choices && choices.length > 0
              ? {
                  choices: {
                    create: choices.map((c, i) => ({
                      position: c.position ?? i + 1,
                      label: c.label || `${i + 1}`,
                      contentLatex: c.contentLatex || "",
                      contentText: c.contentText || "",
                    })),
                  },
                }
              : {}),
          },
        });

        // Create ProblemAsset for page image if available
        const pageImageKey = p.pageImageS3Key;
        if (typeof pageImageKey === "string" && pageImageKey) {
          await this.prisma.problemAsset.create({
            data: {
              problemId: created.id,
              kind: "page_image",
              s3Key: pageImageKey,
              format: "png",
            },
          });
        }

        // Create ProblemAsset for cropped problem image if available
        const problemImageKey = p.problemImageS3Key;
        if (typeof problemImageKey === "string" && problemImageKey) {
          await this.prisma.problemAsset.create({
            data: {
              problemId: created.id,
              kind: "problem_crop",
              s3Key: problemImageKey,
              format: "webp",
            },
          });
        }

        createdIds.push(created.id);
        const createdRecord: ExistingProblemRecord = {
          id: created.id,
          problemType: created.problemType,
          problemNumber:
            typeof p.problemNumber === "string" ? p.problemNumber : null,
          displayNumber:
            typeof p.displayNumber === "string" ? p.displayNumber : null,
          startPage: typeof p.startPage === "number" ? p.startPage : 0,
          endPage: typeof p.endPage === "number" ? p.endPage : 0,
          stemLatex: normalizedProblem.stemLatex,
          stemText: normalizedProblem.stemText,
          bbox:
            p.bbox && typeof p.bbox === "object" && !Array.isArray(p.bbox)
              ? p.bbox
              : null,
          choices: choices.map((choice, index) => ({
            position: choice.position ?? index + 1,
            label: choice.label || `${index + 1}`,
            contentLatex: choice.contentLatex || "",
            contentText: choice.contentText || "",
          })),
          assets: [
            ...(typeof p.pageImageS3Key === "string" && p.pageImageS3Key
              ? [{ s3Key: p.pageImageS3Key }]
              : []),
            ...(typeof p.problemImageS3Key === "string" && p.problemImageS3Key
              ? [{ s3Key: p.problemImageS3Key }]
              : []),
          ],
        };
        existingByFingerprint.set(fingerprint, createdRecord);
        existingById.set(created.id, createdRecord);
        await this.syncExamMetaForIncomingProblem(
          created.id,
          p,
          sourceFile?.filename,
        );
      } catch (error) {
        failedCount++;
        this.logger.error(
          `Failed to create problem record for job ${ocrJobId}`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }

    this.logger.log(
      `Created ${createdIds.length} problem records for OCR job ${ocrJobId}`,
    );
    return { createdIds, skippedCount, failedCount };
  }
}
