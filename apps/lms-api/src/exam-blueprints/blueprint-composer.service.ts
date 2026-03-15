import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { ProblemUsageLogService } from "../problems/problem-usage-log.service";

// ── Types ──────────────────────────────────────────────────────────────

interface UnitDistEntry {
  subject?: string;
  unitMajor?: string;
  label: string;
  percentage: number;
  minCount?: number;
  maxCount?: number;
}

interface DiffDistEntry {
  min: number;
  max: number;
  label: string;
  percentage: number;
}

interface TypeDistEntry {
  problemType: string;
  count: number;
}

interface Slot {
  index: number;
  subject?: string;
  unitMajor?: string;
  diffMin: number;
  diffMax: number;
  problemType?: string;
  candidateCount?: number;
}

interface CandidateProblem {
  id: string;
  subject: string | null;
  unitMajor: string | null;
  difficulty: number | null;
  problemType: string;
  sourceFileId: string | null;
  gradeLevel: string | null;
  estimatedTimeSec: number | null;
  pointValue: number | null;
}

interface Relaxation {
  slot: number;
  type: "expand_difficulty" | "expand_unit" | "relax_type" | "adjust_count";
  from: string;
  to: string;
}

export interface CompositionResult {
  problemIds: string[];
  matchScore: number;
  relaxations: Relaxation[];
}

// ── Service ────────────────────────────────────────────────────────────

@Injectable()
export class BlueprintComposerService {
  private readonly logger = new Logger(BlueprintComposerService.name);

  constructor(
    private prisma: PrismaService,
    private usageLog: ProblemUsageLogService,
  ) {}

  /** Run composition and persist a BlueprintGeneration record. */
  async compose(
    blueprintId: string,
    userId: string,
    classId?: string,
  ): Promise<{ generationId: string } & CompositionResult> {
    const bp = await this.loadBlueprint(blueprintId);

    const generation = await this.prisma.blueprintGeneration.create({
      data: { blueprintId, status: "running" },
    });

    try {
      const result = await this.runComposition(bp, classId);

      await this.prisma.blueprintGeneration.update({
        where: { id: generation.id },
        data: {
          status: "completed",
          selectedIds: result.problemIds,
          matchScore: result.matchScore,
          relaxations: result.relaxations as any,
        },
      });

      return { generationId: generation.id, ...result };
    } catch (err) {
      await this.prisma.blueprintGeneration.update({
        where: { id: generation.id },
        data: {
          status: "failed",
          errorMessage: (err instanceof Error ? err.message : String(err)).slice(0, 500),
        },
      });
      throw err;
    }
  }

  /** Check feasibility without creating a generation record. */
  async preview(
    blueprintId: string,
    userId: string,
    classId?: string,
  ): Promise<{
    feasibility: "full" | "partial" | "insufficient";
    totalRequired: number;
    totalAvailable: number;
    slotDetails: Array<{
      slot: number;
      required: number;
      available: number;
    }>;
  }> {
    const bp = await this.loadBlueprint(blueprintId);
    const candidates = await this.fetchCandidates(bp, classId);
    const slots = this.buildSlots(bp);

    const slotDetails = slots.map((slot, i) => {
      const matching = candidates.filter((c) => this.matchesSlot(c, slot));
      return { slot: i, required: 1, available: matching.length };
    });

    const totalRequired = slots.length;
    const totalAvailable = candidates.length;
    const filledSlots = slotDetails.filter((d) => d.available > 0).length;

    let feasibility: "full" | "partial" | "insufficient";
    if (filledSlots >= totalRequired) {
      feasibility = "full";
    } else if (filledSlots >= Math.ceil(totalRequired * 0.5)) {
      feasibility = "partial";
    } else {
      feasibility = "insufficient";
    }

    return { feasibility, totalRequired, totalAvailable, slotDetails };
  }

  // ── Core algorithm ─────────────────────────────────────────────────

