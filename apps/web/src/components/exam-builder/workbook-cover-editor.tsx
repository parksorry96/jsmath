"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlignCenter, AlignLeft, AlignRight, Move, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  COVER_LAYOUT_STYLES,
  COVER_LAYER_LABELS,
  COVER_PALETTES,
  SAFE_AREA_INSET,
  clampCoverPosition,
  getCoverPalette,
  resetCoverLayerPosition,
  type CoverLayerKey,
  type CoverLayerPosition,
  type CoverLayerPositions,
  type CoverLayoutStyle,
} from "./workbook-cover";

interface WorkbookCoverEditorProps {
  author: string;
  fallbackTitle: string;
  onPaletteChange: (paletteId: string) => void;
  onPositionsChange: (positions: CoverLayerPositions) => void;
  onStyleChange: (style: CoverLayoutStyle) => void;
  paletteId: string;
  positions: CoverLayerPositions;
  styleId: CoverLayoutStyle;
  subtitle: string;
  title: string;
  year: string;
}

const TITLE_FONT_STACK =
  '"Iowan Old Style", "Palatino Linotype", "Book Antiqua", Georgia, serif';
const BODY_FONT_STACK =
  '"Avenir Next", "Pretendard", "Noto Sans KR", "Apple SD Gothic Neo", sans-serif';

const LAYER_WIDTHS: Record<CoverLayerKey, string> = {
  author: "42%",
  subtitle: "62%",
  title: "76%",
  year: "30%",
};

const ALIGN_BUTTONS: Array<{
  align: CoverLayerPosition["align"];
  icon: typeof AlignLeft;
  label: string;
}> = [
  { align: "left", icon: AlignLeft, label: "왼쪽" },
  { align: "center", icon: AlignCenter, label: "가운데" },
  { align: "right", icon: AlignRight, label: "오른쪽" },
];

