import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  Logger,
  InternalServerErrorException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { ReviewStatus, OcrJobStatus } from "@prisma/client";
import { UpdateProblemDto } from "./dto/update-problem.dto";
import { BrowseProblemsDto } from "./dto/browse-problems.dto";
import { normalizeFilename } from "../common/filename";
import { TwinProblemService } from "./twin-problem.service";
import { EmbeddingService } from "./embedding.service";
import { ProblemRevisionService } from "./problem-revision.service";
import { RedisEventBusService } from "../common/redis-event-bus.service";
import {
  getAccessibleOcrJobWhere,
  getAccessibleProblemWhere,
  isAdminRole,
} from "../common/access-control";

export interface ProblemsQuery {
  requesterId: string;
  requesterRole: string;
  ocrJobId?: string;
  reviewStatus?: ReviewStatus;
  gradeLevel?: string;
  subject?: string;
  unitMajor?: string;
  difficulty?: string;
  problemType?: string;
  analysisStatus?: string;
  bookTitle?: string;
  q?: string;
  solutionTag?: string;
  examYear?: string;
  examMonth?: string;
  examType?: string;
  curriculumNodeId?: string;
  position?: string;        // "killer" | "semi_killer" | "normal"
  correctRateMin?: number;  // 0-100 percentage
  correctRateMax?: number;  // 0-100 percentage
  pointValue?: number;      // 2, 3, 4
  examYearMin?: number;     // minimum exam year (inclusive)
  sortBy?: string;          // "newest" | "correct_rate_asc" | "correct_rate_desc" | "point_value_desc"
  page?: number;
  limit?: number;
  includeDetails?: boolean;
}

function buildProblemListSelect(includeDetails: boolean) {
  return {
    id: true,
    stemLatex: true,
    stemText: true,
    problemNumber: true,
    displayNumber: true,
    problemType: true,
    bbox: includeDetails,
    reviewStatus: true,
    gradeLevel: true,
    subject: true,
    unitMajor: true,
    unitMinor: true,
    classification2015: true,
    classification2022: true,
    difficulty: true,
    classificationConfidence: true,
    solutionConfidence: true,
    reviewConfidence: true,
    solutionTags: true,
    analysisStatus: true,
    ocrJobId: true,
    startPage: true,
    endPage: true,
    bookSource: true,
    examSource: true,
    answerMatchStatus: true,
    solutionLatex: includeDetails,
    createdAt: true,
    choices: includeDetails
      ? {
          select: {
            label: true,
            contentLatex: true,
            contentText: true,
            position: true,
          },
          orderBy: { position: "asc" as const },
        }
      : false,
    assets: includeDetails
      ? {
          select: {
            id: true,
            kind: true,
            subKind: true,
            s3Key: true,
            format: true,
            widthPx: true,
            heightPx: true,
          },
        }
      : false,
    ocrJob: {
      select: {
        sourceFile: {
          select: { filename: true },
        },
      },
    },
  };
}

@Injectable()
export class ProblemsService {
  private readonly logger = new Logger(ProblemsService.name);

  constructor(
    private prisma: PrismaService,
    private eventBus: RedisEventBusService,
    private twinProblemService: TwinProblemService,
    private embeddingService: EmbeddingService,
    private problemRevisionService: ProblemRevisionService,
  ) {}

  private getProblemScopeWhere(requesterId: string, requesterRole: string) {
    return getAccessibleProblemWhere(requesterId, requesterRole);
  }

  private getOcrJobScopeWhere(requesterId: string, requesterRole: string) {
    return getAccessibleOcrJobWhere(requesterId, requesterRole);
  }

  async getFilterOptions(requesterId: string, requesterRole: string) {
    const where = this.getProblemScopeWhere(requesterId, requesterRole);

    const [subjects, gradeLevels, textbooks, difficulties, problemTypes, examYearsRaw, examTypesRaw, solutionTagsRaw] = await Promise.all([
      this.prisma.problem.findMany({
        where: { ...where, subject: { not: null } },
        select: { subject: true },
        distinct: ["subject"],
        orderBy: { subject: "asc" },
      }),
      this.prisma.problem.findMany({
        where: { ...where, gradeLevel: { not: null } },
        select: { gradeLevel: true },
        distinct: ["gradeLevel"],
        orderBy: { gradeLevel: "asc" },
      }),
      this.prisma.problem.findMany({
        where: { ...where, sourceFileId: { not: null } },
        select: {
          sourceFileId: true,
          ocrJob: {
            select: {
              sourceFile: { select: { filename: true, bookTitle: true } },
            },
          },
        },
        distinct: ["sourceFileId"],
      }),
      this.prisma.problem.findMany({
        where: { ...where, difficulty: { not: null } },
        select: { difficulty: true },
        distinct: ["difficulty"],
        orderBy: { difficulty: "asc" },
      }),
      this.prisma.problem.findMany({
        where,
        select: { problemType: true },
        distinct: ["problemType"],
      }),
      this.prisma.$queryRaw<{ year: number }[]>`
        SELECT DISTINCT (exam_source->>'year')::int as year
        FROM ocr.problems
        WHERE exam_source IS NOT NULL AND exam_source->>'year' IS NOT NULL
        ORDER BY year DESC
      `,
      this.prisma.$queryRaw<{ type: string }[]>`
        SELECT DISTINCT exam_source->>'type' as type
        FROM ocr.problems
        WHERE exam_source IS NOT NULL AND exam_source->>'type' IS NOT NULL
        ORDER BY type
      `,
      this.prisma.$queryRaw<{ tag: string }[]>`
        SELECT DISTINCT jsonb_array_elements_text(solution_tags) as tag
        FROM ocr.problems
        WHERE solution_tags IS NOT NULL
        ORDER BY tag
      `,
    ]);

    return {
      subjects: subjects.map((s) => s.subject).filter(Boolean),
      gradeLevels: gradeLevels.map((g) => g.gradeLevel).filter(Boolean),
      textbooks: textbooks
        .map((t) => ({
          filename: normalizeFilename(t.ocrJob?.sourceFile?.filename) ?? null,
          bookTitle: t.ocrJob?.sourceFile?.bookTitle ?? null,
        }))
        .filter((t) => t.filename),
      difficulties: difficulties.map((d) => d.difficulty).filter((d): d is number => d !== null),
      problemTypes: problemTypes.map((p) => p.problemType),
      examYears: examYearsRaw.map((r) => r.year),
      examTypes: examTypesRaw.map((r) => r.type),
      solutionTags: solutionTagsRaw.map((r) => r.tag),
    };
  }

