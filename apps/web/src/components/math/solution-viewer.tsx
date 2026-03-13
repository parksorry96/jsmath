"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { LatexRenderer } from "@/components/math/latex-renderer";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

interface SolutionStep {
  step: number;
  title: string;
  content: string;
  explanation?: string;
}

interface AlternativeSolution {
  method: string;
  steps: Array<{ step: number; title: string; content: string }>;
}

interface SolutionViewerProps {
  solutionText?: string | null;
  solutionSteps?: SolutionStep[] | null;
  alternativeSolutions?: AlternativeSolution[] | null;
  defaultExpanded?: boolean;
  className?: string;
}

function StepItem({
  step,
  defaultExpanded,
}: {
  step: SolutionStep;
  defaultExpanded: boolean;
}) {
  const [open, setOpen] = useState(defaultExpanded);

  return (
    <div className="rounded-lg border border-border bg-brand-dark/50">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-medium text-foreground transition-colors hover:bg-brand-dark"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {open ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        <span className="text-brand-beige">Step {step.step}:</span>
        <span>{step.title}</span>
      </button>
      {open && (
        <div className="border-t border-border px-4 py-3">
          <LatexRenderer
            content={step.content}
            className="text-sm leading-relaxed text-foreground"
          />
          {step.explanation && (
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              {step.explanation}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function StepList({
  steps,
  defaultExpanded,
}: {
  steps: Array<{ step: number; title: string; content: string; explanation?: string }>;
  defaultExpanded: boolean;
}) {
  return (
    <div className="space-y-2">
      {steps.map((step) => (
        <StepItem key={step.step} step={step} defaultExpanded={defaultExpanded} />
      ))}
    </div>
  );
}

export function SolutionViewer({
  solutionText,
  solutionSteps,
  alternativeSolutions,
  defaultExpanded,
  className,
}: SolutionViewerProps) {
  const hasSteps = solutionSteps && solutionSteps.length > 0;
  const hasAlternatives =
    alternativeSolutions && alternativeSolutions.length > 0;

  // Default: collapsed for steps mode, expanded for text-only
  const resolvedExpanded = defaultExpanded ?? !hasSteps;

  // Nothing to render
  if (!hasSteps && !solutionText) {
    return null;
  }

  return (
    <div className={cn("space-y-4", className)}>
      {/* Primary solution */}
      {hasSteps ? (
        <StepList steps={solutionSteps} defaultExpanded={resolvedExpanded} />
      ) : (
        solutionText && (
          <div className="rounded-lg border border-border bg-brand-dark/50 p-4">
            <LatexRenderer
              content={solutionText}
              className="text-sm leading-relaxed text-foreground"
            />
          </div>
        )
      )}

      {/* Alternative solutions */}
      {hasAlternatives && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            다른 풀이법
          </p>
          {alternativeSolutions.length === 1 ? (
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">
                {alternativeSolutions[0].method}
              </p>
              <StepList
                steps={alternativeSolutions[0].steps}
                defaultExpanded={false}
              />
            </div>
          ) : (
            <Tabs defaultValue={alternativeSolutions[0].method}>
              <TabsList className="bg-brand-dark">
                {alternativeSolutions.map((alt) => (
                  <TabsTrigger key={alt.method} value={alt.method}>
                    {alt.method}
                  </TabsTrigger>
                ))}
              </TabsList>
              {alternativeSolutions.map((alt) => (
                <TabsContent key={alt.method} value={alt.method}>
                  <StepList steps={alt.steps} defaultExpanded={false} />
                </TabsContent>
              ))}
            </Tabs>
          )}
        </div>
      )}
    </div>
  );
}
