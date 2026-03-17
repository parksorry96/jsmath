"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MessageCircle, Search } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { buildProblemPreview } from "@/lib/problem-preview";

interface Problem {
  id: string;
  stemLatex: string;
  stemText: string;
  problemType: string;
  difficulty: number | null;
  subject: string | null;
  unitMajor: string | null;
  problemNumber: string | null;
}

interface ProblemsResponse {
  data: Problem[];
  total: number;
}

const DIFFICULTY_LABELS: Record<number, string> = {
  1: "매우 쉬움",
  2: "쉬움",
  3: "보통",
  4: "어려움",
  5: "매우 어려움",
};

export default function TutorLandingPage() {
  const router = useRouter();
  const [search, setSearch] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["tutor-problems", search],
    queryFn: () => {
      const params = new URLSearchParams({ limit: "20" });
      if (search) params.set("search", search);
      return api.get<ProblemsResponse>(`/problems?${params.toString()}`);
    },
  });

  const problems = data?.data ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">AI 튜터</h1>
        <p className="text-muted-foreground">
          어려운 문제를 선택하면 AI 튜터가 소크라테스 방식으로 풀이를 안내합니다.
        </p>
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="문제 검색..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-10"
        />
      </div>

      {/* Problem list */}
      {isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-[100px] rounded-xl" />
          ))}
        </div>
      )}

      {!isLoading && problems.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <MessageCircle className="h-12 w-12 text-muted-foreground" />
            <p className="mt-4 text-sm font-medium">문제를 찾을 수 없습니다</p>
            <p className="mt-1 text-xs text-muted-foreground">
              검색어를 변경하거나 문제를 먼저 업로드해 주세요.
            </p>
          </CardContent>
        </Card>
      )}

      {!isLoading && problems.length > 0 && (
        <div className="space-y-3">
          {problems.map((problem) => (
            <Card
              key={problem.id}
              className="cursor-pointer transition-colors hover:border-brand-beige/40"
              onClick={() => router.push(`/tutor/${problem.id}`)}
            >
              <CardContent className="flex items-start gap-4 p-4">
                <div className="flex-1 min-w-0">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    {problem.problemNumber && (
                      <span className="text-xs font-medium text-muted-foreground">
                        #{problem.problemNumber}
                      </span>
                    )}
                    {problem.subject && (
                      <Badge variant="outline" className="text-[10px]">
                        {problem.subject}
                        {problem.unitMajor ? ` / ${problem.unitMajor}` : ""}
                      </Badge>
                    )}
                    {problem.difficulty != null && (
                      <Badge variant="secondary" className="text-[10px]">
                        {DIFFICULTY_LABELS[problem.difficulty] ??
                          `난이도 ${problem.difficulty}`}
                      </Badge>
                    )}
                  </div>
                  <p className="line-clamp-2 text-sm text-foreground">
                    {buildProblemPreview(problem, 120)}
                  </p>
                </div>
                <Button variant="outline" size="sm" className="shrink-0">
                  <MessageCircle className="mr-1.5 h-3.5 w-3.5" />
                  튜터링
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