  async findAll(query: ProblemsQuery) {
    return this.findAllWithExamMeta(query);
  }

  // Old findAll implementation (Prisma-based, kept as fallback reference)
  // async findAll_legacy(query: ProblemsQuery) {
  //   const page = query.page ?? 1;
  //   const limit = Math.min(query.limit ?? 20, 100);
  //   const skip = (page - 1) * limit;
  //   const includeDetails = query.includeDetails ?? true;
  //
  //   if (query.q) {
  //     try {
  //       return await this.hybridSearch(query);
  //     } catch (err) {
  //       this.logger.warn("Hybrid search failed, falling back to ILIKE", err);
  //     }
  //   }
  //
  //   const where: Record<string, unknown> = {
  //     ...this.getProblemScopeWhere(query.requesterId, query.requesterRole),
  //   };
  //
  //   if (query.ocrJobId) where.ocrJobId = query.ocrJobId;
  //   if (query.reviewStatus) where.reviewStatus = query.reviewStatus;
  //   if (query.gradeLevel) where.gradeLevel = query.gradeLevel;
  //   if (query.subject) where.subject = query.subject;
  //   if (query.unitMajor) where.unitMajor = query.unitMajor;
  //   if (query.problemType) where.problemType = query.problemType;
  //   if (query.analysisStatus) where.analysisStatus = query.analysisStatus;
  //   if (query.bookTitle) {
  //     where.bookSource = { path: ["title"], string_contains: query.bookTitle };
  //   }
  //   if (query.solutionTag) {
  //     where.solutionTags = { array_contains: [query.solutionTag] };
  //   }
  //   if (query.difficulty !== undefined) {
  //     const parsed = parseInt(query.difficulty, 10);
  //     if (!isNaN(parsed)) where.difficulty = parsed;
  //   }
  //
  //   const examSourceFilters: Record<string, unknown>[] = [];
  //   if (query.examYear) {
  //     examSourceFilters.push({
  //       examSource: { path: ["year"], equals: parseInt(query.examYear, 10) },
  //     });
  //   }
  //   if (query.examMonth) {
  //     examSourceFilters.push({
  //       examSource: { path: ["month"], equals: parseInt(query.examMonth, 10) },
  //     });
  //   }
  //   if (query.examType) {
  //     examSourceFilters.push({
  //       examSource: { path: ["type"], string_contains: query.examType },
  //     });
  //   }
  //   if (examSourceFilters.length > 0) {
  //     where.AND = examSourceFilters;
  //   }
  //
  //   if (query.curriculumNodeId) {
  //     const descendants = await this.prisma.$queryRaw<{ id: string }[]>`
  //       WITH RECURSIVE tree AS (
  //         SELECT id FROM ocr.curriculum_nodes WHERE id = ${query.curriculumNodeId}::uuid
  //         UNION ALL
  //         SELECT cn.id FROM ocr.curriculum_nodes cn
  //         JOIN tree t ON cn.parent_id = t.id
  //       )
  //       SELECT id FROM tree
  //     `;
  //     const nodeIds = descendants.map((d) => d.id);
  //     where.curriculumNodeId = { in: nodeIds };
  //   }
  //
  //   if (query.q) {
  //     where.stemText = { contains: query.q, mode: "insensitive" };
  //   }
  //
  //   const [items, total] = await Promise.all([
  //     this.prisma.problem.findMany({
  //       where,
  //       skip,
  //       take: limit,
  //       orderBy: { createdAt: "desc" },
  //       select: buildProblemListSelect(includeDetails),
  //     }),
  //     this.prisma.problem.count({ where }),
  //   ]);
  //
  //   return {
  //     data: items.map((item) => ({
  //       ...item,
  //       sourceFile: normalizeFilename(item.ocrJob?.sourceFile?.filename) ?? null,
  //       ocrJob: undefined,
  //     })),
  //     total,
  //     page,
  //     limit,
  //     totalPages: Math.ceil(total / limit),
  //   };
  // }