  private async runComposition(
    bp: BlueprintData,
    classId?: string,
  ): Promise<CompositionResult> {
    const candidates = await this.fetchCandidates(bp, classId);
    if (candidates.length === 0) {
      throw new BadRequestException(
        "No eligible problems found for this blueprint",
      );
    }

    const slots = this.buildSlots(bp);
    if (slots.length === 0) {
      throw new BadRequestException(
        "Blueprint distributions produce zero slots",
      );
    }

    // Annotate slots with candidate counts for constraint-tightness sorting
    for (const slot of slots) {
      slot.candidateCount = candidates.filter((c) =>
        this.matchesSlot(c, slot),
      ).length;
    }

    // Sort by constraint tightness (fewest candidates first)
    const sortedSlots = [...slots].sort(
      (a, b) => (a.candidateCount ?? 0) - (b.candidateCount ?? 0),
    );

    // Greedy fill
    const selected: CandidateProblem[] = [];
    const usedIds = new Set<string>();
    const relaxations: Relaxation[] = [];
    const pool = [...candidates];

    for (const slot of sortedSlots) {
      const pick = this.pickBestForSlot(slot, pool, usedIds, selected);

      if (pick) {
        selected.push(pick);
        usedIds.add(pick.id);
      } else {
        // Attempt relaxation
        const relaxedPick = this.pickWithRelaxation(
          slot,
          pool,
          usedIds,
          selected,
          relaxations,
        );
        if (relaxedPick) {
          selected.push(relaxedPick);
          usedIds.add(relaxedPick.id);
        }
        // If still no pick, slot goes unfilled
      }
    }

    // Swap refinement: iterate up to 100 times
    this.swapRefine(selected, pool, usedIds, sortedSlots);

    const matchScore = this.computeMatchScore(selected, sortedSlots);
    const problemIds = selected.map((p) => p.id);

    return { problemIds, matchScore, relaxations };
  }

  // ── Slot building ──────────────────────────────────────────────────

  private buildSlots(bp: BlueprintData): Slot[] {
    const units = bp.unitDistribution as UnitDistEntry[];
    const diffs = bp.difficultyDistribution as DiffDistEntry[];
    const types = bp.typeDistribution as TypeDistEntry[];
    const total = bp.totalQuestions;

    // Compute per-unit counts from percentages
    const unitCounts = this.distributeByPercentage(
      units.map((u) => u.percentage),
      total,
    );

    // Compute per-difficulty counts from percentages
    const diffCounts = this.distributeByPercentage(
      diffs.map((d) => d.percentage),
      total,
    );

    // Build a type lookup: problemType → target count
    const typeMap = new Map<string, number>();
    for (const t of types) {
      typeMap.set(t.problemType, (typeMap.get(t.problemType) ?? 0) + t.count);
    }

    // Create slots by crossing unit × difficulty proportionally
    const slots: Slot[] = [];
    let slotIndex = 0;

    for (let ui = 0; ui < units.length; ui++) {
      const unitCount = unitCounts[ui];
      // Sub-distribute difficulty within this unit's count
      const subDiffCounts = this.distributeByPercentage(
        diffs.map((d) => d.percentage),
        unitCount,
      );

      for (let di = 0; di < diffs.length; di++) {
        for (let k = 0; k < subDiffCounts[di]; k++) {
          slots.push({
            index: slotIndex++,
            subject: units[ui].subject,
            unitMajor: units[ui].unitMajor,
            diffMin: diffs[di].min,
            diffMax: diffs[di].max,
          });
        }
      }
    }

    // Assign type constraints to slots round-robin if type distribution exists
    if (types.length > 0) {
      const typeSlots: string[] = [];
      for (const t of types) {
        for (let i = 0; i < t.count; i++) {
          typeSlots.push(t.problemType);
        }
      }
      for (let i = 0; i < slots.length && i < typeSlots.length; i++) {
        slots[i].problemType = typeSlots[i];
      }
    }

    return slots;
  }

  /** Distribute a total across buckets by percentage, using largest-remainder. */
  private distributeByPercentage(
    percentages: number[],
    total: number,
  ): number[] {
    if (percentages.length === 0) return [];
    const sum = percentages.reduce((a, b) => a + b, 0);
    if (sum === 0) {
      // Equal distribution fallback
      const base = Math.floor(total / percentages.length);
      const result = percentages.map(() => base);
      let remainder = total - base * percentages.length;
      for (let i = 0; remainder > 0; i++, remainder--) {
        result[i]++;
      }
      return result;
    }

    const exact = percentages.map((p) => (p / sum) * total);
    const floored = exact.map(Math.floor);
    let remainder = total - floored.reduce((a, b) => a + b, 0);

    // Largest remainder method
    const remainders = exact
      .map((e, i) => ({ i, r: e - floored[i] }))
      .sort((a, b) => b.r - a.r);

    for (const { i } of remainders) {
      if (remainder <= 0) break;
      floored[i]++;
      remainder--;
    }

    return floored;
  }

  // ── Candidate fetching ─────────────────────────────────────────────

