"use client";

import { useState } from "react";
import Link from "next/link";
import {
  FileText,
  Download,
  Trash2,
  Loader2,
  Inbox,
  AlertCircle,
  ArrowLeft,
  BookOpen,
  ClipboardList,
  Copy,
  Send,
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api } from "@/lib/api";

interface ExamDocument {
  id: string;
  title: string;
  type: "exam" | "workbook";
  status: "draft" | "generating" | "completed" | "failed";
  visibility: "private" | "public";
  pdfS3Key: string | null;
  answerPdfS3Key: string | null;
  errorMessage: string | null;
  createdAt: string;
  _count?: { problems: number };
  creator?: { id: string; name: string };
}

const TYPE_LABELS: Record<string, { label: string; icon: typeof FileText }> = {
  exam: { label: "시험지", icon: ClipboardList },
  workbook: { label: "교재", icon: BookOpen },
};

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  draft: { label: "초안", className: "bg-gray-900/30 text-gray-400 border-gray-400/30" },
  generating: { label: "생성 중", className: "bg-blue-900/30 text-blue-400 border-blue-400/30" },
  completed: { label: "완료", className: "bg-green-900/30 text-green-400 border-green-400/30" },
  failed: { label: "실패", className: "bg-red-900/30 text-red-400 border-red-400/30" },
};

