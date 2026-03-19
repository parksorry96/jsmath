"use client";

import { cn } from "@/lib/utils";
import { PRESETS, type Preset } from "./constants";
import { useProblemFilters } from "./use-problem-filters";

interface PresetBarProps {
  totalCount: number;
}

export function ProblemPresetBar({ totalCount }: PresetBarProps) {
  const { activePreset, applyPreset } = useProblemFilters();

  return (
    <div className="flex items-center gap-2 border-b px-5 py-3 flex-wrap">
      <span className="text-xs text-muted-foreground mr-1">빠른 필터:</span>
      {PRESETS.map((preset) => (
        <button
          key={preset.label}
          onClick={() => applyPreset(preset)}
          className={cn(
            "px-3 py-1 rounded-full text-xs font-medium transition-colors",
            activePreset?.label === preset.label
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground hover:bg-muted/80",
          )}
        >
          {preset.label}
        </button>
      ))}
      <div className="flex-1" />
      <span className="text-xs text-muted-foreground">
        총 {totalCount.toLocaleString()}문항
      </span>
    </div>
  );
}