  private async findAllWithExamMeta(query: ProblemsQuery) {
    const { page = 1, limit: rawLimit = 20, requesterId, requesterRole } = query;
    const limit = Math.min(rawLimit, 100);
    const offset = (page - 1) * limit;

    const conditions: string[] = ['p.retired_at IS NULL'];
    const params: any[] = [];
    let paramIndex = 1;

    // Access control (ocr_jobs -> source_files -> uploader_id)
    if (requesterRole !== 'admin') {
      conditions.push(`p.ocr_job_id IN (
        SELECT oj.id FROM ocr.ocr_jobs oj
        JOIN ocr.source_files sf ON sf.id = oj.source_file_id
        WHERE sf.uploader_id = $${paramIndex}
      )`);
      params.push(requesterId);
      paramIndex++;
    }

    // Existing filters (preserved from current findAll)
    if (query.ocrJobId) {
      conditions.push(`p.ocr_job_id = $${paramIndex}`);
      params.push(query.ocrJobId);
      paramIndex++;
    }
    if (query.analysisStatus) {
      conditions.push(`p.analysis_status = $${paramIndex}`);
      params.push(query.analysisStatus);
      paramIndex++;
    }
    if (query.unitMajor) {
      conditions.push(`p.unit_major = $${paramIndex}`);
      params.push(query.unitMajor);
      paramIndex++;
    }
    if (query.reviewStatus) {
      conditions.push(`p.review_status = $${paramIndex}`);
      params.push(query.reviewStatus);
      paramIndex++;
    }
    if (query.subject) {
      conditions.push(`p.subject = $${paramIndex}`);
      params.push(query.subject);
      paramIndex++;
    }
    if (query.gradeLevel) {
      conditions.push(`p.grade_level = $${paramIndex}`);
      params.push(query.gradeLevel);
      paramIndex++;
    }
    if (query.difficulty) {
      conditions.push(`p.difficulty = $${paramIndex}`);
      params.push(parseInt(String(query.difficulty)));
      paramIndex++;
    }
    if (query.problemType) {
      conditions.push(`p.problem_type = $${paramIndex}`);
      params.push(query.problemType);
      paramIndex++;
    }
    if (query.bookTitle) {
      conditions.push(`p.book_source->>'title' = $${paramIndex}`);
      params.push(query.bookTitle);
      paramIndex++;
    }
    if (query.solutionTag) {
      conditions.push(`p.solution_tags @> $${paramIndex}::jsonb`);
      params.push(JSON.stringify([query.solutionTag]));
      paramIndex++;
    }
    if (query.q) {
      conditions.push(`p.stem_text ILIKE $${paramIndex}`);
      params.push(`%${query.q}%`);
      paramIndex++;
    }

    // Exam source filters (from problem's exam_source JSON)
    if (query.examYear) {
      conditions.push(`(p.exam_source->>'year')::int = $${paramIndex}`);
      params.push(parseInt(String(query.examYear)));
      paramIndex++;
    }
    if (query.examType) {
      conditions.push(`p.exam_source->>'type' = $${paramIndex}`);
      params.push(query.examType);
      paramIndex++;
    }

    // Exam year minimum (e.g., examYearMin=2023 for "최근 3년")
    if (query.examYearMin) {
      conditions.push(`(p.exam_source->>'year')::int >= $${paramIndex}`);
      params.push(query.examYearMin);
      paramIndex++;
    }

    // Exam month filter (from exam_question_meta or exam_source)
    if (query.examMonth) {
      const month = parseInt(String(query.examMonth));
      conditions.push(`(eqm.exam_month = $${paramIndex} OR (p.exam_source->>'month')::int = $${paramIndex})`);
      params.push(month);
      paramIndex++;
    }

    // Position filter (maps to correct_rate ranges)
    if (query.position === 'killer') {
      conditions.push(`eqm.correct_rate < 0.10`);
    } else if (query.position === 'semi_killer') {
      conditions.push(`eqm.correct_rate >= 0.10 AND eqm.correct_rate <= 0.30`);
    } else if (query.position === 'normal') {
      conditions.push(`eqm.correct_rate > 0.30`);
    }

    // Correct rate range filter
    if (query.correctRateMin !== undefined) {
      conditions.push(`eqm.correct_rate >= $${paramIndex}`);
      params.push(query.correctRateMin / 100);
      paramIndex++;
    }
    if (query.correctRateMax !== undefined) {
      conditions.push(`eqm.correct_rate < $${paramIndex}`);
      params.push(query.correctRateMax / 100);
      paramIndex++;
    }

    // Point value filter
    if (query.pointValue) {
      conditions.push(`eqm.point_value = $${paramIndex}`);
      params.push(query.pointValue);
      paramIndex++;
    }

    // Curriculum node filter (recursive CTE)
    let ctePart = '';
    if (query.curriculumNodeId) {
      ctePart = `WITH RECURSIVE curriculum_tree AS (
        SELECT id FROM ocr.curriculum_nodes WHERE id = $${paramIndex}::uuid
        UNION ALL
        SELECT cn.id FROM ocr.curriculum_nodes cn
        INNER JOIN curriculum_tree ct ON cn.parent_id = ct.id
      )`;
      conditions.push(`p.curriculum_node_id IN (SELECT id FROM curriculum_tree)`);
      params.push(query.curriculumNodeId);
      paramIndex++;
    }

    // Sort
    let orderBy = 'p.created_at DESC';
    if (query.sortBy === 'correct_rate_asc') orderBy = 'eqm.correct_rate ASC NULLS LAST';
    else if (query.sortBy === 'correct_rate_desc') orderBy = 'eqm.correct_rate DESC NULLS LAST';
    else if (query.sortBy === 'point_value_desc') orderBy = 'eqm.point_value DESC NULLS LAST, p.created_at DESC';

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Count query
    const countSql = `${ctePart}
      SELECT COUNT(DISTINCT p.id) as total
      FROM ocr.problems p
      LEFT JOIN LATERAL (
        SELECT * FROM ocr.exam_question_meta eqm2
        WHERE eqm2.problem_id = p.id
        ORDER BY eqm2.created_at DESC
        LIMIT 1
      ) eqm ON true
      ${whereClause}`;

    const countResult = await this.prisma.$queryRawUnsafe<[{ total: bigint }]>(countSql, ...params);
    const total = Number(countResult[0]?.total ?? 0);

    // Data query
    const dataSql = `${ctePart}
      SELECT
        p.id, p.stem_latex, p.stem_text, p.problem_number, p.display_number,
        p.problem_type, p.review_status, p.grade_level, p.subject,
        p.unit_major, p.unit_minor, p.difficulty, p.classification_confidence,
        p.solution_confidence, p.review_confidence, p.solution_tags,
        p.analysis_status, p.ocr_job_id, p.start_page, p.end_page,
        p.book_source, p.exam_source, p.answer_match_status, p.created_at,
        p.bbox, p.point_value AS p_point_value, p.position_type AS p_position_type,
        p.is_common AS p_is_common,
        sf.filename as source_filename,
        eqm.exam_year AS meta_exam_year, eqm.exam_month AS meta_exam_month,
        eqm.exam_type AS meta_exam_type, eqm.subject AS meta_subject,
        eqm.question_number AS meta_question_number,
        eqm.correct_answer AS meta_correct_answer,
        eqm.correct_rate AS meta_correct_rate,
        eqm.point_value AS meta_point_value,
        eqm.choice_rates AS meta_choice_rates,
        eqm.is_common AS meta_is_common
      FROM ocr.problems p
      LEFT JOIN LATERAL (
        SELECT * FROM ocr.exam_question_meta eqm2
        WHERE eqm2.problem_id = p.id
        ORDER BY eqm2.created_at DESC
        LIMIT 1
      ) eqm ON true
      LEFT JOIN ocr.ocr_jobs oj ON p.ocr_job_id = oj.id
      LEFT JOIN ocr.source_files sf ON oj.source_file_id = sf.id
      ${whereClause}
      ORDER BY ${orderBy}
      LIMIT ${limit} OFFSET ${offset}`;

    const rows = await this.prisma.$queryRawUnsafe<any[]>(dataSql, ...params);

    const problems = rows.map(row => ({
      id: row.id,
      stemLatex: row.stem_latex,
      stemText: row.stem_text,
      problemNumber: row.problem_number,
      displayNumber: row.display_number,
      problemType: row.problem_type,
      reviewStatus: row.review_status,
      gradeLevel: row.grade_level,
      subject: row.subject,
      unitMajor: row.unit_major,
      unitMinor: row.unit_minor,
      difficulty: row.difficulty,
      classificationConfidence: row.classification_confidence,
      startPage: row.start_page,
      bookSource: row.book_source,
      examSource: row.exam_source,
      createdAt: row.created_at,
      sourceFile: row.source_filename,
      bbox: row.bbox,
      examMeta: row.meta_exam_year ? {
        examYear: row.meta_exam_year,
        examMonth: row.meta_exam_month,
        examType: row.meta_exam_type,
        subject: row.meta_subject,
        questionNumber: row.meta_question_number,
        correctAnswer: row.meta_correct_answer,
        correctRate: row.meta_correct_rate,
        pointValue: row.meta_point_value,
        choiceRates: row.meta_choice_rates,
        isCommon: row.meta_is_common,
      } : null,
    }));

    return {
      data: problems,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findByIds(ids: string[]) {
    if (!ids || ids.length === 0) return [];
    const problems = await this.prisma.problem.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        stemLatex: true,
        stemText: true,
        problemNumber: true,
        displayNumber: true,
        problemType: true,
        bbox: true,
        difficulty: true,
        subject: true,
        unitMajor: true,
        choices: {
          select: {
            label: true,
            contentLatex: true,
            contentText: true,
            position: true,
          },
          orderBy: { position: "asc" },
        },
      },
    });
    // Preserve the order of input ids
    const map = new Map(problems.map((p) => [p.id, p]));
    return ids.map((id) => map.get(id)).filter(Boolean);
  }

  async semanticSearch(query: string, filters: ProblemsQuery, limit = 20) {
    const embedding = await this.embeddingService.embed(query);
    const vectorStr = `[${embedding.join(",")}]`;
    const safeLimit = Math.max(1, Math.min(limit, 100));

    const conditions = [
      `p.embedding IS NOT NULL`,
      `p.review_status IN ('approved', 'auto_approved')`,
      `p.retired_at IS NULL`,
    ];
    const joins: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (filters.requesterRole !== "admin") {
      joins.push(`JOIN ocr.ocr_jobs oj ON oj.id = p.ocr_job_id`);
      joins.push(`JOIN ocr.source_files sf ON sf.id = oj.source_file_id`);
      conditions.push(`sf.uploader_id = $${paramIndex++}`);
      params.push(filters.requesterId);
    }

    if (filters.subject) {
      conditions.push(`p.subject = $${paramIndex++}`);
      params.push(filters.subject);
    }
    if (filters.gradeLevel) {
      conditions.push(`p.grade_level = $${paramIndex++}`);
      params.push(filters.gradeLevel);
    }
    if (filters.difficulty) {
      conditions.push(`p.difficulty = $${paramIndex++}`);
      params.push(parseInt(filters.difficulty, 10));
    }

    const whereClause = conditions.join(" AND ");
    params.push(vectorStr);
    const vectorParamIdx = paramIndex++;
    params.push(safeLimit);
    const limitParamIdx = paramIndex++;

    const sql = `
      SELECT p.id, p.stem_text AS "stemText", p.stem_latex AS "stemLatex",
             p.subject, p.unit_major AS "unitMajor", p.difficulty,
             p.problem_type AS "problemType", p.grade_level AS "gradeLevel",
             p.display_number AS "displayNumber", p.problem_number AS "problemNumber",
             p.review_status AS "reviewStatus",
             1 - (p.embedding <=> $${vectorParamIdx}::vector) AS similarity
      FROM ocr.problems p
      ${joins.join("\n")}
      WHERE ${whereClause}
      ORDER BY p.embedding <=> $${vectorParamIdx}::vector
      LIMIT $${limitParamIdx}
    `;

    const rows = await this.prisma.$queryRawUnsafe(sql, ...params);
    return {
      data: rows,
      total: (rows as unknown[]).length,
      page: 1,
      limit: safeLimit,
      totalPages: 1,
    };
  }

  private async hybridSearch(query: ProblemsQuery) {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    const offset = (page - 1) * limit;
    const textQuery = query.q!;

    // Attempt embedding — null if service unavailable (keyword-only mode)
    let vectorStr: string | null = null;
    try {
      const embedding = await this.embeddingService.embed(textQuery);
      vectorStr = `[${embedding.join(",")}]`;
    } catch (err) {
      this.logger.warn(
        "Embedding unavailable for hybrid search, keyword-only mode",
        err,
      );
    }

    const isAdmin = isAdminRole(query.requesterRole);
    const requesterId = query.requesterId;

    // Filter values (null = no filter applied)
    const ocrJobId = query.ocrJobId ?? null;
    const reviewStatus = (query.reviewStatus as string) ?? null;
    const gradeLevel = query.gradeLevel ?? null;
    const subject = query.subject ?? null;
    const unitMajor = query.unitMajor ?? null;
    const problemType = query.problemType ?? null;
    const analysisStatus = query.analysisStatus ?? null;
    const bookTitle = query.bookTitle ?? null;
    const solutionTagJson = query.solutionTag
      ? JSON.stringify([query.solutionTag])
      : null;
    const examType = query.examType ?? null;
    const curriculumNodeId = query.curriculumNodeId ?? null;

    const difficulty =
      query.difficulty !== undefined ? parseInt(query.difficulty, 10) : null;
    const safeDifficulty =
      difficulty !== null && !isNaN(difficulty) ? difficulty : null;
    const examYear = query.examYear ? parseInt(query.examYear, 10) : null;
    const safeExamYear =
      examYear !== null && !isNaN(examYear) ? examYear : null;
    const examMonth = query.examMonth ? parseInt(query.examMonth, 10) : null;
    const safeExamMonth =
      examMonth !== null && !isNaN(examMonth) ? examMonth : null;

    const rows = await this.prisma.$queryRaw<
      { id: string; total: bigint }[]
    >`
      WITH RECURSIVE
        curriculum_tree AS (
          SELECT id FROM ocr.curriculum_nodes WHERE id = ${curriculumNodeId}::uuid
          UNION ALL
          SELECT cn.id FROM ocr.curriculum_nodes cn
          JOIN curriculum_tree t ON cn.parent_id = t.id
        ),
        base AS (
          SELECT p.id, p.stem_tsv, p.embedding
          FROM ocr.problems p
          JOIN ocr.ocr_jobs oj ON oj.id = p.ocr_job_id
          JOIN ocr.source_files sf ON sf.id = oj.source_file_id
          WHERE p.retired_at IS NULL
            AND (${isAdmin}::boolean OR sf.uploader_id = ${requesterId})
            AND (${ocrJobId}::uuid IS NULL OR p.ocr_job_id = ${ocrJobId}::uuid)
            AND (${reviewStatus}::text IS NULL OR p.review_status::text = ${reviewStatus})
            AND (${gradeLevel}::text IS NULL OR p.grade_level = ${gradeLevel})
            AND (${subject}::text IS NULL OR p.subject = ${subject})
            AND (${unitMajor}::text IS NULL OR p.unit_major = ${unitMajor})
            AND (${problemType}::text IS NULL OR p.problem_type::text = ${problemType})
            AND (${analysisStatus}::text IS NULL OR p.analysis_status = ${analysisStatus})
            AND (${safeDifficulty}::int IS NULL OR p.difficulty = ${safeDifficulty})
            AND (${bookTitle}::text IS NULL OR p.book_source->>'title' LIKE '%' || ${bookTitle} || '%')
            AND (${solutionTagJson}::jsonb IS NULL OR p.solution_tags @> ${solutionTagJson}::jsonb)
            AND (${safeExamYear}::int IS NULL OR (p.exam_source->>'year')::int = ${safeExamYear})
            AND (${safeExamMonth}::int IS NULL OR (p.exam_source->>'month')::int = ${safeExamMonth})
            AND (${examType}::text IS NULL OR p.exam_source->>'type' LIKE '%' || ${examType} || '%')
            AND (${curriculumNodeId}::uuid IS NULL OR p.curriculum_node_id IN (SELECT id FROM curriculum_tree))
        ),
        keyword_results AS (
          SELECT id,
                 ROW_NUMBER() OVER (
                   ORDER BY ts_rank(stem_tsv, plainto_tsquery('simple', ${textQuery})) DESC
                 ) AS rank
          FROM base
          WHERE stem_tsv IS NOT NULL
            AND stem_tsv @@ plainto_tsquery('simple', ${textQuery})
        ),
        semantic_results AS (
          SELECT id,
                 ROW_NUMBER() OVER (
                   ORDER BY embedding <=> ${vectorStr}::vector
                 ) AS rank
          FROM base
          WHERE embedding IS NOT NULL
            AND ${vectorStr}::text IS NOT NULL
        ),
        ranked AS (
          SELECT COALESCE(k.id, s.id) AS id,
                 COALESCE(1.0 / (60 + k.rank), 0) + COALESCE(1.0 / (60 + s.rank), 0) AS rrf_score
          FROM keyword_results k
          FULL OUTER JOIN semantic_results s ON k.id = s.id
        )
      SELECT id, COUNT(*) OVER() AS total
      FROM ranked
      ORDER BY rrf_score DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `;

    if (rows.length === 0) {
      return { data: [], total: 0, page, limit, totalPages: 0 };
    }

    const total = Number(rows[0].total);
    const ids = rows.map((r) => r.id);

    // Fetch full problem data for the ranked IDs
    const problems = await this.prisma.problem.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        stemLatex: true,
        stemText: true,
        problemNumber: true,
        displayNumber: true,
        problemType: true,
        bbox: true,
        reviewStatus: true,
        gradeLevel: true,
        subject: true,
        unitMajor: true,
        unitMinor: true,
        classification2015: true,
        classification2022: true,
        difficulty: true,
        classificationConfidence: true,
        solutionConfidence: true,
        reviewConfidence: true,
        solutionTags: true,
        analysisStatus: true,
        ocrJobId: true,
        startPage: true,
        endPage: true,
        bookSource: true,
        examSource: true,
        answerMatchStatus: true,
        solutionLatex: true,
        createdAt: true,
        choices: {
          select: {
            label: true,
            contentLatex: true,
            contentText: true,
            position: true,
          },
          orderBy: { position: "asc" },
        },
        assets: {
          select: {
            id: true,
            kind: true,
            subKind: true,
            s3Key: true,
            format: true,
            widthPx: true,
            heightPx: true,
          },
        },
        ocrJob: {
          select: {
            sourceFile: {
              select: { filename: true },
            },
          },
        },
      },
    });

    // Preserve RRF order
    const orderMap = new Map(ids.map((id, i) => [id, i]));
    problems.sort(
      (a, b) => (orderMap.get(a.id) ?? 0) - (orderMap.get(b.id) ?? 0),
    );

    return {
      data: problems.map((item) => ({
        ...item,
        sourceFile:
          normalizeFilename(item.ocrJob?.sourceFile?.filename) ?? null,
        ocrJob: undefined,
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getStats(requesterId: string, requesterRole: string) {
    const ocrJobWhere = this.getOcrJobScopeWhere(requesterId, requesterRole);
    const problemWhere = this.getProblemScopeWhere(requesterId, requesterRole);
    const [totalJobs, completedJobs, failedJobs, totalProblems, pendingReview, approved, rejected] =
      await Promise.all([
        this.prisma.ocrJob.count({ where: ocrJobWhere }),
        this.prisma.ocrJob.count({
          where: { ...ocrJobWhere, status: OcrJobStatus.completed },
        }),
        this.prisma.ocrJob.count({
          where: { ...ocrJobWhere, status: OcrJobStatus.failed },
        }),
        this.prisma.problem.count({ where: problemWhere }),
        this.prisma.problem.count({
          where: {
            ...problemWhere,
            reviewStatus: ReviewStatus.pending_review,
          },
        }),
        this.prisma.problem.count({
          where: {
            ...problemWhere,
            reviewStatus: ReviewStatus.approved,
          },
        }),
        this.prisma.problem.count({
          where: {
            ...problemWhere,
            reviewStatus: ReviewStatus.rejected,
          },
        }),
      ]);

    const ocrSuccessRate = totalJobs > 0 ? completedJobs / totalJobs : null;

    return {
      ocr: { totalJobs, completedJobs, failedJobs, successRate: ocrSuccessRate },
      problems: { total: totalProblems, pendingReview, approved, rejected },
    };
  }

  async update(
    id: string,
    dto: UpdateProblemDto,
    requesterId: string,
    requesterRole: string,
  ) {
    const problem = await this.prisma.problem.findFirst({
      where: {
        id,
        ...this.getProblemScopeWhere(requesterId, requesterRole),
      },
    });
    if (!problem) throw new NotFoundException("Problem not found");

    // Build update payload from defined fields only
    const updateData: Record<string, unknown> = {};
    if (dto.stemLatex !== undefined) updateData.stemLatex = dto.stemLatex;
    if (dto.stemText !== undefined) updateData.stemText = dto.stemText;
    if (dto.problemType !== undefined) updateData.problemType = dto.problemType;
    if (dto.gradeLevel !== undefined) updateData.gradeLevel = dto.gradeLevel;
    if (dto.subject !== undefined) updateData.subject = dto.subject;
    if (dto.unitMajor !== undefined) updateData.unitMajor = dto.unitMajor;
    if (dto.unitMinor !== undefined) updateData.unitMinor = dto.unitMinor;
    if (dto.difficulty !== undefined) updateData.difficulty = dto.difficulty;
    if ((dto.stemLatex !== undefined || dto.stemText !== undefined) && problem.bbox) {
      const bbox =
        typeof problem.bbox === "object" && !Array.isArray(problem.bbox)
          ? { ...(problem.bbox as Record<string, unknown>) }
          : null;
      if (bbox) {
        delete bbox.boxed_blocks;
        delete bbox.structured_stem;
        updateData.bbox = bbox;
      }
    }

    return this.problemRevisionService.saveRevisionAndUpdate(
      id,
      updateData,
      requesterId,
      requesterRole,
    );
  }

  async triggerAnalysis(
    ocrJobId: string,
    requesterId: string,
    requesterRole: string,
    problemIds?: string[],
  ) {
    const accessibleJob = await this.prisma.ocrJob.findFirst({
      where: {
        id: ocrJobId,
        ...this.getOcrJobScopeWhere(requesterId, requesterRole),
      },
      select: { id: true },
    });
    if (!accessibleJob) {
      throw new NotFoundException("OCR job not found");
    }

    if (!problemIds || problemIds.length === 0) {
      const problems = await this.prisma.problem.findMany({
        where: {
          ocrJobId,
          ...this.getProblemScopeWhere(requesterId, requesterRole),
        },
        select: { id: true },
      });
      problemIds = problems.map((p) => p.id);
    } else {
      const accessibleProblems = await this.prisma.problem.findMany({
        where: {
          id: { in: problemIds },
          ocrJobId,
          ...this.getProblemScopeWhere(requesterId, requesterRole),
        },
        select: { id: true },
      });
      if (accessibleProblems.length !== problemIds.length) {
        throw new NotFoundException("Problem not found");
      }
    }

    if (problemIds.length === 0) {
      throw new NotFoundException("No problems found for this OCR job");
    }

    await this.prisma.problem.updateMany({
      where: { id: { in: problemIds } },
      data: { analysisStatus: "analyzing" },
    });

    try {
      await this.eventBus.publishDurable("analysis:request", {
        ocrJobId,
        problemIds,
      });
    } catch (error) {
      await this.prisma.problem.updateMany({
        where: { id: { in: problemIds } },
        data: { analysisStatus: "failed" },
      });
      throw new InternalServerErrorException(
        error instanceof Error ? error.message : "Failed to queue analysis",
      );
    }

    return {
      ocrJobId,
      problemCount: problemIds.length,
      status: "analyzing",
    };
  }

  async getAnalysis(problemId: string, requesterId: string, requesterRole: string) {
    const problem = await this.prisma.problem.findFirst({
      where: {
        id: problemId,
        ...this.getProblemScopeWhere(requesterId, requesterRole),
      },
      select: {
        id: true,
        stemLatex: true,
        stemText: true,
        subject: true,
        unitMajor: true,
        unitMinor: true,
        classification2015: true,
        classification2022: true,
        difficulty: true,
        difficultyRefined: true,
        solutionTags: true,
        solutionStrategy: true,
        requiredConcepts: true,
        solutionSteps: true,
        estimatedTimeSec: true,
        commonMistakes: true,
        isCommon: true,
        pointValue: true,
        questionFormat: true,
        positionType: true,
        examSource: true,
        analysisStatus: true,
        analyzedAt: true,
        classificationConfidence: true,
        solutionConfidence: true,
        reviewConfidence: true,
        reviewStatus: true,
        answerText: true,
      },
    });
    if (!problem) throw new NotFoundException("Problem not found");
    return problem;
  }

  async getProblem(problemId: string, requesterId: string, requesterRole: string) {
    const problem = await this.prisma.problem.findFirst({
      where: {
        id: problemId,
        ...this.getProblemScopeWhere(requesterId, requesterRole),
      },
      select: buildProblemListSelect(true),
    });
    if (!problem) {
      throw new NotFoundException("Problem not found");
    }

    return {
      ...problem,
      sourceFile: normalizeFilename(problem.ocrJob?.sourceFile?.filename) ?? null,
      ocrJob: undefined,
    };
  }

  async generateTwinProblem(
    problemId: string,
    requesterId: string,
    requesterRole: string,
  ) {
    const problem = await this.prisma.problem.findFirst({
      where: {
        id: problemId,
        ...this.getProblemScopeWhere(requesterId, requesterRole),
      },
      select: {
        id: true,
        displayNumber: true,
        problemNumber: true,
        problemType: true,
        gradeLevel: true,
        subject: true,
        unitMajor: true,
        unitMinor: true,
        difficulty: true,
        stemText: true,
        stemLatex: true,
        answerText: true,
        answerLatex: true,
        solutionText: true,
        solutionLatex: true,
        bookSource: true,
        choices: {
          select: {
            label: true,
            position: true,
            contentText: true,
            contentLatex: true,
          },
          orderBy: { position: "asc" },
        },
      },
    });

    if (!problem) {
      throw new NotFoundException("Problem not found");
    }

    return this.twinProblemService.generate(problem);
  }

  async generateVariants(
    problemId: string,
    count: number,
    requesterId: string,
    requesterRole: string,
    difficultyTarget?: number,
  ) {
    const problem = await this.prisma.problem.findFirst({
      where: {
        id: problemId,
        ...this.getProblemScopeWhere(requesterId, requesterRole),
      },
      select: {
        id: true,
        displayNumber: true,
        problemNumber: true,
        problemType: true,
        gradeLevel: true,
        subject: true,
        unitMajor: true,
        unitMinor: true,
        difficulty: true,
        stemText: true,
        stemLatex: true,
        answerText: true,
        answerLatex: true,
        solutionText: true,
        solutionLatex: true,
        bookSource: true,
        choices: {
          select: {
            label: true,
            position: true,
            contentText: true,
            contentLatex: true,
          },
          orderBy: { position: "asc" as const },
        },
      },
    });

    if (!problem) {
      throw new NotFoundException("Problem not found");
    }

    return this.twinProblemService.generateVariants(
      problem,
      count,
      difficultyTarget,
    );
  }

  async browse(dto: BrowseProblemsDto) {
    const page = dto.page ?? 1;
    const limit = Math.min(dto.limit ?? 20, 50);
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {
      reviewStatus: ReviewStatus.approved,
    };

    if (dto.subject) where.subject = dto.subject;
    if (dto.unitMajor) where.unitMajor = dto.unitMajor;
    if (dto.difficulty !== undefined) where.difficulty = dto.difficulty;
    if (dto.curriculumYear === 2015) {
      where.classification2015 = { not: null };
    } else if (dto.curriculumYear === 2022) {
      where.classification2022 = { not: null };
    }
    if (dto.search) {
      where.OR = [
        { stemText: { contains: dto.search, mode: "insensitive" } },
        { stemLatex: { contains: dto.search, mode: "insensitive" } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.problem.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          stemLatex: true,
          stemText: true,
          subject: true,
          unitMajor: true,
          unitMinor: true,
          difficulty: true,
          problemType: true,
        },
      }),
      this.prisma.problem.count({ where }),
    ]);

    return { items, total, page };
  }

  async getStudentView(id: string) {
    const problem = await this.prisma.problem.findFirst({
      where: {
        id,
        reviewStatus: ReviewStatus.approved,
      },
      select: {
        id: true,
        stemLatex: true,
        stemText: true,
        subject: true,
        unitMajor: true,
        unitMinor: true,
        difficulty: true,
        problemType: true,
        choices: {
          select: {
            id: true,
            label: true,
            contentText: true,
          },
          orderBy: { position: "asc" },
        },
      },
    });
    if (!problem) throw new NotFoundException("Problem not found");
    return problem;
  }

  async review(
    id: string,
    action: "approved" | "rejected",
    reviewerId: string,
    requesterRole: string,
  ) {
    const problem = await this.prisma.problem.findFirst({
      where: {
        id,
        ...this.getProblemScopeWhere(reviewerId, requesterRole),
      },
    });
    if (!problem) throw new NotFoundException("Problem not found");

    return this.problemRevisionService.saveRevisionAndUpdate(
      id,
      { reviewStatus: action as ReviewStatus, reviewedBy: reviewerId },
      reviewerId,
      requesterRole,
    );
  }

  private async retireProblemChecked(id: string, userId: string, userRole: string) {
    const problem = await this.prisma.problem.findUnique({
      where: { id },
      select: { id: true, ocrJobId: true, retiredAt: true },
    });

    if (!problem) return { success: false, reason: 'Problem not found' };
    if (problem.retiredAt) return { success: false, reason: 'Already retired' };

    // Access control: teacher can only retire own uploads
    if (userRole !== 'admin') {
      const ocrJob = await this.prisma.ocrJob.findUnique({
        where: { id: problem.ocrJobId },
        select: { sourceFile: { select: { uploaderId: true } } },
      });
      if (ocrJob?.sourceFile?.uploaderId !== userId) {
        return { success: false, reason: 'Access denied' };
      }
    }

    // Active assignment guard: block if problem is in a future/active assignment
    const activeAssignments = await this.prisma.assignmentProblem.findMany({
      where: {
        problemId: id,
        assignment: {
          OR: [
            { dueAt: null },
            { dueAt: { gt: new Date() } },
          ],
        },
      },
      select: { assignment: { select: { id: true, title: true } } },
      take: 3,
    });

    if (activeAssignments.length > 0) {
      const names = activeAssignments.map(a => a.assignment.title).join(', ');
      return { success: false, reason: `활성 과제에 포함됨: ${names}` };
    }

    await this.prisma.problem.update({
      where: { id },
      data: {
        reviewStatus: 'retired',
        retiredAt: new Date(),
        retiredBy: userId,
      },
    });

    return { success: true };
  }

  async retireProblem(id: string, userId: string, userRole: string) {
    const result = await this.retireProblemChecked(id, userId, userRole);
    if (!result.success) {
      if (result.reason === 'Problem not found') throw new NotFoundException(result.reason);
      if (result.reason === 'Access denied') throw new ForbiddenException(result.reason);
      throw new ConflictException(result.reason);
    }
    return { problemId: id, status: 'retired' };
  }

  async batchRetire(ids: string[], userId: string, userRole: string) {
    const retired: string[] = [];
    const blocked: Array<{ id: string; reason: string }> = [];

    for (const id of ids) {
      const result = await this.retireProblemChecked(id, userId, userRole);
      if (result.success) {
        retired.push(id);
      } else {
        blocked.push({ id, reason: result.reason! });
      }
    }

    return { retired: retired.length, blocked };
  }
}
