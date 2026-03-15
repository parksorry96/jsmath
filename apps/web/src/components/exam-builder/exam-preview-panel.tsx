"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ChevronLeft,
  ChevronRight,
  FileText,
  GripVertical,
  X,
} from "lucide-react";
import {
  getPreviewLayoutConfig,
  paginatePreviewProblems,
} from "@/components/exam-builder/exam-preview-layout";
import { resolveProblemChoices } from "@/components/exam-builder/choice-utils";
import { LatexRenderer } from "@/components/math/latex-renderer";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Problem {
  id: string;
  displayNumber: string | null;
  problemNumber: string | null;
  stemText: string;
  stemLatex: string;
  problemType: string;
  difficulty: number | null;
  subject: string | null;
  unitMajor: string | null;
  choices?: {
    label: string;
    contentLatex: string;
    contentText: string;
    position: number;
  }[];
  answerText?: string | null;
}

export interface ExamPreviewPanelProps {
  selectedProblems: Problem[];
  problemsPerPage: number;
  title: string;
  docType: "exam" | "workbook";
  schoolName: string;
  examDate: string;
  duration: string;
  showNameField: boolean;
  onReorder: (problems: Problem[]) => void;
  onLayoutChange?: (layout: ExamPreviewLayoutPlan | null) => void;
  onRemove?: (id: string) => void;
}

export interface ExamPreviewLayoutPlanItem {
  globalIndex: number;
  problemId: string;
  span: number;
}

export interface ExamPreviewLayoutPlanColumn {
  items: ExamPreviewLayoutPlanItem[];
}

export interface ExamPreviewLayoutPlanPage {
  columns: ExamPreviewLayoutPlanColumn[];
}

export interface ExamPreviewLayoutPlan {
  columns: number;
  pages: ExamPreviewLayoutPlanPage[];
  rowsPerColumn: number;
}

const CIRCLED_NUMBERS = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩"];

