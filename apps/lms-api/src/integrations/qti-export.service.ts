import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import {
  canAccessAssignment,
  getAccessibleProblemWhere,
} from "../common/access-control";
import {
  escapeXml,
  latexToMathmlAnnotation,
  buildAssessmentItemXml,
  buildAssessmentTestXml,
} from "./qti-templates";

@Injectable()
export class QtiExportService {
  constructor(private prisma: PrismaService) {}

  async exportProblem(
    problemId: string,
    requesterId: string,
    requesterRole: string,
  ): Promise<string> {
    const problem = await this.prisma.problem.findFirst({
      where: {
        id: problemId,
        ...getAccessibleProblemWhere(requesterId, requesterRole),
      },
      include: {
        choices: { orderBy: { position: "asc" } },
      },
    });
    if (!problem) throw new NotFoundException("Problem not found");

    return this.buildItemXml(problem);
  }

  async exportAssignment(
    assignmentId: string,
    requesterId: string,
    requesterRole: string,
  ): Promise<string> {
    const allowed = await canAccessAssignment(
      this.prisma,
      requesterId,
      requesterRole,
      assignmentId,
    );
    if (!allowed) {
      throw new ForbiddenException("Not authorized to export this assignment");
    }

    const assignment = await this.prisma.assignment.findUnique({
      where: { id: assignmentId },
      include: {
        assignmentProblems: {
          orderBy: { orderIndex: "asc" },
        },
      },
    });
    if (!assignment) throw new NotFoundException("Assignment not found");

    const problemIds = assignment.assignmentProblems.map((ap) => ap.problemId);

    return buildAssessmentTestXml({
      id: assignment.id,
      title: assignment.title,
      itemRefs: problemIds,
    });
  }

