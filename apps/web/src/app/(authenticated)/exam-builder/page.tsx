"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import {
  FileText,
  Search,
  Plus,
  X,
  Download,
  Loader2,
  ChevronLeft,
  ChevronRight,
  History,
  BookOpen,
  ClipboardList,
  Check,
  Eye,
  Sparkles,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import { LatexRenderer } from "@/components/math/latex-renderer";
import { resolveProblemChoices } from "@/components/exam-builder/choice-utils";
import {
  ExamBuilderProblemChoices,
  type ExamBuilderProblem as Problem,
} from "@/components/exam-builder/problem-preview-content";
import { buildProblemPreview } from "@/lib/problem-preview";
import {
  ExamPreviewPanel,
  type ExamPreviewLayoutPlan,
} from "@/components/exam-builder/exam-preview-panel";
import { BlueprintMode } from "@/components/exam-builder/blueprint-mode";
import { WorkbookCoverEditor } from "@/components/exam-builder/workbook-cover-editor";
import {
  getCoverPalette,
  resetCoverLayerPositions,
  type CoverLayoutStyle,
} from "@/components/exam-builder/workbook-cover";
import Link from "next/link";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FilterOptions {
  subjects: string[];
  gradeLevels: string[];
  textbooks: { filename: string; bookTitle: string | null }[];
  difficulties: number[];
  problemTypes: string[];
}