function ProblemChoices({
  choices,
  layout,
}: {
  choices: ReturnType<typeof resolveProblemChoices>["choices"];
  layout: ReturnType<typeof resolveProblemChoices>["choiceLayout"];
}) {
  if (choices.length === 0) {
    return null;
  }

  if (layout === "spread") {
    return (
      <div className="mt-1 ml-3 grid grid-cols-5 gap-x-2 gap-y-1 text-[0.92em]">
        {choices.map((choice) => (
          <div key={`${choice.position}-${choice.label}`} className="flex min-w-0 items-baseline gap-1">
            <span className="shrink-0">{CIRCLED_NUMBERS[choice.position - 1] ?? `(${choice.position})`}</span>
            <LatexRenderer
              content={choice.contentLatex || choice.contentText}
              className="min-w-0 leading-snug"
            />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="mt-0.5 ml-3 flex flex-col gap-px">
      {choices.map((choice, idx) => (
        <div key={`${choice.position}-${choice.label}-${idx}`} className="flex gap-1 items-baseline">
          <span className="shrink-0">
            {CIRCLED_NUMBERS[idx] ?? `(${idx + 1})`}
          </span>
          <LatexRenderer
            content={choice.contentLatex || choice.contentText}
            className="min-w-0"
          />
        </div>
      ))}
    </div>
  );
}

function ProblemContent({
  problem,
  number,
  className,
}: {
  problem: Problem;
  number: number;
  className?: string;
}) {
  const resolvedProblem = resolveProblemChoices(problem);

  return (
    <div className={cn("w-full", className)}>
      <div className="flex gap-1">
        <span className="font-bold shrink-0">{number}.</span>
        <div className="min-w-0 flex-1">
          <LatexRenderer
            content={resolvedProblem.stemContent}
            className="leading-snug"
          />
        </div>
      </div>

      <ProblemChoices
        choices={resolvedProblem.choices}
        layout={resolvedProblem.choiceLayout}
      />
    </div>
  );
}

function PreviewHeader({
  docType,
  examDate,
  schoolName,
  showNameField,
  title,
  duration,
}: {
  docType: "exam" | "workbook";
  examDate: string;
  schoolName: string;
  showNameField: boolean;
  title: string;
  duration: string;
}) {
  return (
    <div className="px-4 pt-2.5 pb-1.5 border-b border-gray-400">
      <h1 className="text-[1.2em] font-bold text-center leading-tight">{title}</h1>
      {(schoolName || examDate || duration) && (
        <div className="flex items-center justify-between mt-1 text-[0.85em] text-gray-500">
          <div className="flex items-center gap-2">
            {schoolName && <span>{schoolName}</span>}
            {examDate && <span>{examDate}</span>}
          </div>
          {duration && <span>{duration}</span>}
        </div>
      )}
      {showNameField && (
        <div className="flex items-center gap-1 mt-1 text-[0.85em]">
          <span className="text-gray-500">
            {docType === "exam" ? "이름:" : "이름:"}
          </span>
          <div className="flex-1 border-b border-gray-400 min-w-[40px]" />
        </div>
      )}
    </div>
  );
}

function SortablePreviewProblem({
  problem,
  globalIndex,
  onRemove,
}: {
  problem: Problem;
  globalIndex: number;
  onRemove?: () => void;
}) {
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: problem.id });

  const style: React.CSSProperties = {
    opacity: isDragging ? 0.4 : 1,
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn("group relative", isDragging && "z-10")}
    >
      <button
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        className="absolute -left-3 top-0 opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity cursor-grab active:cursor-grabbing"
        aria-label="Drag to reorder"
      >
        <GripVertical className="size-3 text-gray-400" />
      </button>

      {onRemove && (
        <button
          onClick={onRemove}
          className="absolute -right-3 top-0 opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity"
          aria-label="Remove problem"
        >
          <X className="size-2.5 text-red-400" />
        </button>
      )}

      <ProblemContent problem={problem} number={globalIndex + 1} />
    </div>
  );
}

function DragOverlayProblem({
  problem,
  globalIndex,
}: {
  problem: Problem;
  globalIndex: number;
}) {
  return (
    <div className="rounded bg-white/95 shadow-lg ring-1 ring-black/10 p-2 scale-[1.02] max-w-md text-[9px]">
      <ProblemContent
        problem={problem}
        number={globalIndex + 1}
        className="text-black"
      />
    </div>
  );
}

function PreviewColumn({
  items,
  onRemove,
  rowsPerColumn,
  className,
  setRenderedSlotRef,
}: {
  items: { globalIndex: number; problem: Problem; span: number }[];
  onRemove?: (id: string) => void;
  rowsPerColumn: number;
  className?: string;
  setRenderedSlotRef?: (
    id: string,
    key: "slot" | "content",
  ) => (node: HTMLDivElement | null) => void;
}) {
  const usedRows = items.reduce((sum, item) => sum + item.span, 0);
  const remainingRows = Math.max(0, rowsPerColumn - usedRows);

  return (
    <div className={cn("flex flex-col h-full min-h-0", className)}>
      {items.map((item, index) => (
        <div
          key={item.problem.id}
          ref={setRenderedSlotRef?.(item.problem.id, "slot")}
          className="min-h-0 flex flex-col"
          style={{ flexBasis: 0, flexGrow: item.span }}
        >
          <div ref={setRenderedSlotRef?.(item.problem.id, "content")}>
            <SortablePreviewProblem
              problem={item.problem}
              globalIndex={item.globalIndex}
              onRemove={onRemove ? () => onRemove(item.problem.id) : undefined}
            />
          </div>
          <div className="flex-1 min-h-[4px]" />
          {index < items.length - 1 && (
            <div className="border-b border-dashed border-gray-200 mt-0.5" />
          )}
        </div>
      ))}
      {remainingRows > 0 && (
        <div style={{ flexBasis: 0, flexGrow: remainingRows }} />
      )}
    </div>
  );
}

function areMeasurementsEqual(
  prev: Record<string, number>,
  next: Record<string, number>,
) {
  const prevKeys = Object.keys(prev);
  const nextKeys = Object.keys(next);

  if (prevKeys.length !== nextKeys.length) return false;

  return nextKeys.every((key) => prev[key] === next[key]);
}

function areMetricsEqual(
  prev: { contentWidth: number; firstPageHeight: number; regularPageHeight: number },
  next: { contentWidth: number; firstPageHeight: number; regularPageHeight: number },
) {
  return (
    prev.contentWidth === next.contentWidth &&
    prev.firstPageHeight === next.firstPageHeight &&
    prev.regularPageHeight === next.regularPageHeight
  );
}

function roundDimension(value: number) {
  return Math.max(0, Math.round(value));
}

export function ExamPreviewPanel({
  selectedProblems,
  problemsPerPage,
  title,
  docType,
  schoolName,
  examDate,
  duration,
  showNameField,
  onReorder,
  onLayoutChange,
  onRemove,
}: ExamPreviewPanelProps) {
  const [currentPage, setCurrentPage] = useState(1);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [pageMetrics, setPageMetrics] = useState({
    contentWidth: 0,
    firstPageHeight: 0,
    regularPageHeight: 0,
  });
  const [forcedSpans, setForcedSpans] = useState<Record<string, number>>({});
  const [problemHeights, setProblemHeights] = useState<Record<string, number>>({});

  const firstPageContentRef = useRef<HTMLDivElement | null>(null);
  const regularPageContentRef = useRef<HTMLDivElement | null>(null);
  const singleColumnProbeRef = useRef<HTMLDivElement | null>(null);
  const leftColumnProbeRef = useRef<HTMLDivElement | null>(null);
  const rightColumnProbeRef = useRef<HTMLDivElement | null>(null);
  const problemMeasureRefs = useRef(new Map<string, HTMLDivElement>());
  const renderedSlotRefs = useRef(
    new Map<string, { content: HTMLDivElement | null; slot: HTMLDivElement | null }>(),
  );

  const layout = useMemo(
    () => getPreviewLayoutConfig(problemsPerPage),
    [problemsPerPage],
  );

  const measurePageMetrics = useCallback(() => {
    const singleColumnWidth = singleColumnProbeRef.current?.clientWidth ?? 0;
    const leftColumnWidth = leftColumnProbeRef.current?.clientWidth ?? 0;
    const rightColumnWidth = rightColumnProbeRef.current?.clientWidth ?? 0;
    const twoColumnWidths = [leftColumnWidth, rightColumnWidth].filter(
      (width) => width > 0,
    );
    const contentWidth =
      layout.columns === 1
        ? singleColumnWidth
        : twoColumnWidths.length > 0
          ? Math.min(...twoColumnWidths)
          : 0;

    const next = {
      contentWidth: roundDimension(contentWidth),
      firstPageHeight: roundDimension(
        firstPageContentRef.current?.getBoundingClientRect().height ?? 0,
      ),
      regularPageHeight: roundDimension(
        regularPageContentRef.current?.getBoundingClientRect().height ?? 0,
      ),
    };

    setPageMetrics((prev) => (areMetricsEqual(prev, next) ? prev : next));
  }, [layout.columns]);

  const measureProblemHeights = useCallback(() => {
    if (!pageMetrics.contentWidth) return;

    const next: Record<string, number> = {};

    selectedProblems.forEach((problem) => {
      const node = problemMeasureRefs.current.get(problem.id);
      if (!node) return;
      next[problem.id] = roundDimension(node.getBoundingClientRect().height);
    });

    setProblemHeights((prev) => (areMeasurementsEqual(prev, next) ? prev : next));
  }, [pageMetrics.contentWidth, selectedProblems]);

  useLayoutEffect(() => {
    let frame = window.requestAnimationFrame(measurePageMetrics);
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            window.cancelAnimationFrame(frame);
            frame = window.requestAnimationFrame(measurePageMetrics);
          });

    [
      firstPageContentRef.current,
      regularPageContentRef.current,
      singleColumnProbeRef.current,
      leftColumnProbeRef.current,
      rightColumnProbeRef.current,
    ]
      .filter((node): node is HTMLDivElement => node !== null)
      .forEach((node) => observer?.observe(node));

    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [measurePageMetrics, layout.columns, layout.fontSize, title, schoolName, examDate, duration, showNameField]);

  useLayoutEffect(() => {
    if (!pageMetrics.contentWidth || selectedProblems.length === 0) return;

    let frame = window.requestAnimationFrame(measureProblemHeights);

    if (typeof document !== "undefined" && "fonts" in document) {
      void (document as Document & { fonts?: FontFaceSet }).fonts?.ready.then(() => {
        measurePageMetrics();
        measureProblemHeights();
      });
    }

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [
    measurePageMetrics,
    measureProblemHeights,
    pageMetrics.contentWidth,
    layout.fontSize,
    selectedProblems,
  ]);

  const previewPages = useMemo(
    () =>
      paginatePreviewProblems(selectedProblems, {
        firstPageHeight: pageMetrics.firstPageHeight,
        forcedSpans,
        layout,
        problemHeights,
        problemsPerPage,
        regularPageHeight: pageMetrics.regularPageHeight || pageMetrics.firstPageHeight,
      }),
    [selectedProblems, pageMetrics, forcedSpans, layout, problemHeights, problemsPerPage],
  );

  useEffect(() => {
    if (!onLayoutChange) {
      return;
    }

    if (selectedProblems.length === 0) {
      onLayoutChange(null);
      return;
    }

    onLayoutChange({
      columns: layout.columns,
      pages: previewPages.map((page) => ({
        columns: page.columns.map((column) => ({
          items: column.items.map((item) => ({
            globalIndex: item.globalIndex,
            problemId: item.problem.id,
            span: item.span,
          })),
        })),
      })),
      rowsPerColumn: layout.rowsPerColumn,
    });
  }, [layout.columns, layout.rowsPerColumn, onLayoutChange, previewPages, selectedProblems.length]);

  const totalPages = Math.max(1, previewPages.length);
  const safePage = Math.min(currentPage, totalPages);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const currentPreviewPage = previewPages[safePage - 1];

  useEffect(() => {
    setForcedSpans({});
  }, [selectedProblems, problemsPerPage, title, schoolName, examDate, duration, showNameField]);

  const allIds = useMemo(
    () => selectedProblems.map((problem) => problem.id),
    [selectedProblems],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveDragId(event.active.id as string);
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveDragId(null);
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const oldIndex = selectedProblems.findIndex((problem) => problem.id === active.id);
      const newIndex = selectedProblems.findIndex((problem) => problem.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return;

      onReorder(arrayMove(selectedProblems, oldIndex, newIndex));
    },
    [selectedProblems, onReorder],
  );

  const handleDragCancel = useCallback(() => {
    setActiveDragId(null);
  }, []);

  const activeProblem = activeDragId
    ? selectedProblems.find((problem) => problem.id === activeDragId) ?? null
    : null;
  const activeProblemGlobalIndex = activeDragId
    ? selectedProblems.findIndex((problem) => problem.id === activeDragId)
    : -1;

  const setProblemMeasureRef = useCallback(
    (id: string) => (node: HTMLDivElement | null) => {
      if (node) {
        problemMeasureRefs.current.set(id, node);
        return;
      }
      problemMeasureRefs.current.delete(id);
    },
    [],
  );

  const setRenderedSlotRef = useCallback(
    (
      id: string,
      key: "slot" | "content",
    ) => (node: HTMLDivElement | null) => {
      const existing = renderedSlotRefs.current.get(id) ?? {
        content: null,
        slot: null,
      };
      existing[key] = node;

      if (existing.slot || existing.content) {
        renderedSlotRefs.current.set(id, existing);
        return;
      }

      renderedSlotRefs.current.delete(id);
    },
    [],
  );

  useLayoutEffect(() => {
    if (!currentPreviewPage) return;

    const overflowingIds = currentPreviewPage.columns
      .flatMap((column) => column.items)
      .filter((item) => item.span < layout.rowsPerColumn)
      .filter((item) => {
        const refs = renderedSlotRefs.current.get(item.problem.id);
        if (!refs?.slot || !refs.content) return false;

        const slotHeight = refs.slot.getBoundingClientRect().height;
        const contentHeight = refs.content.getBoundingClientRect().height;
        return contentHeight > slotHeight + 2;
      })
      .map((item) => item.problem.id);

    if (overflowingIds.length === 0) return;

    setForcedSpans((prev) => {
      const next = { ...prev };
      overflowingIds.forEach((id) => {
        next[id] = layout.rowsPerColumn;
      });

      return areMeasurementsEqual(prev, next) ? prev : next;
    });
  }, [currentPreviewPage, layout.rowsPerColumn]);

  if (selectedProblems.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3 py-20">
        <FileText className="size-12 opacity-40" />
        <p className="text-sm">문제를 추가하면 미리보기가 표시됩니다</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 h-full">
      <div className="flex items-center justify-center gap-3">
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
          disabled={safePage <= 1}
          aria-label="Previous page"
        >
          <ChevronLeft className="size-4" />
        </Button>

        <div className="flex items-center gap-1.5">
          {Array.from({ length: totalPages }, (_, index) => (
            <button
              key={index}
              onClick={() => setCurrentPage(index + 1)}
              className={cn(
                "size-2 rounded-full transition-all",
                index + 1 === safePage
                  ? "bg-primary scale-125"
                  : "bg-muted-foreground/30 hover:bg-muted-foreground/50",
              )}
              aria-label={`Go to page ${index + 1}`}
            />
          ))}
        </div>

        <span className="text-xs text-muted-foreground tabular-nums min-w-[3rem] text-center">
          {safePage} / {totalPages}
        </span>

        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
          disabled={safePage >= totalPages}
          aria-label="Next page"
        >
          <ChevronRight className="size-4" />
        </Button>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <SortableContext items={allIds} strategy={verticalListSortingStrategy}>
          <div className="relative">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 opacity-0 overflow-hidden"
            >
              <div
                className="absolute inset-0 flex flex-col"
                style={{ fontSize: `${layout.fontSize}px` }}
              >
                <PreviewHeader
                  docType={docType}
                  examDate={examDate}
                  schoolName={schoolName}
                  showNameField={showNameField}
                  title={title}
                  duration={duration}
                />
                <div
                  ref={firstPageContentRef}
                  className="flex-1 px-4 pt-1.5 pb-1 overflow-hidden [&_.katex]:!text-[1em]"
                >
                  {layout.columns === 1 ? (
                    <div ref={singleColumnProbeRef} className="h-full" />
                  ) : (
                    <div className="grid grid-cols-2 gap-x-2 h-full">
                      <div className="h-full border-r border-gray-300 pr-2">
                        <div ref={leftColumnProbeRef} className="h-full" />
                      </div>
                      <div className="h-full pl-1">
                        <div ref={rightColumnProbeRef} className="h-full" />
                      </div>
                    </div>
                  )}
                </div>
                <div className="px-4 py-px text-center text-[0.76em] text-gray-400">
                  - 1 / 1 -
                </div>
              </div>

              <div
                className="absolute inset-0 flex flex-col"
                style={{ fontSize: `${layout.fontSize}px` }}
              >
                <div
                  ref={regularPageContentRef}
                  className="flex-1 px-4 pt-1.5 pb-1 overflow-hidden [&_.katex]:!text-[1em]"
                >
                  {layout.columns === 1 ? (
                    <div className="h-full" />
                  ) : (
                    <div className="grid grid-cols-2 gap-x-2 h-full">
                      <div className="h-full" />
                      <div className="h-full" />
                    </div>
                  )}
                </div>
                <div className="px-4 py-px text-center text-[0.76em] text-gray-400">
                  - 1 / 1 -
                </div>
              </div>

              {pageMetrics.contentWidth > 0 && (
                <div
                  className="absolute left-0 top-0 [&_.katex]:!text-[1em]"
                  style={{
                    fontSize: `${layout.fontSize}px`,
                    width: `${pageMetrics.contentWidth}px`,
                  }}
                >
                  {selectedProblems.map((problem, index) => (
                    <div
                      key={`measure-${problem.id}`}
                      ref={setProblemMeasureRef(problem.id)}
                      className="w-full"
                    >
                      <ProblemContent problem={problem} number={index + 1} />
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div
              className="w-full aspect-[210/297] bg-white text-black border border-gray-300 shadow-md rounded-sm overflow-hidden flex flex-col"
              style={{ fontSize: `${layout.fontSize}px` }}
            >
              {currentPreviewPage?.isFirstPage && (
                <PreviewHeader
                  docType={docType}
                  examDate={examDate}
                  schoolName={schoolName}
                  showNameField={showNameField}
                  title={title}
                  duration={duration}
                />
              )}

              <div className="flex-1 px-4 pt-1.5 pb-1 overflow-hidden [&_.katex]:!text-[1em]">
                {layout.columns === 1 ? (
                  <PreviewColumn
                    items={currentPreviewPage?.columns[0]?.items ?? []}
                    rowsPerColumn={layout.rowsPerColumn}
                    onRemove={onRemove}
                    setRenderedSlotRef={setRenderedSlotRef}
                  />
                ) : (
                  <div className="grid grid-cols-2 gap-x-2 h-full">
                    <PreviewColumn
                      className="border-r border-gray-300 pr-2"
                      items={currentPreviewPage?.columns[0]?.items ?? []}
                      rowsPerColumn={layout.rowsPerColumn}
                      onRemove={onRemove}
                      setRenderedSlotRef={setRenderedSlotRef}
                    />
                    <PreviewColumn
                      className="pl-1"
                      items={currentPreviewPage?.columns[1]?.items ?? []}
                      rowsPerColumn={layout.rowsPerColumn}
                      onRemove={onRemove}
                      setRenderedSlotRef={setRenderedSlotRef}
                    />
                  </div>
                )}
              </div>

              <div className="px-4 py-px text-center text-[0.76em] text-gray-400">
                - {safePage} / {totalPages} -
              </div>
            </div>
          </div>
        </SortableContext>

        <DragOverlay dropAnimation={null}>
          {activeProblem ? (
            <DragOverlayProblem
              problem={activeProblem}
              globalIndex={activeProblemGlobalIndex}
            />
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}

export default ExamPreviewPanel;