  private async fetchCandidates(
    bp: BlueprintData,
    classId?: string,
  ): Promise<CandidateProblem[]> {
    const excludeIds = new Set<string>();

    // Static exclusions from blueprint
    const staticExcludes = (bp.excludeProblemIds ?? []) as string[];
    for (const id of staticExcludes) excludeIds.add(id);

    // Recent usage exclusions
    if (bp.excludeRecentDays && classId) {
      const recentIds = await this.usageLog.getExcludedProblemIds(
        classId,
        bp.excludeRecentDays,
      );
      for (const id of recentIds) excludeIds.add(id);
    }

    const where: any = {
      reviewStatus: { in: ["approved", "calibrated", "auto_approved"] },
    };

    if (bp.gradeLevel) {
      where.gradeLevel = bp.gradeLevel;
    }

    if (excludeIds.size > 0) {
      where.id = { notIn: [...excludeIds] };
    }

    const problems = await this.prisma.problem.findMany({
      where,
      select: {
        id: true,
        subject: true,
        unitMajor: true,
        difficulty: true,
        problemType: true,
        sourceFileId: true,
        gradeLevel: true,
        estimatedTimeSec: true,
        pointValue: true,
      },
    });

    return problems as CandidateProblem[];
  }

  // ── Scoring ────────────────────────────────────────────────────────

  private scoreCandidate(
    candidate: CandidateProblem,
    slot: Slot,
    selected: CandidateProblem[],
  ): number {
    let score = 0;

    // Unit match: 40%
    if (slot.unitMajor) {
      if (candidate.unitMajor === slot.unitMajor) {
        score += 0.4;
      } else if (slot.subject && candidate.subject === slot.subject) {
        score += 0.2;
      }
    } else if (slot.subject) {
      if (candidate.subject === slot.subject) {
        score += 0.4;
      }
    } else {
      score += 0.4; // No unit constraint = full marks
    }

    // Difficulty match: 25%
    const diff = candidate.difficulty ?? 3;
    if (diff >= slot.diffMin && diff <= slot.diffMax) {
      score += 0.25;
    } else {
      const distance = Math.min(
        Math.abs(diff - slot.diffMin),
        Math.abs(diff - slot.diffMax),
      );
      if (distance === 1) score += 0.15;
      else if (distance === 2) score += 0.05;
    }

    // Type match: 20%
    if (!slot.problemType || candidate.problemType === slot.problemType) {
      score += 0.2;
    }

    // Source diversity: 10% (penalize if same sourceFileId already selected)
    if (candidate.sourceFileId) {
      const sameSource = selected.filter(
        (s) => s.sourceFileId === candidate.sourceFileId,
      ).length;
      score += Math.max(0, 0.1 - sameSource * 0.02);
    } else {
      score += 0.1;
    }

    // Random jitter: 5%
    score += Math.random() * 0.05;

    return score;
  }

  private matchesSlot(candidate: CandidateProblem, slot: Slot): boolean {
    if (slot.unitMajor && candidate.unitMajor !== slot.unitMajor) return false;
    if (slot.subject && !slot.unitMajor && candidate.subject !== slot.subject)
      return false;
    const diff = candidate.difficulty ?? 3;
    if (diff < slot.diffMin || diff > slot.diffMax) return false;
    if (slot.problemType && candidate.problemType !== slot.problemType)
      return false;
    return true;
  }

  private pickBestForSlot(
    slot: Slot,
    pool: CandidateProblem[],
    usedIds: Set<string>,
    selected: CandidateProblem[],
  ): CandidateProblem | null {
    let best: CandidateProblem | null = null;
    let bestScore = -1;

    for (const c of pool) {
      if (usedIds.has(c.id)) continue;
      if (!this.matchesSlot(c, slot)) continue;

      const s = this.scoreCandidate(c, slot, selected);
      if (s > bestScore) {
        bestScore = s;
        best = c;
      }
    }

    return best;
  }

  // ── Relaxation ─────────────────────────────────────────────────────

