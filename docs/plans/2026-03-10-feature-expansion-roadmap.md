# JSMath Feature Expansion Roadmap

## Date: 2026-03-10

## Context
Comprehensive research across 4 teams (codebase analysis, global LMS platforms, math question bank platforms, Korean market) identified gaps and opportunities for JSMath's next features.

## Design Decision: No Elasticsearch
Use existing pgvector (1536-dim OpenAI embeddings) + PostgreSQL tsvector for semantic and keyword search. Sufficient for <500K problems. Revisit if scale demands it.

---

## Phase 1 — Question Bank Enhancement (Foundation)
> All subsequent phases depend on this. Curriculum mapping and difficulty systems must be in place first.

| ID | Feature | Description | Size |
|---|---|---|---|
| 1-1 | 2022 Revised Curriculum Mapping | Dual curriculum tree DB (2015+2022), problem tag migration | M |
| 1-2 | 6-Level Difficulty Scale | Expand 1-5 to 6 levels (aligned with MathFlat), update AI analysis output | S |
| 1-3 | Past Exam Tagging | Suneung/mock exam source metadata (year, month, number, grade cut-off) | S |
| 1-4 | Semantic Problem Search | Natural language search UI using existing pgvector embeddings | M |
| 1-5 | Solution Strategy Tagging | Tag problems by solving technique (substitution, proof by contradiction, graph-based, etc.) | M |

## Phase 2 — Student Learning Experience (Core Differentiator)
> Makes students actually want to use the platform.

| ID | Feature | Description | Size |
|---|---|---|---|
| 2-1 | Automated Wrong Answer Notebook | Auto-collect wrong answers, classify error type (concept/pattern/calculation), generate review worksheets | L |
| 2-2 | Mastery-Based Progression | Consecutive-correct conditions, per-concept mastery state tracking, progress lock/unlock | L |
| 2-3 | Step-by-Step Solution Display | Per-problem solution steps with LaTeX rendering, multiple solution methods | M |
| 2-4 | Auto-Generated Remediation Assignments | After tests, auto-generate personalized assignments from missed problem types | M |
| 2-5 | Spaced Repetition | Schedule re-testing of wrong answers using FIRe/FSRS algorithms | M |

## Phase 3 — AI Enhancement + Analytics
> Leverage accumulated data for AI-powered insights.

| ID | Feature | Description | Size |
|---|---|---|---|
| 3-1 | Adaptive Diagnostic Assessment | 10-min diagnostic test, IRT/BKT-based student level measurement | L |
| 3-2 | Knowledge Graph Weakness Analysis | Prerequisite DAG: "fails integration ← lacks trig identities ← unit circle gap" | L |
| 3-3 | Socratic AI Tutor | Hints and guiding questions (never answers), misconception detection | L |
| 3-4 | SmartScore Grading | Consistency/difficulty-weighted scoring, anti-guessing | M |
| 3-5 | AI Problem Variant Generation | Extend twin-problem feature → parametric variants with difficulty control | M |
| 3-6 | AI Written Response Partial Credit | Analyze solution process → auto-generate rubric → assign partial credit | L |

## Phase 4 — Operations & Expansion
> Full hagwon market penetration + ecosystem growth.

| ID | Feature | Description | Size |
|---|---|---|---|
| 4-1 | Enhanced Parent Dashboard | Weekly reports, weakness heatmaps, attendance/homework rates, score trends | M |
| 4-2 | Grade Cut-off / Score Prediction | Mock exam → Suneung grade conversion, trend-based projected grade | M |
| 4-3 | Gamification | Streaks, points, badges, class leaderboards | M |
| 4-4 | Real-time Class Monitoring | Live student progress dashboard during class/study sessions | M |
| 4-5 | Hagwon Operations Management | Attendance + parent alerts, billing, per-class integrated dashboard | L |
| 4-6 | LTI/QTI Standard Integration | External LMS compatibility, problem import/export standardization | M |

---

## Competitive Positioning

| JSMath Advantage | Why |
|---|---|
| OCR-first problem ingestion | Competitors require manual entry or publisher deals; JSMath scans any textbook |
| Exam builder + LaTeX PDF | Print-quality PDF generation — core hagwon teacher workflow |
| OCR + Question Bank + LMS integrated | Qanda = OCR only, MathFlat = question bank only, Classting = LMS only |
| Dual curriculum transition support | 2025-2028 confusion period: both 2015 and 2022 curriculum simultaneously |

## Research Sources
- Global LMS: Canvas, Google Classroom, Moodle, Schoology, DeltaMath, IXL, Khan Academy, Brilliant.org, Photomath
- Korean Market: MathFlat, Qanda, EBS AI DANCHOO+, Zocbo.com, Classting, Math King
- Question Bank: ALEKS (KST), IRT/BKT algorithms, RefGrader, MATH-squared, FIRe/FSRS
