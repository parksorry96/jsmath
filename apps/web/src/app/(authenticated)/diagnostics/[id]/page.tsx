"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Clock,
  CheckCircle,
  XCircle,
  LoaderCircle,
  ArrowRight,
} from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { LatexRenderer } from "@/components/math/latex-renderer";
import { api } from "@/lib/api";
import { toast } from "sonner";

interface ProblemChoice {
  label: string;
  contentLatex: string;
  contentText: string;
}

interface DiagnosticProblem {
  id: string;
  stemLatex: string;
  stemText: string;
  problemType: "multiple_choice" | "short_answer";
  difficulty: number | null;
  subject: string | null;
  unitMajor: string | null;
  unitMinor: string | null;
  choices?: ProblemChoice[];
}

interface TopicProfile {
  subject: string;
  unitMajor: string;
  score: number;
  level: string;
  theta: number;
  se: number;
  responses: number;
}

interface AnswerResponse {
  isComplete: boolean;
  problem?: DiagnosticProblem | null;
  result?: TopicProfile[];
  progress: { current: number; total: number };
  lastAnswer: { isCorrect: boolean; problemId: string };
}

interface StartResponse {
  session: { id: string; status: string; startedAt: string };
  problem: DiagnosticProblem;
  progress: { current: number; total: number };
}

const TIMER_SECONDS = 10 * 60; // 10 minutes

