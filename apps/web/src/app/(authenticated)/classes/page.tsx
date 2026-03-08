"use client";

import { useState } from "react";
import { Plus, Users, Trash2, AlertCircle } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface ClassItem {
  id: string;
  name: string;
  description: string | null;
  grade: number | null;
  status: string;
  _count?: {
    enrollments: number;
  };
}

interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

const statusMap: Record<
  string,
  { label: string; variant: "default" | "secondary" }
> = {
  active: { label: "진행중", variant: "default" },
  inactive: { label: "비활성", variant: "secondary" },
};

export default function ClassesPage() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [grade, setGrade] = useState("");

  const classesQuery = useQuery({
    queryKey: ["classes"],
    queryFn: () =>
      api.get<ClassItem[] | PaginatedResponse<ClassItem>>("/classes"),
  });

  const createMutation = useMutation({
    mutationFn: (body: { name: string; description?: string; grade?: number }) =>
      api.post("/classes", body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["classes"] });
      setOpen(false);
      setName("");
      setDescription("");
      setGrade("");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/classes/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["classes"] });
    },
  });

  const classes: ClassItem[] = classesQuery.data
    ? Array.isArray(classesQuery.data)
      ? classesQuery.data
      : classesQuery.data.data
    : [];

  const handleCreate = () => {
    if (!name.trim()) return;
    createMutation.mutate({
      name: name.trim(),
      description: description.trim() || undefined,
      grade: grade ? Number(grade) : undefined,
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">반 관리</h1>
          <p className="text-muted-foreground">반을 생성하고 관리합니다.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              새 반 만들기
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>새 반 만들기</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="space-y-2">
                <Label htmlFor="class-name">반 이름</Label>
                <Input
                  id="class-name"
                  placeholder="예: 고1-A반"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="class-desc">설명</Label>
                <Textarea
                  id="class-desc"
                  placeholder="반에 대한 설명 (선택)"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="class-grade">학년</Label>
                <Input
                  id="class-grade"
                  type="number"
                  min={1}
                  max={12}
                  placeholder="예: 10"
                  value={grade}
                  onChange={(e) => setGrade(e.target.value)}
                />
              </div>
              <Button
                className="w-full"
                onClick={handleCreate}
                disabled={!name.trim() || createMutation.isPending}
              >
                {createMutation.isPending ? "생성 중..." : "생성"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {classesQuery.isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-5 space-y-3">
                <Skeleton className="h-5 w-2/3" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-3 w-1/3" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : classesQuery.isError ? (
        <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
          <AlertCircle className="h-8 w-8" />
          <p className="text-sm">반 목록을 불러올 수 없습니다.</p>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => classesQuery.refetch()}
          >
            다시 시도
          </Button>
        </div>
      ) : classes.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
          <Users className="h-8 w-8" />
          <p className="text-sm">아직 등록된 반이 없습니다.</p>
          <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
            첫 반 만들기
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {classes.map((cls) => {
            const status = statusMap[cls.status] ?? {
              label: cls.status,
              variant: "secondary" as const,
            };
            return (
              <Card
                key={cls.id}
                className="cursor-pointer transition-colors hover:border-brand-beige"
              >
                <CardContent className="p-5">
                  <div className="flex items-start justify-between">
                    <h3 className="font-semibold">{cls.name}</h3>
                    <Badge variant={status.variant}>{status.label}</Badge>
                  </div>
                  {cls.description && (
                    <p className="mt-2 text-sm text-muted-foreground">
                      {cls.description}
                    </p>
                  )}
                  <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Users className="h-3 w-3" />
                      {cls._count?.enrollments ?? 0}명
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteMutation.mutate(cls.id);
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
