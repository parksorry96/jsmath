"use client";

import { useState } from "react";
import { CheckCircle2, Clock3, RotateCcw } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { LatexRenderer } from "@/components/math/latex-renderer";
import { SolutionViewer } from "@/components/math/solution-viewer";
import { toast } from "sonner";

interface ReviewStats {
  dueToday: number;
  completedToday: number;
  totalScheduled: number;
}

interface ReviewProblem {
  reviewScheduleId: string;
  wrongAnswerId: string;
  errorType: string;
  interval: number;
  repetitions: number;
  lastReviewedAt: string | null;
  problem: {
    id: string;
    stemLatex: string;
    stemText: string;
    subject: string | null;
    unitMajor: string | null;
    answerText: string | null;
    answerLatex: string | null;
    solutionText: string | null;
    solutionSteps: Array<{
      step: number;
      title: string;
      content: string;
      explanation?: string;
    }> | null;
    alternativeSolutions: Array<{
      method: string;
      steps: Array<{ step: number; title: string; content: string }>;
    }> | null;
    choices: Array<{
      label: string;
      contentLatex: string;
      contentText: string;
      position: number;
    }>;
  } | null;
}

interface DailyReviewResponse {
  dueCount: number;
  problems: ReviewProblem[];
}

const QUALITY_OPTIONS = [
  { value: 1, label: "모르겠음", variant: "destructive" as const },
  { value: 3, label: "어렵게 기억", variant: "secondary" as const },
  { value: 4, label: "기억남", variant: "secondary" as const },
  { value: 5, label: "완벽함", variant: "default" as const },
];

export default function ReviewDailyPage() {
  const queryClient = useQueryClient();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [completedCount, setCompletedCount] = useState(0);

  const { data, isLoading } = useQuery({
    queryKey: ["review-daily"],
    queryFn: () => api.get<DailyReviewResponse>("/reviews/daily"),
  });

  const { data: stats } = useQuery({
    queryKey: ["review-stats"],
    queryFn: () => api.get<ReviewStats>("/reviews/stats"),
  });

  const gradeMutation = useMutation({
    mutationFn: ({ id, quality }: { id: string; quality: number }) =>
      api.post(`/reviews/${id}/grade`, { quality }),
    onSuccess: () => {
      const problems = data?.problems ?? [];
      setCompletedCount((count) => count + 1);
      setShowAnswer(false);

      if (currentIndex < problems.length - 1) {
        setCurrentIndex((index) => index + 1);
      } else {
        queryClient.invalidateQueries({ queryKey: ["review-daily"] });
        queryClient.invalidateQueries({ queryKey: ["review-stats"] });
        setCurrentIndex(0);
      }
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "복습 저장에 실패했습니다.");
    },
  });

  const problems = data?.problems ?? [];
  const currentProblem = problems[currentIndex];
  const isDone = problems.length > 0 && currentIndex >= problems.length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">오늘의 복습</h1>
          <p className="text-muted-foreground">
            간격 반복으로 오답을 다시 기억에 고정합니다.
          </p>
        </div>
        {stats && (
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <span className="flex items-center gap-1">
              <Clock3 className="h-4 w-4" />
              예정 {stats.dueToday}
            </span>
            <span className="flex items-center gap-1">
              <CheckCircle2 className="h-4 w-4 text-green-400" />
              완료 {stats.completedToday + completedCount}
            </span>
          </div>
        )}
      </div>

      {isLoading && (
        <div className="space-y-3">
          <Skeleton className="h-28 rounded-2xl" />
          <Skeleton className="h-80 rounded-2xl" />
        </div>
      )}

      {!isLoading && problems.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-20">
            <CheckCircle2 className="h-16 w-16 text-green-400" />
            <p className="mt-4 text-lg font-medium">오늘의 복습을 마쳤습니다</p>
            <p className="mt-1 text-sm text-muted-foreground">
              다음 복습 일정이 되면 여기에 다시 표시됩니다.
            </p>
          </CardContent>
        </Card>
      )}

      {!isLoading && !isDone && currentProblem?.problem && (
        <div className="space-y-4">
          <Card>
            <CardContent className="p-4">
              <div className="mb-2 flex items-center justify-between text-sm text-muted-foreground">
                <span>
                  {currentIndex + 1} / {problems.length}
                </span>
                <span>간격 {currentProblem.interval}일</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-brand-charcoal">
                <div
                  className="h-full rounded-full bg-brand-beige transition-all"
                  style={{
                    width: `${((currentIndex + 1) / problems.length) * 100}%`,
                  }}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-5 p-6">
              <div className="flex flex-wrap items-center gap-2">
                {currentProblem.problem.subject && (
                  <Badge variant="outline">{currentProblem.problem.subject}</Badge>
                )}
                {currentProblem.problem.unitMajor && (
                  <Badge variant="outline">{currentProblem.problem.unitMajor}</Badge>
                )}
                <Badge variant="outline">복습 {currentProblem.repetitions + 1}회차</Badge>
              </div>

              <div className="rounded-2xl border border-border bg-brand-dark p-5">
                <LatexRenderer
                  content={
                    currentProblem.problem.stemLatex ||
                    currentProblem.problem.stemText
                  }
                  className="text-sm leading-relaxed"
                />

                {currentProblem.problem.choices.length > 0 && (
                  <div className="mt-5 space-y-2.5 border-t border-border pt-4">
                    {currentProblem.problem.choices.map((choice) => (
                      <div
                        key={`${currentProblem.reviewScheduleId}-${choice.position}`}
                        className="flex items-start gap-2 text-sm"
                      >
                        <span className="shrink-0 font-medium text-brand-beige">
                          {choice.label}
                        </span>
                        <LatexRenderer
                          content={choice.contentLatex || choice.contentText}
                          className="leading-relaxed"
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {!showAnswer ? (
                <div className="flex justify-center">
                  <Button onClick={() => setShowAnswer(true)}>정답 보기</Button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="rounded-xl border border-green-400/30 bg-green-900/10 p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-green-400">
                      정답
                    </p>
                    <LatexRenderer
                      content={
                        currentProblem.problem.answerLatex ||
                        currentProblem.problem.answerText ||
                        "등록된 정답이 없습니다."
                      }
                      className="mt-2 text-sm leading-relaxed text-foreground"
                    />
                  </div>

                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                      풀이
                    </p>
                    <SolutionViewer
                      solutionText={currentProblem.problem.solutionText}
                      solutionSteps={currentProblem.problem.solutionSteps}
                      alternativeSolutions={currentProblem.problem.alternativeSolutions}
                      defaultExpanded
                    />
                  </div>

                  <div className="space-y-3">
                    <p className="text-center text-sm text-muted-foreground">
                      얼마나 잘 기억했나요?
                    </p>
                    <div className="flex flex-wrap justify-center gap-2">
                      {QUALITY_OPTIONS.map((option) => (
                        <Button
                          key={option.value}
                          variant={option.variant}
                          onClick={() =>
                            gradeMutation.mutate({
                              id: currentProblem.reviewScheduleId,
                              quality: option.value,
                            })
                          }
                          disabled={gradeMutation.isPending}
                        >
                          {option.label}
                        </Button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
