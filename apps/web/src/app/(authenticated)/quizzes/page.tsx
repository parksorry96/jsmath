import { Plus, Clock, Users, FileText } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const quizzes = [
  {
    id: 1,
    title: "수학(상) 중간고사 대비 퀴즈",
    course: "고1 수학(상)",
    problems: 20,
    duration: "40분",
    attempts: 28,
    status: "active" as const,
  },
  {
    id: 2,
    title: "다항식 단원 테스트",
    course: "고1 수학(상)",
    problems: 10,
    duration: "20분",
    attempts: 30,
    status: "closed" as const,
  },
  {
    id: 3,
    title: "미분 개념 확인",
    course: "수학II",
    problems: 15,
    duration: "30분",
    attempts: 0,
    status: "draft" as const,
  },
];

const statusMap = {
  active: { label: "진행중", variant: "default" as const },
  closed: { label: "마감", variant: "secondary" as const },
  draft: { label: "준비중", variant: "outline" as const },
};

export default function QuizzesPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">퀴즈 / 과제</h1>
          <p className="text-muted-foreground">
            문제은행에서 퀴즈와 과제를 생성합니다.
          </p>
        </div>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          새 퀴즈
        </Button>
      </div>

      <div className="space-y-3">
        {quizzes.map((quiz) => (
          <Card
            key={quiz.id}
            className="cursor-pointer transition-colors hover:border-brand-beige"
          >
            <CardContent className="flex items-center justify-between p-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <h3 className="font-medium">{quiz.title}</h3>
                  <Badge variant={statusMap[quiz.status].variant}>
                    {statusMap[quiz.status].label}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground">{quiz.course}</p>
              </div>
              <div className="flex items-center gap-6 text-sm text-muted-foreground">
                <span className="flex items-center gap-1">
                  <FileText className="h-3.5 w-3.5" />
                  {quiz.problems}문제
                </span>
                <span className="flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5" />
                  {quiz.duration}
                </span>
                <span className="flex items-center gap-1">
                  <Users className="h-3.5 w-3.5" />
                  {quiz.attempts}명 응시
                </span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