function AssignFromExamDialog({
  doc,
  onClose,
}: {
  doc: ExamDocument;
  onClose: () => void;
}) {
  const [classId, setClassId] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [attachPdf, setAttachPdf] = useState(false);
  const queryClient = useQueryClient();

  const { data: classes } = useQuery({
    queryKey: ["classes"],
    queryFn: () => api.get<Array<{ id: string; title: string }>>("/classes"),
  });

  const assignMutation = useMutation({
    mutationFn: () =>
      api.post(`/exam-documents/${doc.id}/assign`, {
        classId,
        title: doc.title,
        dueAt: dueAt || undefined,
        attachPdf,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["assignments"] });
      onClose();
    },
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>과제로 출제</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <p className="text-sm text-muted-foreground">
            &ldquo;{doc.title}&rdquo; ({doc._count?.problems ?? 0}문제)
          </p>

          <div>
            <label className="text-sm font-medium">반 선택</label>
            <select
              className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
              value={classId}
              onChange={(e) => setClassId(e.target.value)}
            >
              <option value="">선택하세요</option>
              {classes?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-sm font-medium">마감일 (선택)</label>
            <input
              type="datetime-local"
              className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
            />
          </div>

          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={attachPdf}
              onChange={(e) => setAttachPdf(e.target.checked)}
            />
            <span className="text-sm">학생에게 PDF 첨부</span>
          </label>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            취소
          </Button>
          <Button
            onClick={() => assignMutation.mutate()}
            disabled={!classId || assignMutation.isPending}
          >
            {assignMutation.isPending && (
              <Loader2 className="h-4 w-4 animate-spin mr-1" />
            )}
            출제
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function ExamDocumentHistoryPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"mine" | "shared">("mine");
  const [assignTarget, setAssignTarget] = useState<ExamDocument | null>(null);

  const { data: documents, isLoading, isError } = useQuery({
    queryKey: ["exam-documents", tab],
    queryFn: () => api.get<ExamDocument[]>(`/exam-documents?scope=${tab}`),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/exam-documents/${id}`),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["exam-documents"] }),
  });

  const duplicateMutation = useMutation({
    mutationFn: (id: string) => api.post(`/exam-documents/${id}/duplicate`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["exam-documents"] });
      setTab("mine");
    },
  });

  const handleDownload = async (id: string, type: "pdf" | "answer") => {
    const result = await api.get<{ url: string }>(
      `/exam-documents/${id}/download?type=${type}`,
    );
    window.open(result.url, "_blank");
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <Link href="/exam-builder">
              <Button variant="ghost" size="sm">
                <ArrowLeft className="h-4 w-4 mr-1" />
                돌아가기
              </Button>
            </Link>
          </div>
          <h1 className="text-2xl font-bold tracking-tight">제작 내역</h1>
          <p className="text-muted-foreground">
            시험지와 교재를 관리하고 과제로 출제하세요.
          </p>
        </div>
        <Link href="/exam-builder">
          <Button>
            <FileText className="h-4 w-4 mr-2" />
            새로 만들기
          </Button>
        </Link>
      </div>

      <div className="flex gap-1 rounded-lg bg-muted p-1">
        <button
          className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
            tab === "mine"
              ? "bg-background shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => setTab("mine")}
        >
          내 시험지
        </button>
        <button
          className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
            tab === "shared"
              ? "bg-background shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => setTab("shared")}
        >
          공유된 시험지
        </button>
      </div>

      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-[80px] rounded-xl" />
          ))}
        </div>
      )}

      {isError && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <AlertCircle className="h-12 w-12 text-destructive" />
            <p className="mt-4 text-lg font-medium">
              목록을 불러오지 못했습니다
            </p>
          </CardContent>
        </Card>
      )}

      {!isLoading && !isError && documents?.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-20">
            <Inbox className="h-16 w-16 text-muted-foreground" />
            <p className="mt-4 text-lg font-medium">
              {tab === "mine"
                ? "제작 내역이 없습니다"
                : "공유된 시험지가 없습니다"}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {tab === "mine"
                ? "시험지나 교재를 만들어보세요."
                : "같은 학원의 선생님이 공개한 시험지가 여기에 표시됩니다."}
            </p>
          </CardContent>
        </Card>
      )}

      {!isLoading && !isError && documents && documents.length > 0 && (
        <div className="space-y-2">
          {documents.map((doc) => {
            const typeInfo = TYPE_LABELS[doc.type] ?? TYPE_LABELS.exam;
            const statusInfo =
              STATUS_CONFIG[doc.status] ?? STATUS_CONFIG.draft;
            const TypeIcon = typeInfo.icon;

            return (
              <Card
                key={doc.id}
                className="transition-colors hover:border-brand-beige"
              >
                <CardContent className="flex items-center gap-4 p-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-dark text-brand-beige">
                    <TypeIcon className="h-5 w-5" />
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{doc.title}</p>
                    <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{typeInfo.label}</span>
                      {doc._count && (
                        <>
                          <span>&middot;</span>
                          <span>문제 {doc._count.problems}개</span>
                        </>
                      )}
                      <span>&middot;</span>
                      <span>
                        {new Date(doc.createdAt).toLocaleDateString("ko-KR")}
                      </span>
                      {tab === "shared" && doc.creator && (
                        <>
                          <span>&middot;</span>
                          <span>{doc.creator.name}</span>
                        </>
                      )}
                    </div>
                    {doc.status === "failed" && doc.errorMessage && (
                      <p className="mt-1 text-xs text-red-400 truncate">
                        {doc.errorMessage}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className={`rounded-full border px-2 py-0.5 text-xs font-medium ${statusInfo.className}`}
                    >
                      {doc.status === "generating" && (
                        <Loader2 className="inline h-3 w-3 mr-1 animate-spin" />
                      )}
                      {statusInfo.label}
                    </span>

                    {tab === "mine" && doc.status === "completed" && (
                      <>
                        {doc.pdfS3Key && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDownload(doc.id, "pdf")}
                          >
                            <Download className="h-4 w-4 mr-1" />
                            PDF
                          </Button>
                        )}
                        {doc.answerPdfS3Key && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDownload(doc.id, "answer")}
                          >
                            <Download className="h-4 w-4 mr-1" />
                            해설지
                          </Button>
                        )}
                      </>
                    )}

                    {tab === "shared" && doc.status === "completed" && (
                      <>
                        {doc.pdfS3Key && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDownload(doc.id, "pdf")}
                          >
                            <Download className="h-4 w-4 mr-1" />
                            PDF
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => duplicateMutation.mutate(doc.id)}
                          disabled={duplicateMutation.isPending}
                        >
                          <Copy className="h-4 w-4 mr-1" />
                          복제
                        </Button>
                      </>
                    )}

                    {doc.status === "completed" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setAssignTarget(doc)}
                      >
                        <Send className="h-4 w-4 mr-1" />
                        과제 출제
                      </Button>
                    )}

                    {tab === "mine" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => {
                          if (confirm("정말 삭제하시겠습니까?")) {
                            deleteMutation.mutate(doc.id);
                          }
                        }}
                        disabled={deleteMutation.isPending}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {assignTarget && (
        <AssignFromExamDialog
          doc={assignTarget}
          onClose={() => setAssignTarget(null)}
        />
      )}
    </div>
  );
}
