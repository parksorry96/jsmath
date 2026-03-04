import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Activity,
  Zap,
  Clock,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";

const pipelineStats = [
  {
    title: "오늘 처리",
    value: "47",
    unit: "건",
    icon: Activity,
    change: "+12% vs 어제",
  },
  {
    title: "평균 처리시간",
    value: "2.4",
    unit: "분/페이지",
    icon: Clock,
    change: "-8% vs 지난주",
  },
  {
    title: "성공률",
    value: "96.2",
    unit: "%",
    icon: CheckCircle2,
    change: "+0.5% vs 지난주",
  },
  {
    title: "Mathpix 비용",
    value: "₩12,400",
    unit: "오늘",
    icon: Zap,
    change: "월 누적 ₩284,000",
  },
];

const recentJobs = [
  {
    id: "OCR-0047",
    file: "고1_수학상_중간고사.pdf",
    pages: 48,
    problems: 142,
    status: "completed" as const,
    duration: "4분 12초",
  },
  {
    id: "OCR-0046",
    file: "수학II_기말범위.pdf",
    pages: 36,
    problems: null,
    status: "processing" as const,
    duration: "진행중...",
  },
  {
    id: "OCR-0045",
    file: "확률과통계_모의고사.pdf",
    pages: 12,
    problems: 35,
    status: "review" as const,
    duration: "1분 48초",
  },
  {
    id: "OCR-0044",
    file: "미적분_단원평가.pdf",
    pages: 8,
    problems: 24,
    status: "completed" as const,
    duration: "52초",
  },
  {
    id: "OCR-0043",
    file: "기하_교재_ch3.pdf",
    pages: 22,
    problems: null,
    status: "failed" as const,
    duration: "실패",
  },
];

const statusMap = {
  completed: { label: "완료", color: "text-green-400" },
  processing: { label: "처리중", color: "text-yellow-400" },
  review: { label: "검수필요", color: "text-brand-beige" },
  failed: { label: "실패", color: "text-red-400" },
};

export default function AnalyticsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">OCR 현황</h1>
        <p className="text-muted-foreground">
          OCR 파이프라인 처리 현황 및 비용을 모니터링합니다.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {pipelineStats.map((stat) => (
          <Card key={stat.title}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {stat.title}
              </CardTitle>
              <stat.icon className="h-4 w-4 text-brand-beige" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {stat.value}
                <span className="text-sm font-normal text-muted-foreground ml-1">
                  {stat.unit}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">{stat.change}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">최근 OCR 작업</CardTitle>
          <Badge variant="outline" className="font-mono text-xs">
            <Activity className="mr-1 h-3 w-3" />
            실시간
          </Badge>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {recentJobs.map((job) => (
              <div
                key={job.id}
                className="flex items-center justify-between rounded-lg border border-border p-3"
              >
                <div className="flex items-center gap-3">
                  <span className="font-mono text-xs text-muted-foreground">
                    {job.id}
                  </span>
                  <div>
                    <p className="text-sm font-medium">{job.file}</p>
                    <p className="text-xs text-muted-foreground">
                      {job.pages}p
                      {job.problems && ` / ${job.problems}문제`}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground">
                    {job.duration}
                  </span>
                  <span
                    className={`text-xs font-medium ${statusMap[job.status].color}`}
                  >
                    {job.status === "failed" && (
                      <AlertTriangle className="mr-1 inline h-3 w-3" />
                    )}
                    {statusMap[job.status].label}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