interface PaginatedResponse {
  data: Problem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

interface ExamDocument {
  id: string;
  title: string;
  type: string;
  status: string;
  pdfS3Key: string | null;
  answerPdfS3Key: string | null;
  errorMessage: string | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROBLEM_TYPE_LABELS: Record<string, string> = {
  multiple_choice: "객관식",
  short_answer: "주관식",
  essay: "서술형",
  true_false: "O/X",
};

const PAGE_SIZE = 20;

function difficultyLabel(d: number | null): string | null {
  if (d === null) return null;
  if (d <= 2) return "하";
  if (d <= 4) return "중";
  return "상";
}

function difficultyColor(d: number | null): string {
  if (d === null) return "";
  if (d <= 2) return "bg-green-900/30 text-green-400";
  if (d <= 4) return "bg-yellow-900/30 text-yellow-400";
  return "bg-red-900/30 text-red-400";
}

// ---------------------------------------------------------------------------
// Main page component
// ---------------------------------------------------------------------------

export default function ExamBuilderPage() {
  const [step, setStep] = useState(1);

  // Step 1 — settings
  const [docType, setDocType] = useState<"exam" | "workbook">("exam");
  const [title, setTitle] = useState("");
  // exam fields
  const [schoolName, setSchoolName] = useState("");
  const [examDate, setExamDate] = useState("");
  const [duration, setDuration] = useState<string>("");
  const [showNameField, setShowNameField] = useState(true);
  // workbook fields
  const [coverTitle, setCoverTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [author, setAuthor] = useState("");
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [coverPaletteId, setCoverPaletteId] = useState("paper");
  const [coverLayoutStyle, setCoverLayoutStyle] =
    useState<CoverLayoutStyle>("editorial");
  const [coverPositions, setCoverPositions] = useState(resetCoverLayerPositions);
  // common
  const [problemsPerPage, setProblemsPerPage] = useState(4);

  // Step 2 — problem selection
  const [selectionMode, setSelectionMode] = useState<"manual" | "blueprint">("manual");
  const [selectedProblems, setSelectedProblems] = useState<Problem[]>([]);
  const [previewLayoutPlan, setPreviewLayoutPlan] =
    useState<ExamPreviewLayoutPlan | null>(null);
  const [searchPage, setSearchPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [subjectFilter, setSubjectFilter] = useState("");
  const [gradeLevelFilter, setGradeLevelFilter] = useState("");
  const [difficultyFilter, setDifficultyFilter] = useState("");
  const [bookTitleFilter, setBookTitleFilter] = useState("");

  // Step 3 — generation
  const [includeAnswers, setIncludeAnswers] = useState(true);
  const [visibility, setVisibility] = useState<"private" | "public">("private");
  const [generating, setGenerating] = useState(false);
  const [examDoc, setExamDoc] = useState<ExamDocument | null>(null);
  const [genError, setGenError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Problem preview modal
  const [previewProblem, setPreviewProblem] = useState<Problem | null>(null);
  const previewProblemContent = previewProblem
    ? resolveProblemChoices(previewProblem)
    : null;

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // Fetch filter options
  const { data: filterOptions } = useQuery({
    queryKey: ["problem-filter-options"],
    queryFn: () => api.get<FilterOptions>("/problems/filter-options"),
  });

  // Fetch problems for step 2
  const queryString = [
    `page=${searchPage}`,
    `limit=${PAGE_SIZE}`,
    searchQuery && `q=${encodeURIComponent(searchQuery)}`,
    subjectFilter && `subject=${encodeURIComponent(subjectFilter)}`,
    gradeLevelFilter &&
      `gradeLevel=${encodeURIComponent(gradeLevelFilter)}`,
    difficultyFilter && `difficulty=${difficultyFilter}`,
    bookTitleFilter && `bookTitle=${encodeURIComponent(bookTitleFilter)}`,
  ]
    .filter(Boolean)
    .join("&");

  const { data: problemsData, isLoading: problemsLoading } = useQuery({
    queryKey: [
      "exam-builder-problems",
      searchPage,
      searchQuery,
      subjectFilter,
      gradeLevelFilter,
      difficultyFilter,
      bookTitleFilter,
    ],
    queryFn: () => api.get<PaginatedResponse>(`/problems?${queryString}`),
    enabled: step === 2,
  });

  const problems = problemsData?.data ?? [];
  const totalPages = problemsData?.totalPages ?? 0;

  const addProblem = useCallback((problem: Problem) => {
    setSelectedProblems((prev) => {
      if (prev.some((p) => p.id === problem.id)) return prev;
      return [...prev, problem];
    });
  }, []);

  const removeProblem = useCallback((id: string) => {
    setSelectedProblems((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearchQuery(searchInput);
    setSearchPage(1);
  };

  // Step 3 — generate
  const handleGenerate = async () => {
    setGenerating(true);
    setGenError(null);
    setExamDoc(null);

    try {
      const activeCoverPalette = getCoverPalette(coverPaletteId);
      const payload = {
        title,
        type: docType,
        visibility,
        problemIds: selectedProblems.map((p) => p.id),
        generateAnswerSheet: includeAnswers,
        headerConfig: {
          title,
          ...(docType === "exam"
            ? {
                schoolName: schoolName || undefined,
                date: examDate || undefined,
                duration: duration ? Number(duration) : undefined,
              }
            : {}),
        },
        layoutConfig: {
          problemsPerPage,
          previewPlan: previewLayoutPlan ?? undefined,
          showNameField: docType === "exam" ? showNameField : false,
        },
        ...(docType === "workbook"
          ? {
              coverConfig: {
                title: coverTitle || title,
                subtitle: subtitle || undefined,
                author: author || undefined,
                year: year || String(new Date().getFullYear()),
                backgroundColor: activeCoverPalette.background,
                accentColor: activeCoverPalette.accent,
                textColor: activeCoverPalette.text,
                mutedTextColor: activeCoverPalette.mutedText,
                paletteId: coverPaletteId,
                style: coverLayoutStyle,
                elements: coverPositions,
              },
            }
          : {}),
      };

      const doc = await api.post<ExamDocument>("/exam-documents", payload);
      setExamDoc(doc);

      // Poll for completion
      if (doc.status === "generating") {
        pollRef.current = setInterval(async () => {
          try {
            const updated = await api.get<ExamDocument>(
              `/exam-documents/${doc.id}`,
            );
            setExamDoc(updated);
            if (updated.status !== "generating") {
              if (pollRef.current) clearInterval(pollRef.current);
              pollRef.current = null;
              setGenerating(false);
            }
          } catch {
            if (pollRef.current) clearInterval(pollRef.current);
            pollRef.current = null;
            setGenerating(false);
            setGenError("상태 확인 중 오류가 발생했습니다.");
          }
        }, 2000);
      } else {
        setGenerating(false);
      }
    } catch (err) {
      setGenerating(false);
      setGenError(
        err instanceof Error ? err.message : "생성 중 오류가 발생했습니다.",
      );
    }
  };

  const handleDownload = async (type: "pdf" | "answer") => {
    if (!examDoc) return;
    const result = await api.get<{ url: string }>(
      `/exam-documents/${examDoc.id}/download?type=${type}`,
    );
    window.open(result.url, "_blank");
  };

  // ---------------------------------------------------------------------------
  // Step indicator
  // ---------------------------------------------------------------------------

  const stepLabels = ["기본 설정", "문제 선택", "검토 및 생성"];

  const StepIndicator = () => (
    <div className="mb-8 flex items-center justify-center gap-2">
      {stepLabels.map((label, i) => {
        const stepNum = i + 1;
        const isActive = step === stepNum;
        const isCompleted = step > stepNum;
        return (
          <div key={stepNum} className="flex items-center gap-2">
            {i > 0 && (
              <div
                className={`h-px w-8 ${isCompleted ? "bg-brand-beige" : "bg-border"}`}
              />
            )}
            <div className="flex items-center gap-2">
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold ${
                  isActive
                    ? "bg-brand-beige text-brand-dark"
                    : isCompleted
                      ? "bg-brand-beige/20 text-brand-beige"
                      : "bg-brand-charcoal text-muted-foreground"
                }`}
              >
                {isCompleted ? <Check className="h-4 w-4" /> : stepNum}
              </div>
              <span
                className={`hidden text-sm sm:inline ${
                  isActive
                    ? "font-medium text-foreground"
                    : "text-muted-foreground"
                }`}
              >
                {label}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">시험지 제작</h1>
        <p className="text-muted-foreground">
          문제를 선택하고 시험지 또는 교재를 PDF로 생성합니다.
        </p>
      </div>

      <StepIndicator />

      {/* ================================================================= */}
      {/* STEP 1 — Basic Settings                                           */}
      {/* ================================================================= */}
      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle>기본 설정</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Document type toggle */}
            <div>
              <label className="mb-2 block text-sm font-medium">
                문서 유형
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setDocType("exam")}
                  className={`flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors ${
                    docType === "exam"
                      ? "border-brand-beige bg-brand-beige/10 text-brand-beige"
                      : "border-border bg-brand-charcoal text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <ClipboardList className="h-4 w-4" />
                  시험지
                </button>
                <button
                  type="button"
                  onClick={() => setDocType("workbook")}
                  className={`flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors ${
                    docType === "workbook"
                      ? "border-brand-beige bg-brand-beige/10 text-brand-beige"
                      : "border-border bg-brand-charcoal text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <BookOpen className="h-4 w-4" />
                  교재
                </button>
              </div>
            </div>

            {/* Title */}
            <div>
              <label className="mb-2 block text-sm font-medium">
                제목 <span className="text-red-400">*</span>
              </label>
              <Input
                placeholder={
                  docType === "exam"
                    ? "예: 2026학년도 1학기 중간고사"
                    : "예: 미적분 실전 문제집"
                }
                className="bg-brand-charcoal border-transparent"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>

            {/* Exam-specific fields */}
            {docType === "exam" && (
              <div className="space-y-4 rounded-lg border border-border p-4">
                <p className="text-sm font-medium text-muted-foreground">
                  시험지 옵션
                </p>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-sm text-muted-foreground">
                      학교명
                    </label>
                    <Input
                      placeholder="선택 사항"
                      className="bg-brand-dark border-transparent"
                      value={schoolName}
                      onChange={(e) => setSchoolName(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm text-muted-foreground">
                      시험 일자
                    </label>
                    <Input
                      placeholder="예: 2026.04.15"
                      className="bg-brand-dark border-transparent"
                      value={examDate}
                      onChange={(e) => setExamDate(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm text-muted-foreground">
                      시험 시간 (분)
                    </label>
                    <Input
                      type="number"
                      placeholder="예: 60"
                      className="bg-brand-dark border-transparent"
                      value={duration}
                      onChange={(e) => setDuration(e.target.value)}
                    />
                  </div>
                  <div className="flex items-end">
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={showNameField}
                        onChange={(e) => setShowNameField(e.target.checked)}
                        className="rounded border-border"
                      />
                      이름 기입란 표시
                    </label>
                  </div>
                </div>
              </div>
            )}

            {/* Workbook-specific fields */}
            {docType === "workbook" && (
              <div className="space-y-4 rounded-lg border border-border p-4">
                <p className="text-sm font-medium text-muted-foreground">
                  표지 설정
                </p>
                <div className="grid gap-6 xl:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-sm text-muted-foreground">
                        표지 제목
                      </label>
                      <Input
                        placeholder={title || "문서 제목과 동일"}
                        className="bg-brand-dark border-transparent"
                        value={coverTitle}
                        onChange={(e) => setCoverTitle(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm text-muted-foreground">
                        부제목
                      </label>
                      <Input
                        placeholder="선택 사항"
                        className="bg-brand-dark border-transparent"
                        value={subtitle}
                        onChange={(e) => setSubtitle(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm text-muted-foreground">
                        저자
                      </label>
                      <Input
                        placeholder="선택 사항"
                        className="bg-brand-dark border-transparent"
                        value={author}
                        onChange={(e) => setAuthor(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm text-muted-foreground">
                        연도
                      </label>
                      <Input
                        placeholder={String(new Date().getFullYear())}
                        className="bg-brand-dark border-transparent"
                        value={year}
                        onChange={(e) => setYear(e.target.value)}
                      />
                    </div>
                    <div className="sm:col-span-2 rounded-xl border border-border/70 bg-background/40 p-3 text-sm text-muted-foreground">
                      표지 미리보기 안에서 제목, 부제목, 저자, 연도 블록을 직접 드래그해서 위치를 조정할 수 있습니다.
                    </div>
                  </div>

                  <WorkbookCoverEditor
                    author={author}
                    fallbackTitle={title || "교재 제목"}
                    onPaletteChange={setCoverPaletteId}
                    onPositionsChange={setCoverPositions}
                    onStyleChange={setCoverLayoutStyle}
                    paletteId={coverPaletteId}
                    positions={coverPositions}
                    styleId={coverLayoutStyle}
                    subtitle={subtitle}
                    title={coverTitle}
                    year={year}
                  />
                </div>
              </div>
            )}

            {/* Problems per page */}
            <div>
              <label className="mb-2 block text-sm font-medium">
                페이지당 문제 수
              </label>
              <select
                className="rounded-md bg-brand-charcoal border border-transparent px-3 py-2 text-sm text-foreground"
                value={problemsPerPage}
                onChange={(e) => setProblemsPerPage(Number(e.target.value))}
              >
                {[2, 3, 4, 5, 6].map((n) => (
                  <option key={n} value={n}>
                    {n}문제
                  </option>
                ))}
              </select>
            </div>

            {/* Next */}
            <div className="flex justify-end">
              <Button
                onClick={() => setStep(2)}
                disabled={!title.trim()}
              >
                다음
                <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ================================================================= */}
      {/* STEP 2 — Problem Selection                                        */}
      {/* ================================================================= */}
      {step === 2 && (
        <>
          {/* Mode toggle */}
          <div className="flex gap-1 rounded-lg bg-muted p-1">
            <button
              className={`flex items-center gap-1.5 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                selectionMode === "manual"
                  ? "bg-background shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setSelectionMode("manual")}
            >
              <Search className="h-3.5 w-3.5" />
              수동 선택
            </button>
            <button
              className={`flex items-center gap-1.5 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                selectionMode === "blueprint"
                  ? "bg-background shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setSelectionMode("blueprint")}
            >
              <Sparkles className="h-3.5 w-3.5" />
              블루프린트 모드
            </button>
          </div>

          {/* Blueprint mode */}
          {selectionMode === "blueprint" && (
            <>
              <BlueprintMode
                filterOptions={filterOptions}
                onAccept={(problems) => {
                  setSelectedProblems(problems);
                  setStep(3);
                }}
              />
              {/* Navigation */}
              <div className="flex items-center justify-between">
                <Button variant="ghost" onClick={() => setStep(1)}>
                  <ChevronLeft className="mr-1 h-4 w-4" />
                  이전
                </Button>
                <Button
                  onClick={() => setStep(3)}
                  disabled={selectedProblems.length === 0}
                >
                  다음
                  <ChevronRight className="ml-1 h-4 w-4" />
                </Button>
              </div>
            </>
          )}

          {/* Manual selection mode */}
          {selectionMode === "manual" && (<>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* Left — Search */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Search className="h-4 w-4" />
                  문제 검색
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Filters */}
                <div className="flex flex-wrap items-center gap-2">
                  {filterOptions?.subjects &&
                    filterOptions.subjects.length > 0 && (
                      <select
                        className="rounded-md bg-brand-dark border border-transparent px-2 py-1.5 text-xs text-foreground"
                        value={subjectFilter}
                        onChange={(e) => {
                          setSubjectFilter(e.target.value);
                          setSearchPage(1);
                        }}
                      >
                        <option value="">과목 전체</option>
                        {filterOptions.subjects.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    )}

                  {filterOptions?.gradeLevels &&
                    filterOptions.gradeLevels.length > 0 && (
                      <select
                        className="rounded-md bg-brand-dark border border-transparent px-2 py-1.5 text-xs text-foreground"
                        value={gradeLevelFilter}
                        onChange={(e) => {
                          setGradeLevelFilter(e.target.value);
                          setSearchPage(1);
                        }}
                      >
                        <option value="">학년 전체</option>
                        {filterOptions.gradeLevels.map((g) => (
                          <option key={g} value={g}>
                            {g}
                          </option>
                        ))}
                      </select>
                    )}

                  {filterOptions?.difficulties &&
                    filterOptions.difficulties.length > 0 && (
                      <select
                        className="rounded-md bg-brand-dark border border-transparent px-2 py-1.5 text-xs text-foreground"
                        value={difficultyFilter}
                        onChange={(e) => {
                          setDifficultyFilter(e.target.value);
                          setSearchPage(1);
                        }}
                      >
                        <option value="">난이도 전체</option>
                        {filterOptions.difficulties.map((d) => (
                          <option key={d} value={String(d)}>
                            {d <= 2
                              ? `${d} (하)`
                              : d <= 4
                                ? `${d} (중)`
                                : `${d} (상)`}
                          </option>
                        ))}
                      </select>
                    )}

                  {filterOptions?.textbooks &&
                    filterOptions.textbooks.length > 0 && (
                      <select
                        className="rounded-md bg-brand-dark border border-transparent px-2 py-1.5 text-xs text-foreground"
                        value={bookTitleFilter}
                        onChange={(e) => {
                          setBookTitleFilter(e.target.value);
                          setSearchPage(1);
                        }}
                      >
                        <option value="">교재 전체</option>
                        {filterOptions.textbooks.map((t) => (
                          <option
                            key={t.filename}
                            value={t.bookTitle || t.filename}
                          >
                            {t.bookTitle || t.filename}
                          </option>
                        ))}
                      </select>
                    )}
                </div>

                {/* Search bar */}
                <form onSubmit={handleSearch} className="flex gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      placeholder="문제 내용 검색..."
                      className="pl-9 bg-brand-dark border-transparent"
                      value={searchInput}
                      onChange={(e) => setSearchInput(e.target.value)}
                    />
                  </div>
                  <Button type="submit" variant="secondary" size="sm">
                    검색
                  </Button>
                </form>

                {/* Problem list */}
                {problemsLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : problems.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                    <FileText className="mb-2 h-8 w-8" />
                    <p className="text-sm">검색 결과가 없습니다</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {problems.map((problem) => {
                      const isSelected = selectedProblems.some(
                        (p) => p.id === problem.id,
                      );
                      const preview = buildProblemPreview(problem, 100);
                      const typeLabel =
                        PROBLEM_TYPE_LABELS[problem.problemType] ??
                        problem.problemType;
                      const diffLabel = difficultyLabel(problem.difficulty);

                      return (
                        <div
                          key={problem.id}
                          className={`flex items-center gap-3 rounded-lg border p-3 transition-colors ${
                            isSelected
                              ? "border-brand-beige/30 bg-brand-beige/5"
                              : "border-border bg-brand-dark hover:border-brand-beige/20"
                          }`}
                        >
                          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-brand-charcoal text-xs font-bold text-brand-beige">
                            {problem.displayNumber ||
                              problem.problemNumber ||
                              "#"}
                          </div>
                          <button
                            type="button"
                            className="min-w-0 flex-1 text-left"
                            onClick={() => setPreviewProblem(problem)}
                          >
                            <p className="truncate text-sm">{preview}</p>
                            <div className="mt-0.5 flex items-center gap-1.5">
                              <Badge
                                variant="outline"
                                className="text-[10px] px-1.5 py-0"
                              >
                                {typeLabel}
                              </Badge>
                              {diffLabel && (
                                <span
                                  className={`rounded-full px-1.5 py-0 text-[10px] font-medium ${difficultyColor(problem.difficulty)}`}
                                >
                                  {diffLabel}
                                </span>
                              )}
                            </div>
                          </button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="shrink-0 h-7 w-7 p-0"
                            onClick={() => setPreviewProblem(problem)}
                            title="미리보기"
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant={isSelected ? "secondary" : "default"}
                            size="sm"
                            className="shrink-0 h-7 px-2 text-xs"
                            onClick={() => addProblem(problem)}
                            disabled={isSelected}
                          >
                            {isSelected ? (
                              <>
                                <Check className="mr-1 h-3 w-3" />
                                추가됨
                              </>
                            ) : (
                              <>
                                <Plus className="mr-1 h-3 w-3" />
                                추가
                              </>
                            )}
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-center gap-3 pt-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setSearchPage((p) => Math.max(1, p - 1))
                      }
                      disabled={searchPage === 1}
                    >
                      <ChevronLeft className="h-4 w-4" />
                      이전
                    </Button>
                    <span className="text-xs text-muted-foreground">
                      {searchPage} / {totalPages}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setSearchPage((p) => Math.min(totalPages, p + 1))
                      }
                      disabled={searchPage === totalPages}
                    >
                      다음
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Right — PDF-style preview with pagination & DnD */}
            <div className="space-y-3">
              <h3 className="text-sm font-medium">
                미리보기 ({selectedProblems.length}개)
              </h3>
              <ExamPreviewPanel
                selectedProblems={selectedProblems}
                problemsPerPage={problemsPerPage}
                title={title || "제목 없음"}
                docType={docType}
                schoolName={schoolName}
                examDate={examDate}
                duration={duration}
                showNameField={docType === "exam" && showNameField}
                onLayoutChange={setPreviewLayoutPlan}
                onReorder={setSelectedProblems}
                onRemove={removeProblem}
              />
            </div>
          </div>

          {/* Navigation */}
          <div className="flex items-center justify-between">
            <Button variant="ghost" onClick={() => setStep(1)}>
              <ChevronLeft className="mr-1 h-4 w-4" />
              이전
            </Button>
            <Button
              onClick={() => setStep(3)}
              disabled={selectedProblems.length === 0}
            >
              다음
              <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          </div>
          </>)}
        </>
      )}

      {/* ================================================================= */}
      {/* STEP 3 — Review & Generate                                        */}
      {/* ================================================================= */}
      {step === 3 && (
        <div className="space-y-6">
          {/* Settings summary */}
          <Card>
            <CardHeader>
              <CardTitle>설정 요약</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
                <div>
                  <span className="text-muted-foreground">유형</span>
                  <p className="font-medium">
                    {docType === "exam" ? "시험지" : "교재"}
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground">제목</span>
                  <p className="font-medium">{title}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">문제 수</span>
                  <p className="font-medium">{selectedProblems.length}개</p>
                </div>
                <div>
                  <span className="text-muted-foreground">
                    페이지당 문제
                  </span>
                  <p className="font-medium">{problemsPerPage}문제</p>
                </div>
                {docType === "exam" && schoolName && (
                  <div>
                    <span className="text-muted-foreground">학교</span>
                    <p className="font-medium">{schoolName}</p>
                  </div>
                )}
                {docType === "exam" && examDate && (
                  <div>
                    <span className="text-muted-foreground">시험일</span>
                    <p className="font-medium">{examDate}</p>
                  </div>
                )}
                {docType === "exam" && duration && (
                  <div>
                    <span className="text-muted-foreground">시험 시간</span>
                    <p className="font-medium">{duration}분</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Selected problems list */}
          <Card>
            <CardHeader>
              <CardTitle>
                문제 목록 ({selectedProblems.length}개)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {selectedProblems.map((problem, index) => {
                  const preview = buildProblemPreview(problem, 100);
                  return (
                    <div
                      key={problem.id}
                      className="flex items-center gap-3 rounded-lg border border-border bg-brand-charcoal p-3"
                    >
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-brand-dark text-xs font-bold text-brand-beige">
                        {index + 1}
                      </div>
                      <p className="min-w-0 flex-1 truncate text-sm">
                        {preview || "문제"}
                      </p>
                      <Badge variant="outline" className="text-[10px]">
                        {PROBLEM_TYPE_LABELS[problem.problemType] ??
                          problem.problemType}
                      </Badge>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Generate options */}
          <Card>
            <CardHeader>
              <CardTitle>생성 옵션</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={includeAnswers}
                  onChange={(e) => setIncludeAnswers(e.target.checked)}
                  className="rounded border-border"
                />
                해설지 포함
              </label>

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={visibility === "public"}
                  onChange={(e) => setVisibility(e.target.checked ? "public" : "private")}
                  className="rounded border-border"
                />
                다른 선생님에게 공개
              </label>

              {/* Error message */}
              {genError && (
                <div className="rounded-lg border border-red-400/30 bg-red-900/20 p-3 text-sm text-red-400">
                  {genError}
                </div>
              )}

              {/* Status / download */}
              {examDoc && examDoc.status === "completed" && (
                <div className="rounded-lg border border-green-400/30 bg-green-900/20 p-4">
                  <p className="mb-3 text-sm font-medium text-green-400">
                    PDF 생성 완료
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {examDoc.pdfS3Key && (
                      <Button
                        size="sm"
                        onClick={() => handleDownload("pdf")}
                      >
                        <Download className="mr-1 h-4 w-4" />
                        {docType === "exam"
                          ? "시험지 다운로드"
                          : "교재 다운로드"}
                      </Button>
                    )}
                    {includeAnswers && examDoc.answerPdfS3Key && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => handleDownload("answer")}
                      >
                        <Download className="mr-1 h-4 w-4" />
                        해설지 다운로드
                      </Button>
                    )}
                  </div>
                </div>
              )}

              {examDoc && examDoc.status === "failed" && (
                <div className="rounded-lg border border-red-400/30 bg-red-900/20 p-4">
                  <p className="mb-2 text-sm font-medium text-red-400">
                    생성 실패
                  </p>
                  <p className="mb-3 text-xs text-red-300">
                    {examDoc.errorMessage || "알 수 없는 오류"}
                  </p>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={handleGenerate}
                  >
                    재생성
                  </Button>
                </div>
              )}

              {/* Generate button */}
              {(!examDoc || examDoc.status === "failed") && (
                <Button
                  size="lg"
                  className="w-full"
                  onClick={handleGenerate}
                  disabled={generating}
                >
                  {generating ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      생성 중...
                    </>
                  ) : (
                    <>
                      <FileText className="mr-2 h-4 w-4" />
                      PDF 생성
                    </>
                  )}
                </Button>
              )}

              {examDoc && examDoc.status === "generating" && (
                <div className="flex items-center justify-center gap-2 py-4 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  PDF 생성 중입니다...
                </div>
              )}
            </CardContent>
          </Card>

          {/* Navigation */}
          <div className="flex items-center justify-between">
            <Button variant="ghost" onClick={() => setStep(2)}>
              <ChevronLeft className="mr-1 h-4 w-4" />
              이전
            </Button>
            <Link href="/exam-builder/history">
              <Button variant="secondary">
                <History className="mr-1 h-4 w-4" />
                제작 내역
              </Button>
            </Link>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* Problem Preview Modal                                              */}
      {/* ================================================================= */}
      {previewProblem && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setPreviewProblem(null)}
        >
          <div
            className="relative max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-border bg-brand-dark p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close button */}
            <button
              type="button"
              onClick={() => setPreviewProblem(null)}
              className="absolute right-4 top-4 rounded-md p-1 text-muted-foreground hover:bg-brand-charcoal hover:text-foreground"
            >
              <X className="h-5 w-5" />
            </button>

            {/* Header */}
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-charcoal text-sm font-bold text-brand-beige">
                {previewProblem.displayNumber || previewProblem.problemNumber || "#"}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs">
                    {PROBLEM_TYPE_LABELS[previewProblem.problemType] ?? previewProblem.problemType}
                  </Badge>
                  {previewProblem.difficulty !== null && (
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${difficultyColor(previewProblem.difficulty)}`}>
                      {difficultyLabel(previewProblem.difficulty)}
                    </span>
                  )}
                </div>
                <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                  {previewProblem.subject && <span>{previewProblem.subject}</span>}
                  {previewProblem.unitMajor && (
                    <>
                      <span>&middot;</span>
                      <span>{previewProblem.unitMajor}</span>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Problem content with LaTeX rendering */}
            <div className="rounded-lg border border-border bg-brand-charcoal p-4">
              <LatexRenderer content={previewProblemContent?.stemContent ?? ""} />
            </div>

            {/* Choices */}
            {previewProblemContent && previewProblemContent.choices.length > 0 && (
              <div className="mt-4 space-y-2">
                <p className="text-sm font-medium text-muted-foreground">보기</p>
                <ExamBuilderProblemChoices
                  choices={previewProblemContent.choices}
                  layout={previewProblemContent.choiceLayout}
                  variant="modal"
                />
              </div>
            )}

            {/* Add button */}
            <div className="mt-6 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setPreviewProblem(null)}>
                닫기
              </Button>
              {!selectedProblems.some((p) => p.id === previewProblem.id) ? (
                <Button
                  onClick={() => {
                    addProblem(previewProblem);
                    setPreviewProblem(null);
                  }}
                >
                  <Plus className="mr-1 h-4 w-4" />
                  문제 추가
                </Button>
              ) : (
                <Button variant="secondary" disabled>
                  <Check className="mr-1 h-4 w-4" />
                  추가됨
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
