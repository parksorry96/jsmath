import { Plus, Users, FileText } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const courses = [
  {
    id: 1,
    title: "고1 수학(상)",
    description: "다항식, 방정식과 부등식, 도형의 방정식",
    students: 32,
    problems: 284,
    status: "active" as const,
  },
  {
    id: 2,
    title: "고1 수학(하)",
    description: "집합과 명제, 함수, 경우의 수",
    students: 32,
    problems: 196,
    status: "active" as const,
  },
  {
    id: 3,
    title: "수학II",
    description: "함수의 극한과 연속, 미분, 적분",
    students: 28,
    problems: 412,
    status: "active" as const,
  },
  {
    id: 4,
    title: "확률과 통계",
    description: "순열과 조합, 확률, 통계",
    students: 24,
    problems: 178,
    status: "draft" as const,
  },
];

const statusMap = {
  active: { label: "진행중", variant: "default" as const },
  draft: { label: "준비중", variant: "secondary" as const },
};

export default function CoursesPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">강좌 관리</h1>
          <p className="text-muted-foreground">강좌를 생성하고 관리합니다.</p>
        </div>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          새 강좌
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {courses.map((course) => (
          <Card
            key={course.id}
            className="cursor-pointer transition-colors hover:border-brand-beige"
          >
            <CardContent className="p-5">
              <div className="flex items-start justify-between">
                <h3 className="font-semibold">{course.title}</h3>
                <Badge variant={statusMap[course.status].variant}>
                  {statusMap[course.status].label}
                </Badge>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                {course.description}
              </p>
              <div className="mt-4 flex items-center gap-4 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Users className="h-3 w-3" />
                  {course.students}명
                </span>
                <span className="flex items-center gap-1">
                  <FileText className="h-3 w-3" />
                  {course.problems}문제
                </span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