function hexToRgba(hex: string, alpha: number): string {
  const normalized = hex.replace("#", "");
  const value = normalized.length === 6 ? normalized : "000000";
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function getTransformForAlign(align: CoverLayerPosition["align"]): string {
  if (align === "center") return "translateX(-50%)";
  if (align === "right") return "translateX(-100%)";
  return "translateX(0)";
}

function getTextAlign(align: CoverLayerPosition["align"]): "left" | "center" | "right" {
  if (align === "center") return "center";
  if (align === "right") return "right";
  return "left";
}

function getLayerPreview(
  layer: CoverLayerKey,
  values: {
    author: string;
    fallbackTitle: string;
    subtitle: string;
    title: string;
    year: string;
  },
) {
  switch (layer) {
    case "title":
      return {
        active: Boolean(values.title.trim() || values.fallbackTitle.trim()),
        text: values.title.trim() || values.fallbackTitle.trim() || "교재 제목",
      };
    case "subtitle":
      return {
        active: Boolean(values.subtitle.trim()),
        text: values.subtitle.trim() || "부제목을 입력하면 여기에 표시됩니다",
      };
    case "author":
      return {
        active: Boolean(values.author.trim()),
        text: values.author.trim() || "저자 또는 학원명",
      };
    case "year":
      return {
        active: Boolean(values.year.trim()),
        text: values.year.trim() || String(new Date().getFullYear()),
      };
  }
}

function CoverBackdrop({
  accent,
  background,
  styleId,
  text,
}: {
  accent: string;
  background: string;
  styleId: CoverLayoutStyle;
  text: string;
}) {
  return (
    <>
      <div className="absolute inset-0" style={{ backgroundColor: background }} />

      {styleId === "editorial" && (
        <>
          <div
            className="absolute inset-[7%] rounded-[30px] border"
            style={{ borderColor: hexToRgba(accent, 0.32) }}
          />
          <div
            className="absolute left-[9%] top-[9%] h-[10px] w-[74px] rounded-full"
            style={{ backgroundColor: accent }}
          />
          <div
            className="absolute left-[9%] right-[9%] top-[13%] h-px"
            style={{ backgroundColor: hexToRgba(accent, 0.22) }}
          />
        </>
      )}

      {styleId === "band" && (
        <>
          <div
            className="absolute left-0 right-0 top-[18%] h-[24%]"
            style={{ backgroundColor: hexToRgba(accent, 0.16) }}
          />
          <div
            className="absolute left-0 top-[18%] h-[24%] w-[42%]"
            style={{ backgroundColor: accent }}
          />
          <div
            className="absolute right-[9%] top-[10%] h-[4px] w-[22%] rounded-full"
            style={{ backgroundColor: hexToRgba(text, 0.26) }}
          />
        </>
      )}

      {styleId === "split" && (
        <>
          <div
            className="absolute bottom-0 left-0 top-0 w-[13%]"
            style={{ backgroundColor: accent }}
          />
          <div
            className="absolute right-[8%] top-[8%] h-[18%] w-[24%] rounded-bl-[34px]"
            style={{ backgroundColor: hexToRgba(accent, 0.14) }}
          />
          <div
            className="absolute bottom-[10%] left-[18%] right-[8%] h-px"
            style={{ backgroundColor: hexToRgba(text, 0.18) }}
          />
        </>
      )}
    </>
  );
}

function StyleThumbnail({
  accent,
  background,
  styleId,
  text,
}: {
  accent: string;
  background: string;
  styleId: CoverLayoutStyle;
  text: string;
}) {
  return (
    <div
      className="relative h-16 overflow-hidden rounded-xl border"
      style={{
        backgroundColor: background,
        borderColor: hexToRgba(text, 0.12),
      }}
    >
      <CoverBackdrop
        accent={accent}
        background={background}
        styleId={styleId}
        text={text}
      />
      <div
        className="absolute left-[18%] top-[22%] h-[4px] w-[52%] rounded-full"
        style={{ backgroundColor: hexToRgba(text, 0.78) }}
      />
      <div
        className="absolute left-[18%] top-[34%] h-[4px] w-[34%] rounded-full"
        style={{ backgroundColor: hexToRgba(text, 0.42) }}
      />
      <div
        className="absolute left-[18%] top-[62%] h-[3px] w-[24%] rounded-full"
        style={{ backgroundColor: hexToRgba(text, 0.34) }}
      />
    </div>
  );
}

export function WorkbookCoverEditor({
  author,
  fallbackTitle,
  onPaletteChange,
  onPositionsChange,
  onStyleChange,
  paletteId,
  positions,
  styleId,
  subtitle,
  title,
  year,
}: WorkbookCoverEditorProps) {
  const [selectedLayer, setSelectedLayer] = useState<CoverLayerKey>("title");
  const safeAreaRef = useRef<HTMLDivElement | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  const palette = useMemo(() => getCoverPalette(paletteId), [paletteId]);

  const previewValues = useMemo(
    () => ({
      author,
      fallbackTitle,
      subtitle,
      title,
      year,
    }),
    [author, fallbackTitle, subtitle, title, year],
  );

  useEffect(() => {
    return () => {
      cleanupRef.current?.();
    };
  }, []);

  const updateLayer = useCallback(
    (layer: CoverLayerKey, next: Partial<CoverLayerPosition>) => {
      onPositionsChange({
        ...positions,
        [layer]: clampCoverPosition({
          ...positions[layer],
          ...next,
        }),
      });
    },
    [onPositionsChange, positions],
  );

  const startDraggingLayer = useCallback(
    (layer: CoverLayerKey, event: React.PointerEvent<HTMLButtonElement>) => {
      const rect = safeAreaRef.current?.getBoundingClientRect();
      if (!rect) return;

      setSelectedLayer(layer);
      event.preventDefault();

      const updateFromPointer = (clientX: number, clientY: number) => {
        const relativeX = ((clientX - rect.left) / rect.width) * 100;
        const relativeY = ((clientY - rect.top) / rect.height) * 100;
        updateLayer(layer, { x: relativeX, y: relativeY });
      };

      updateFromPointer(event.clientX, event.clientY);

      const handlePointerMove = (moveEvent: PointerEvent) => {
        updateFromPointer(moveEvent.clientX, moveEvent.clientY);
      };

      const stopDragging = () => {
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", stopDragging);
        cleanupRef.current = null;
      };

      cleanupRef.current?.();
      cleanupRef.current = stopDragging;

      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", stopDragging, { once: true });
    },
    [updateLayer],
  );

  return (
    <div className="space-y-4 rounded-2xl border border-border/70 bg-background/60 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-foreground">표지 미리보기</p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Canva, Adobe Express, Gamma 류 편집기처럼 표지 요소를 바로 보고 옮길 수 있게 구성했습니다.
          </p>
        </div>
        <button
          type="button"
          onClick={() => onPositionsChange({
            author: resetCoverLayerPosition("author"),
            subtitle: resetCoverLayerPosition("subtitle"),
            title: resetCoverLayerPosition("title"),
            year: resetCoverLayerPosition("year"),
          })}
          className="inline-flex items-center gap-1 rounded-full border border-border/70 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-border hover:text-foreground"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          기본 위치
        </button>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_240px]">
        <div className="rounded-[28px] border border-border/70 bg-gradient-to-b from-background to-background/80 p-4">
          <div className="mx-auto w-full max-w-[360px]">
            <div className="mb-2 flex items-center justify-between text-[11px] uppercase tracking-[0.24em] text-muted-foreground/80">
              <span>A4 Preview</span>
              <span>Safe area inside</span>
            </div>
            <div className="relative aspect-[210/297] overflow-hidden rounded-[30px] border border-border/60 shadow-[0_24px_60px_rgba(15,23,42,0.18)]">
              <CoverBackdrop
                accent={palette.accent}
                background={palette.background}
                styleId={styleId}
                text={palette.text}
              />

              <div
                ref={safeAreaRef}
                className="absolute rounded-[24px] border border-dashed"
                style={{
                  borderColor: hexToRgba(palette.text, 0.18),
                  bottom: `${SAFE_AREA_INSET.bottom}%`,
                  left: `${SAFE_AREA_INSET.left}%`,
                  right: `${SAFE_AREA_INSET.right}%`,
                  top: `${SAFE_AREA_INSET.top}%`,
                }}
              >
                <div
                  className="absolute inset-y-0 left-1/2 w-px"
                  style={{ backgroundColor: hexToRgba(palette.text, 0.08) }}
                />
                <div
                  className="absolute inset-x-0 top-1/2 h-px"
                  style={{ backgroundColor: hexToRgba(palette.text, 0.06) }}
                />

                {(["title", "subtitle", "author", "year"] as CoverLayerKey[]).map((layer) => {
                  const layerMeta = getLayerPreview(layer, previewValues);
                  const position = positions[layer];
                  const isSelected = selectedLayer === layer;
                  const textAlign = getTextAlign(position.align);
                  const contentClass =
                    layer === "title"
                      ? "text-[1.55rem] font-semibold leading-[1.08] tracking-[-0.035em]"
                      : layer === "subtitle"
                        ? "text-[0.86rem] leading-relaxed"
                        : "text-[0.74rem] uppercase tracking-[0.24em]";

                  return (
                    <div
                      key={layer}
                      className="absolute top-0"
                      style={{
                        left: `${position.x}%`,
                        top: `${position.y}%`,
                        transform: getTransformForAlign(position.align),
                        width: LAYER_WIDTHS[layer],
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => setSelectedLayer(layer)}
                        onPointerDown={(event) => startDraggingLayer(layer, event)}
                        className={cn(
                          "group w-full rounded-2xl border px-3 py-2 text-left transition-all",
                          "touch-none select-none backdrop-blur-[1px]",
                          isSelected ? "shadow-md" : "shadow-none",
                        )}
                        style={{
                          backgroundColor: isSelected
                            ? hexToRgba(palette.background, 0.78)
                            : hexToRgba(palette.background, layerMeta.active ? 0.48 : 0.32),
                          borderColor: isSelected
                            ? hexToRgba(palette.accent, 0.72)
                            : hexToRgba(palette.text, layerMeta.active ? 0.18 : 0.1),
                          opacity: layerMeta.active ? 1 : 0.72,
                        }}
                      >
                        <div className="mb-1 flex items-center justify-between gap-2 text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                          <span>{COVER_LAYER_LABELS[layer]}</span>
                          <span className="inline-flex items-center gap-1">
                            <Move className="h-3 w-3" />
                            drag
                          </span>
                        </div>
                        <div
                          className={contentClass}
                          style={{
                            color: layer === "title" ? palette.text : layer === "subtitle" ? palette.mutedText : palette.text,
                            fontFamily: layer === "title" ? TITLE_FONT_STACK : BODY_FONT_STACK,
                            letterSpacing: layer === "author" || layer === "year" ? "0.12em" : undefined,
                            textAlign,
                          }}
                        >
                          {layerMeta.text}
                        </div>
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="space-y-2 rounded-2xl border border-border/70 bg-background/70 p-3">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              표지 팔레트
            </p>
            <div className="grid grid-cols-2 gap-2">
              {COVER_PALETTES.map((option) => {
                const selected = option.id === paletteId;
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => onPaletteChange(option.id)}
                    className={cn(
                      "rounded-2xl border p-2 text-left transition-all",
                      selected
                        ? "border-foreground/20 shadow-sm"
                        : "border-border/70 hover:border-border",
                    )}
                  >
                    <div
                      className="mb-2 h-9 rounded-xl border border-black/5"
                      style={{ background: option.swatch }}
                    />
                    <p className="text-sm font-medium text-foreground">
                      {option.label}
                    </p>
                    <p className="text-[11px] leading-relaxed text-muted-foreground">
                      {option.description}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-2 rounded-2xl border border-border/70 bg-background/70 p-3">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              레이아웃 스타일
            </p>
            <div className="space-y-2">
              {COVER_LAYOUT_STYLES.map((option) => {
                const selected = option.id === styleId;
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => onStyleChange(option.id)}
                    className={cn(
                      "w-full rounded-2xl border p-2 text-left transition-all",
                      selected
                        ? "border-foreground/20 shadow-sm"
                        : "border-border/70 hover:border-border",
                    )}
                  >
                    <StyleThumbnail
                      accent={palette.accent}
                      background={palette.background}
                      styleId={option.id}
                      text={palette.text}
                    />
                    <p className="mt-2 text-sm font-medium text-foreground">
                      {option.label}
                    </p>
                    <p className="text-[11px] leading-relaxed text-muted-foreground">
                      {option.description}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-3 rounded-2xl border border-border/70 bg-background/70 p-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                텍스트 배치
              </p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                레이어를 선택하고 정렬을 조정하거나, 미리보기에서 바로 드래그하세요.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              {(["title", "subtitle", "author", "year"] as CoverLayerKey[]).map((layer) => (
                <button
                  key={layer}
                  type="button"
                  onClick={() => setSelectedLayer(layer)}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                    selectedLayer === layer
                      ? "border-foreground/20 bg-foreground/5 text-foreground"
                      : "border-border/70 text-muted-foreground hover:border-border hover:text-foreground",
                  )}
                >
                  {COVER_LAYER_LABELS[layer]}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              {ALIGN_BUTTONS.map(({ align, icon: Icon, label }) => (
                <button
                  key={align}
                  type="button"
                  onClick={() => updateLayer(selectedLayer, { align })}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                    positions[selectedLayer].align === align
                      ? "border-foreground/20 bg-foreground/5 text-foreground"
                      : "border-border/70 text-muted-foreground hover:border-border hover:text-foreground",
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() =>
                onPositionsChange({
                  ...positions,
                  [selectedLayer]: resetCoverLayerPosition(selectedLayer),
                })
              }
              className="inline-flex items-center gap-1 rounded-full border border-border/70 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-border hover:text-foreground"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              선택 레이어 초기화
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