  private pickWithRelaxation(
    slot: Slot,
    pool: CandidateProblem[],
    usedIds: Set<string>,
    selected: CandidateProblem[],
    relaxations: Relaxation[],
  ): CandidateProblem | null {
    // 1. Expand difficulty ±1
    const expandedSlot1: Slot = {
      ...slot,
      diffMin: slot.diffMin - 1,
      diffMax: slot.diffMax + 1,
    };
    let pick = this.pickBestForSlot(expandedSlot1, pool, usedIds, selected);
    if (pick) {
      relaxations.push({
        slot: slot.index,
        type: "expand_difficulty",
        from: `${slot.diffMin}-${slot.diffMax}`,
        to: `${expandedSlot1.diffMin}-${expandedSlot1.diffMax}`,
      });
      return pick;
    }

    // 2. Expand unit scope: drop unitMajor, keep subject
    if (slot.unitMajor) {
      const expandedSlot2: Slot = {
        ...slot,
        unitMajor: undefined,
        diffMin: expandedSlot1.diffMin,
        diffMax: expandedSlot1.diffMax,
      };
      pick = this.pickBestForSlot(expandedSlot2, pool, usedIds, selected);
      if (pick) {
        relaxations.push({
          slot: slot.index,
          type: "expand_unit",
          from: `unitMajor:${slot.unitMajor}`,
          to: `subject:${slot.subject ?? "any"}`,
        });
        return pick;
      }
    }

    // 3. Drop subject too
    if (slot.subject) {
      const expandedSlot3: Slot = {
        ...slot,
        unitMajor: undefined,
        subject: undefined,
        diffMin: expandedSlot1.diffMin,
        diffMax: expandedSlot1.diffMax,
      };
      pick = this.pickBestForSlot(expandedSlot3, pool, usedIds, selected);
      if (pick) {
        relaxations.push({
          slot: slot.index,
          type: "expand_unit",
          from: `subject:${slot.subject}`,
          to: "any",
        });
        return pick;
      }
    }

    // 4. Relax type constraint
    if (slot.problemType) {
      const expandedSlot4: Slot = {
        ...slot,
        unitMajor: undefined,
        subject: undefined,
        problemType: undefined,
        diffMin: expandedSlot1.diffMin,
        diffMax: expandedSlot1.diffMax,
      };
      pick = this.pickBestForSlot(expandedSlot4, pool, usedIds, selected);
      if (pick) {
        relaxations.push({
          slot: slot.index,
          type: "relax_type",
          from: slot.problemType,
          to: "any",
        });
        return pick;
      }
    }

    return null;
  }

  // ── Swap refinement ────────────────────────────────────────────────

  private swapRefine(
    selected: CandidateProblem[],
    pool: CandidateProblem[],
    usedIds: Set<string>,
    slots: Slot[],
  ): void {
    const maxIterations = 100;

    for (let iter = 0; iter < maxIterations; iter++) {
      let improved = false;

      for (let si = 0; si < selected.length; si++) {
        const slot = slots[si];
        if (!slot) continue;

        const currentScore = this.scoreCandidate(
          selected[si],
          slot,
          selected,
        );

        for (const candidate of pool) {
          if (usedIds.has(candidate.id)) continue;

          const newScore = this.scoreCandidate(candidate, slot, selected);
          if (newScore > currentScore + 0.01) {
            // Swap
            usedIds.delete(selected[si].id);
            usedIds.add(candidate.id);
            selected[si] = candidate;
            improved = true;
            break;
          }
        }
      }

      if (!improved) break;
    }
  }

  // ── Overall match score ────────────────────────────────────────────

  private computeMatchScore(
    selected: CandidateProblem[],
    slots: Slot[],
  ): number {
    if (slots.length === 0) return 0;

    let total = 0;
    for (let i = 0; i < slots.length; i++) {
      if (i < selected.length) {
        // Score without jitter for deterministic result
        const c = selected[i];
        const slot = slots[i];
        let score = 0;

        // Unit match
        if (slot.unitMajor) {
          if (c.unitMajor === slot.unitMajor) score += 0.4;
          else if (slot.subject && c.subject === slot.subject) score += 0.2;
        } else if (slot.subject) {
          if (c.subject === slot.subject) score += 0.4;
        } else {
          score += 0.4;
        }

        // Difficulty
        const diff = c.difficulty ?? 3;
        if (diff >= slot.diffMin && diff <= slot.diffMax) score += 0.25;
        else {
          const dist = Math.min(
            Math.abs(diff - slot.diffMin),
            Math.abs(diff - slot.diffMax),
          );
          if (dist === 1) score += 0.15;
          else if (dist === 2) score += 0.05;
        }

        // Type
        if (!slot.problemType || c.problemType === slot.problemType)
          score += 0.2;

        // Source diversity (simplified: just give full marks in final score)
        score += 0.1;

        total += score;
      }
      // Unfilled slots contribute 0
    }

    // Penalize unfilled slots
    const fillRatio = Math.min(selected.length, slots.length) / slots.length;
    const avgFitScore =
      selected.length > 0 ? total / Math.min(selected.length, slots.length) : 0;

    return Math.round(fillRatio * avgFitScore * 100) / 100;
  }

  // ── Helpers ────────────────────────────────────────────────────────

  private async loadBlueprint(id: string): Promise<BlueprintData> {
    const bp = await this.prisma.examBlueprint.findUnique({ where: { id } });
    if (!bp) throw new NotFoundException("Blueprint not found");
    return bp as unknown as BlueprintData;
  }
}

/** Internal shape matching the Prisma ExamBlueprint row. */
interface BlueprintData {
  id: string;
  totalQuestions: number;
  gradeLevel: string | null;
  unitDistribution: UnitDistEntry[];
  difficultyDistribution: DiffDistEntry[];
  typeDistribution: TypeDistEntry[];
  excludeRecentDays: number | null;
  excludeProblemIds: string[] | null;
}