export default function DiagnosticSessionPage() {
  const { id: sessionId } = useParams<{ id: string }>();
  const router = useRouter();

  const [problem, setProblem] = useState<DiagnosticProblem | null>(null);
  const [progress, setProgress] = useState({ current: 0, total: 25 });
  const [selectedChoice, setSelectedChoice] = useState<string | null>(null);
  const [shortAnswer, setShortAnswer] = useState("");
  const [lastResult, setLastResult] = useState<{
    isCorrect: boolean;
  } | null>(null);
  const [timeRemaining, setTimeRemaining] = useState(TIMER_SECONDS);
  const [isInitialized, setIsInitialized] = useState(false);
  const startTimeRef = useRef<number>(Date.now());

  // Load session state — try sessionStorage first, then fall back to API
  useEffect(() => {
    const storageKey = `diagnostic-${sessionId}`;
    const stored = sessionStorage.getItem(storageKey);

    if (stored) {
      try {
        const startData: StartResponse = JSON.parse(stored);
        setProblem(startData.problem);
        setProgress(startData.progress);
        setIsInitialized(true);
        sessionStorage.removeItem(storageKey);
        return;
      } catch {
        // Fall through to API check
      }
    }

    // No stored data — check session status via API
    api
      .get<{
        id: string;
        status: string;
        startedAt: string;
        result: unknown;
        responses: unknown[];
        totalResponses: number;
      }>(`/diagnostics/${sessionId}/result`)
      .then((data) => {
        if (data.status === "completed") {
          router.replace(`/diagnostics/${sessionId}/result`);
          return;
        }
        setProgress({ current: data.totalResponses, total: 25 });
        setIsInitialized(true);
      })
      .catch(() => {
        setIsInitialized(true);
      });
  }, [sessionId, router]);

  // Timer countdown
  useEffect(() => {
    const interval = setInterval(() => {
      setTimeRemaining((prev) => {
        if (prev <= 0) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const submitMutation = useMutation({
    mutationFn: (answer: string) => {
      const elapsed = Math.round((Date.now() - startTimeRef.current) / 1000);
      return api.post<AnswerResponse>(`/diagnostics/${sessionId}/answer`, {
        studentAnswer: answer,
        responseTimeSec: elapsed,
      });
    },
    onSuccess: (data) => {
      setLastResult({ isCorrect: data.lastAnswer.isCorrect });

      if (data.isComplete) {
        // Brief delay to show last result, then navigate
        setTimeout(() => {
          router.push(`/diagnostics/${sessionId}/result`);
        }, 1500);
        return;
      }

      // Show feedback briefly then move to next problem
      setTimeout(() => {
        setLastResult(null);
        if (data.problem) {
          setProblem(data.problem);
        }
        setProgress(data.progress);
        setSelectedChoice(null);
        setShortAnswer("");
        startTimeRef.current = Date.now();
      }, 1000);
    },
    onError: (err) => {
      toast.error(
        err instanceof Error ? err.message : "답안 제출에 실패했습니다.",
      );
    },
  });

  const handleSubmit = useCallback(() => {
    if (submitMutation.isPending) return;

    let answer: string;
    if (problem?.problemType === "multiple_choice") {
      if (!selectedChoice) {
        toast.error("보기를 선택해 주세요.");
        return;
      }
      answer = selectedChoice;
    } else {
      if (!shortAnswer.trim()) {
        toast.error("답을 입력해 주세요.");
        return;
      }
      answer = shortAnswer.trim();
    }

    submitMutation.mutate(answer);
  }, [problem, selectedChoice, shortAnswer, submitMutation]);

  // Format time
  const minutes = Math.floor(timeRemaining / 60);
  const seconds = timeRemaining % 60;
  const timeStr = `${minutes}:${seconds.toString().padStart(2, "0")}`;
  const isTimeLow = timeRemaining < 60;

  if (!isInitialized) {
    return (
      <div className="flex items-center justify-center py-20">
        <LoaderCircle className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!problem) {
    return (
      <div className="mx-auto max-w-2xl space-y-6 py-8">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <p className="text-sm text-muted-foreground">
              문제를 불러오는 중이거나 진단이 완료되었습니다.
            </p>
            <Button
              variant="secondary"
              className="mt-4"
              onClick={() => router.push("/diagnostics")}
            >
              진단 목록으로 돌아가기
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      {/* Header bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Badge variant="outline" className="text-xs">
            {progress.current + 1} / {progress.total}
          </Badge>
          {problem.subject && (
            <span className="text-xs text-muted-foreground">
              {problem.subject}
              {problem.unitMajor && ` > ${problem.unitMajor}`}
            </span>
          )}
        </div>
        <div
          className={`flex items-center gap-1.5 text-sm font-mono ${
            isTimeLow ? "text-red-400" : "text-muted-foreground"
          }`}
        >
          <Clock className="h-4 w-4" />
          {timeStr}
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-brand-charcoal">
        <div
          className="h-full rounded-full bg-brand-beige transition-all duration-300"
          style={{
            width: `${((progress.current + 1) / progress.total) * 100}%`,
          }}
        />
      </div>

      {/* Feedback overlay */}
      {lastResult && (
        <div className="flex items-center justify-center gap-2 py-2">
          {lastResult.isCorrect ? (
            <>
              <CheckCircle className="h-5 w-5 text-green-400" />
              <span className="text-sm font-medium text-green-400">
                정답입니다!
              </span>
            </>
          ) : (
            <>
              <XCircle className="h-5 w-5 text-red-400" />
              <span className="text-sm font-medium text-red-400">
                오답입니다.
              </span>
            </>
          )}
        </div>
      )}

      {/* Problem card */}
      <Card>
        <CardContent className="space-y-6 p-6">
          {/* Stem */}
          <div className="rounded-xl border border-border bg-brand-dark p-5">
            <LatexRenderer
              content={problem.stemLatex || problem.stemText || ""}
              className="text-sm leading-relaxed text-foreground"
            />
          </div>

          {/* Answer area */}
          {problem.problemType === "multiple_choice" &&
            problem.choices &&
            problem.choices.length > 0 && (
              <div className="space-y-2">
                {problem.choices.map((choice) => {
                  const isSelected = selectedChoice === choice.label;
                  return (
                    <button
                      key={choice.label}
                      type="button"
                      className={`flex w-full items-start gap-3 rounded-xl border p-4 text-left transition-colors ${
                        isSelected
                          ? "border-brand-beige bg-brand-beige/10"
                          : "border-border hover:border-brand-beige/40"
                      }`}
                      onClick={() => setSelectedChoice(choice.label)}
                      disabled={submitMutation.isPending || !!lastResult}
                    >
                      <span
                        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                          isSelected
                            ? "bg-brand-beige text-brand-dark"
                            : "bg-brand-charcoal text-muted-foreground"
                        }`}
                      >
                        {choice.label}
                      </span>
                      <LatexRenderer
                        content={choice.contentLatex || choice.contentText || ""}
                        className="text-sm leading-relaxed"
                      />
                    </button>
                  );
                })}
              </div>
            )}

          {problem.problemType === "short_answer" && (
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">
                답을 입력하세요
              </label>
              <Input
                value={shortAnswer}
                onChange={(e) => setShortAnswer(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSubmit();
                }}
                placeholder="답 입력..."
                className="bg-brand-charcoal border-transparent"
                disabled={submitMutation.isPending || !!lastResult}
                autoFocus
              />
            </div>
          )}

          {/* Submit button */}
          <Button
            onClick={handleSubmit}
            disabled={submitMutation.isPending || !!lastResult}
            className="w-full"
          >
            {submitMutation.isPending ? (
              <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <ArrowRight className="mr-2 h-4 w-4" />
            )}
            {submitMutation.isPending ? "제출 중..." : "답안 제출"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
