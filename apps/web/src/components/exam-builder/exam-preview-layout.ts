export interface PreviewLayoutConfig {
  columns: number;
  fontSize: number;
  rowsPerColumn: number;
}

export interface PreviewPageItem<T> {
  problem: T;
  globalIndex: number;
  span: number;
}

export interface PreviewPageColumn<T> {
  items: PreviewPageItem<T>[];
  usedRows: number;
}

export interface PreviewPage<T> {
  columns: PreviewPageColumn<T>[];
  endIndex: number;
  isFirstPage: boolean;
  problemCount: number;
  startIndex: number;
}

const DEFAULT_FIT_BUFFER_PX = 12;
const NEAR_FULL_ROW_BUFFER = 0.18;

export function getPreviewLayoutConfig(
  problemsPerPage: number,
): PreviewLayoutConfig {
  switch (problemsPerPage) {
    case 2:
      return { columns: 1, fontSize: 11, rowsPerColumn: 2 };
    case 3:
      return { columns: 1, fontSize: 10, rowsPerColumn: 3 };
    case 4:
      return { columns: 2, fontSize: 9, rowsPerColumn: 2 };
    case 5:
      return { columns: 2, fontSize: 8, rowsPerColumn: 3 };
    case 6:
      return { columns: 2, fontSize: 7, rowsPerColumn: 3 };
    default:
      return { columns: 2, fontSize: 9, rowsPerColumn: 2 };
  }
}

export function paginatePreviewProblems<T extends { id: string }>(
  problems: T[],
  {
    fitBufferPx = DEFAULT_FIT_BUFFER_PX,
    firstPageHeight,
    forcedSpans = {},
    layout,
    problemHeights,
    problemsPerPage,
    regularPageHeight,
  }: {
    fitBufferPx?: number;
    firstPageHeight: number;
    forcedSpans?: Record<string, number>;
    layout: PreviewLayoutConfig;
    problemHeights: Record<string, number>;
    problemsPerPage: number;
    regularPageHeight: number;
  },
): PreviewPage<T>[] {
  if (problems.length === 0) return [];

  const pages: PreviewPage<T>[] = [];
  let cursor = 0;

  while (cursor < problems.length) {
    const pageHeight = pages.length === 0 ? firstPageHeight : regularPageHeight;
    const rowHeight =
      pageHeight > 0 && layout.rowsPerColumn > 0
        ? pageHeight / layout.rowsPerColumn
        : 0;
    const columns: PreviewPageColumn<T>[] = Array.from(
      { length: layout.columns },
      () => ({ items: [], usedRows: 0 }),
    );
    const startIndex = cursor;
    let placed = 0;
    let columnIndex = 0;

    while (cursor < problems.length && placed < problemsPerPage) {
      const problem = problems[cursor];
      const span = resolveProblemSpan(
        forcedSpans[problem.id],
        problemHeights[problem.id],
        rowHeight,
        layout.rowsPerColumn,
        fitBufferPx,
      );

      while (
        columnIndex < columns.length &&
        columns[columnIndex].usedRows + span > layout.rowsPerColumn
      ) {
        columnIndex += 1;
      }

      if (columnIndex >= columns.length) break;

      columns[columnIndex].items.push({
        globalIndex: cursor,
        problem,
        span,
      });
      columns[columnIndex].usedRows += span;
      placed += 1;
      cursor += 1;
    }

    if (placed === 0) {
      columns[0].items.push({
        globalIndex: cursor,
        problem: problems[cursor],
        span: layout.rowsPerColumn,
      });
      columns[0].usedRows = layout.rowsPerColumn;
      cursor += 1;
      placed = 1;
    }

    pages.push({
      columns,
      endIndex: cursor,
      isFirstPage: pages.length === 0,
      problemCount: placed,
      startIndex,
    });
  }

  return pages;
}

function resolveProblemSpan(
  forcedSpan: number | undefined,
  height: number | undefined,
  rowHeight: number,
  rowsPerColumn: number,
  fitBufferPx: number,
) {
  if (forcedSpan) {
    return Math.max(1, Math.min(rowsPerColumn, forcedSpan));
  }

  if (!height || !rowHeight || !rowsPerColumn) return 1;

  const occupiedRows = (height + fitBufferPx) / rowHeight;
  const baseSpan = Math.max(
    1,
    Math.min(rowsPerColumn, Math.ceil(occupiedRows)),
  );

  if (
    baseSpan < rowsPerColumn &&
    occupiedRows >= baseSpan - NEAR_FULL_ROW_BUFFER
  ) {
    return Math.min(rowsPerColumn, baseSpan + 1);
  }

  return baseSpan;
}
