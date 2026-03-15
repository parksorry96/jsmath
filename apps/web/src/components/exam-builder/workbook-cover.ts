"use client";

export type CoverTextAlign = "left" | "center" | "right";
export type CoverLayoutStyle = "editorial" | "band" | "split";
export type CoverLayerKey = "title" | "subtitle" | "author" | "year";

export interface CoverLayerPosition {
  align: CoverTextAlign;
  x: number;
  y: number;
}

export type CoverLayerPositions = Record<CoverLayerKey, CoverLayerPosition>;

export interface CoverPalette {
  accent: string;
  background: string;
  description: string;
  id: string;
  label: string;
  mutedText: string;
  swatch: string;
  text: string;
}

export interface CoverStyleOption {
  description: string;
  id: CoverLayoutStyle;
  label: string;
}

export const SAFE_AREA_INSET = {
  bottom: 10,
  left: 10,
  right: 10,
  top: 8,
} as const;

export const COVER_LAYER_LABELS: Record<CoverLayerKey, string> = {
  author: "저자",
  subtitle: "부제목",
  title: "제목",
  year: "연도",
};

export const DEFAULT_COVER_LAYER_POSITIONS: CoverLayerPositions = {
  author: { align: "left", x: 0, y: 75 },
  subtitle: { align: "left", x: 0, y: 34 },
  title: { align: "left", x: 0, y: 18 },
  year: { align: "left", x: 0, y: 83 },
};

export const COVER_PALETTES: CoverPalette[] = [
  {
    accent: "#C49A4A",
    background: "#FFFFFF",
    description: "여백 중심의 흰색 표지",
    id: "paper",
    label: "화이트",
    mutedText: "#6B7280",
    swatch: "linear-gradient(135deg, #FFFFFF 0%, #F5F1E8 100%)",
    text: "#101828",
  },
  {
    accent: "#9F7B45",
    background: "#F6F0E8",
    description: "출판 편집물 느낌의 아이보리",
    id: "ivory",
    label: "아이보리",
    mutedText: "#736B61",
    swatch: "linear-gradient(135deg, #FBF7F1 0%, #E8D8C3 100%)",
    text: "#1F2937",
  },
  {
    accent: "#5B728A",
    background: "#EEF3F8",
    description: "차분한 블루 그레이",
    id: "mist",
    label: "미스트",
    mutedText: "#607085",
    swatch: "linear-gradient(135deg, #F7FAFC 0%, #D7E2EC 100%)",
    text: "#18212B",
  },
  {
    accent: "#A9C1D9",
    background: "#1E3A5F",
    description: "짙은 네이비와 밝은 포인트",
    id: "navy",
    label: "네이비",
    mutedText: "#D6E3F0",
    swatch: "linear-gradient(135deg, #16324D 0%, #2D5582 100%)",
    text: "#F8FAFC",
  },
  {
    accent: "#D7C28B",
    background: "#20352B",
    description: "교재형 그린 베이스",
    id: "forest",
    label: "포레스트",
    mutedText: "#DCE6D7",
    swatch: "linear-gradient(135deg, #1B2D25 0%, #2D4B3C 100%)",
    text: "#F9FAFB",
  },
  {
    accent: "#D6A36C",
    background: "#1F242C",
    description: "모던한 차콜 톤",
    id: "charcoal",
    label: "차콜",
    mutedText: "#D0D5DD",
    swatch: "linear-gradient(135deg, #151A20 0%, #303A46 100%)",
    text: "#F8FAFC",
  },
];

export const COVER_LAYOUT_STYLES: CoverStyleOption[] = [
  {
    description: "얇은 프레임과 상단 포인트",
    id: "editorial",
    label: "에디토리얼",
  },
  {
    description: "상단 밴드로 제목을 잡아주는 구성",
    id: "band",
    label: "밴드",
  },
  {
    description: "좌측 스트랩과 코너 포인트",
    id: "split",
    label: "사이드",
  },
];

export function clampCoverPosition(value: CoverLayerPosition): CoverLayerPosition {
  return {
    align: value.align,
    x: Math.min(100, Math.max(0, Number(value.x.toFixed(2)))),
    y: Math.min(100, Math.max(0, Number(value.y.toFixed(2)))),
  };
}

export function getCoverPalette(id: string): CoverPalette {
  return COVER_PALETTES.find((palette) => palette.id === id) ?? COVER_PALETTES[0];
}

export function resetCoverLayerPosition(layer: CoverLayerKey): CoverLayerPosition {
  return { ...DEFAULT_COVER_LAYER_POSITIONS[layer] };
}

export function resetCoverLayerPositions(): CoverLayerPositions {
  return {
    author: resetCoverLayerPosition("author"),
    subtitle: resetCoverLayerPosition("subtitle"),
    title: resetCoverLayerPosition("title"),
    year: resetCoverLayerPosition("year"),
  };
}