  async importQti(xml: string, userId: string): Promise<{ imported: number; problems: string[] }> {
    // Basic QTI 2.1 assessmentItem parser — handles MC and SA interactions.
    // A production implementation would use a full XML parser (e.g. fast-xml-parser).
    const items = this.parseAssessmentItems(xml);
    const createdIds: string[] = [];

    for (const item of items) {
      // Find or create a minimal OCR job to satisfy the FK requirement.
      // In a real import flow the caller would supply an ocrJobId.
      let ocrJob = await this.prisma.ocrJob.findFirst({
        where: { sourceFile: { uploaderId: userId } },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });

      if (!ocrJob) {
        // Cannot import without an associated OCR job — skip silently.
        continue;
      }

      const problem = await this.prisma.problem.create({
        data: {
          ocrJobId: ocrJob.id,
          stemLatex: item.stemLatex,
          stemText: item.stemText,
          problemType: item.isMultipleChoice ? "multiple_choice" : "short_answer",
          startPage: 0,
          endPage: 0,
          reviewStatus: "pending_review",
          answerText: item.correctAnswer ?? null,
        },
      });

      if (item.isMultipleChoice && item.choices.length > 0) {
        await this.prisma.problemChoice.createMany({
          data: item.choices.map((c, idx) => ({
            problemId: problem.id,
            position: idx + 1,
            label: String(idx + 1),
            contentLatex: c.text,
            contentText: c.text,
            isCorrect: c.identifier === item.correctAnswer,
          })),
        });
      }

      createdIds.push(problem.id);
    }

    return { imported: createdIds.length, problems: createdIds };
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  private buildItemXml(
    problem: {
      id: string;
      stemLatex: string;
      stemText: string;
      problemType: string;
      difficulty: number | null;
      subject: string | null;
      curriculumNodeId: string | null;
      answerText: string | null;
      choices: Array<{
        label: string;
        contentLatex: string;
        contentText: string;
        isCorrect: boolean | null;
      }>;
    },
  ): string {
    const isMultipleChoice = problem.problemType === "multiple_choice";
    const stemHtml = `    <p>${escapeXml(problem.stemText)}</p>
    ${problem.stemLatex ? latexToMathmlAnnotation(problem.stemLatex) : ""}`;

    let responseDeclaration: string;
    let interaction: string;
    let responseProcessing: string;

    if (isMultipleChoice) {
      const correctChoice =
        problem.choices.find((c) => c.isCorrect)?.label ?? problem.answerText ?? "";

      responseDeclaration = `  <responseDeclaration identifier="RESPONSE" cardinality="single" baseType="identifier">
    <correctResponse>
      <value>${escapeXml(correctChoice)}</value>
    </correctResponse>
  </responseDeclaration>`;

      const choiceXml = problem.choices
        .map(
          (c) =>
            `      <simpleChoice identifier="${escapeXml(c.label)}">${escapeXml(c.contentText || c.contentLatex)}</simpleChoice>`,
        )
        .join("\n");

      interaction = `    <choiceInteraction responseIdentifier="RESPONSE" shuffle="false" maxChoices="1">
      <prompt>${escapeXml(problem.stemText)}</prompt>
${choiceXml}
    </choiceInteraction>`;

      responseProcessing = `  <responseProcessing template="http://www.imsglobal.org/question/qti_v2p1/rptemplates/match_correct"/>`;
    } else {
      // short_answer / written_solution / essay → textEntryInteraction
      responseDeclaration = `  <responseDeclaration identifier="RESPONSE" cardinality="single" baseType="string">
    <correctResponse>
      <value>${escapeXml(problem.answerText ?? "")}</value>
    </correctResponse>
  </responseDeclaration>`;

      interaction = `    <textEntryInteraction responseIdentifier="RESPONSE" expectedLength="50"/>`;

      responseProcessing = `  <responseProcessing template="http://www.imsglobal.org/question/qti_v2p1/rptemplates/match_correct"/>`;
    }

    const outcomeDeclaration = `  <outcomeDeclaration identifier="SCORE" cardinality="single" baseType="float">
    <defaultValue><value>0</value></defaultValue>
  </outcomeDeclaration>`;

    const metadata = `  <itemMetadata>
    <qtiMetadata>
      <toolName>JSMath</toolName>
      <toolVersion>1.0</toolVersion>
    </qtiMetadata>
    <lom xmlns="http://ltsc.ieee.org/xsd/LOM">
      <educational>
        <difficulty>
          <langstring xml:lang="x-none">${problem.difficulty ?? ""}</langstring>
        </difficulty>
        <subject>
          <langstring xml:lang="ko">${escapeXml(problem.subject ?? "")}</langstring>
        </subject>
      </educational>
    </lom>
  </itemMetadata>`;

    return buildAssessmentItemXml({
      id: problem.id,
      title: `Problem ${problem.id}`,
      stemHtml,
      responseDeclaration,
      interaction,
      outcomeDeclaration,
      responseProcessing,
      metadata,
    });
  }

  private parseAssessmentItems(xml: string): Array<{
    id: string;
    stemText: string;
    stemLatex: string;
    isMultipleChoice: boolean;
    correctAnswer: string | null;
    choices: Array<{ identifier: string; text: string }>;
  }> {
    const items: ReturnType<typeof this.parseAssessmentItems> = [];

    // Extract all <assessmentItem ...> blocks with a simple regex split.
    // NOTE: A proper XML parser should be used in production.
    const itemPattern = /<assessmentItem[\s\S]*?<\/assessmentItem>/g;
    let match: RegExpExecArray | null;

    while ((match = itemPattern.exec(xml)) !== null) {
      const block = match[0];

      const idMatch = /identifier="([^"]+)"/.exec(block);
      const id = idMatch?.[1] ?? `imported-${Date.now()}`;

      // Grab prompt/p text as the stem
      const promptMatch = /<prompt>([\s\S]*?)<\/prompt>/i.exec(block);
      const pMatch = /<p>([\s\S]*?)<\/p>/i.exec(block);
      const stemText = this.stripTags(promptMatch?.[1] ?? pMatch?.[1] ?? "");

      // LaTeX from math annotation
      const annotationMatch = /<annotation encoding="application\/x-tex">([\s\S]*?)<\/annotation>/i.exec(block);
      const stemLatex = this.unescapeXml(annotationMatch?.[1] ?? "");

      // Multiple choice?
      const isMultipleChoice = /<choiceInteraction/i.test(block);

      // Choices
      const choicePattern = /<simpleChoice identifier="([^"]+)">([\s\S]*?)<\/simpleChoice>/gi;
      const choices: Array<{ identifier: string; text: string }> = [];
      let choiceMatch: RegExpExecArray | null;
      while ((choiceMatch = choicePattern.exec(block)) !== null) {
        choices.push({
          identifier: choiceMatch[1],
          text: this.stripTags(choiceMatch[2]),
        });
      }

      // Correct answer from responseDeclaration
      const correctMatch = /<correctResponse>[\s\S]*?<value>([\s\S]*?)<\/value>[\s\S]*?<\/correctResponse>/i.exec(block);
      const correctAnswer = correctMatch ? this.unescapeXml(correctMatch[1].trim()) : null;

      items.push({ id, stemText, stemLatex, isMultipleChoice, correctAnswer, choices });
    }

    return items;
  }

  private stripTags(html: string): string {
    return html.replace(/<[^>]+>/g, "").trim();
  }

  private unescapeXml(str: string): string {
    return str
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'");
  }
}
