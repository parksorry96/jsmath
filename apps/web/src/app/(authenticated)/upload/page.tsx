"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import {
  Upload,
  FileUp,
  X,
  FileText,
  CheckCircle2,
  AlertCircle,
  Loader2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/v1";

const MAX_FILE_SIZE = 300 * 1024 * 1024; // 300MB

type UploadStatus =
  | "pending"
  | "uploading"
  | "processing"
  | "completed"
  | "failed";

interface UploadedFile {
  id: string;
  name: string;
  size: number;
  status: UploadStatus;
  progress: number;
  error?: string;
  fileId?: string;
  abortController?: AbortController;
}

const statusLabel: Record<UploadStatus, string> = {
  pending: "대기",
  uploading: "업로드중",
  processing: "처리중",
  completed: "완료",
  failed: "실패",
};

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

let fileIdCounter = 0;

export default function UploadPage() {
  const [isDragging, setIsDragging] = useState(false);
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [documentType, setDocumentType] = useState<'exam' | 'textbook'>('exam');
  const [bookTitle, setBookTitle] = useState('');
  const [publisher, setPublisher] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sseRef = useRef<Map<string, EventSource>>(new Map());
  const reconnectTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const updateFile = useCallback(
    (id: string, updates: Partial<UploadedFile>) => {
      setFiles((prev) =>
        prev.map((f) => (f.id === id ? { ...f, ...updates } : f)),
      );
    },
    [],
  );

  const startSSE = useCallback(
    (uploadId: string, jobId: string) => {
      // Close existing connection for this upload if any
      const existing = sseRef.current.get(uploadId);
      if (existing) existing.close();

      const stageProgress: Record<string, number> = documentType === 'textbook'
        ? {
            ocr_submit: 15, ocr_processing: 30, parsing: 45,
            detect_sections: 55, segmentation: 65, answer_matching: 75,
            ocr_complete: 80, analyzing: 90, analysis_complete: 100,
          }
        : {
            ocr_submit: 25, ocr_processing: 40, parsing: 55,
            segmentation: 65, ocr_complete: 70, analyzing: 85,
            analysis_complete: 100,
          };

      let reconnectDelay = 1000;

      function connect() {
        const es = new EventSource(`${API_URL}/files/${jobId}/events`);
        sseRef.current.set(uploadId, es);

        es.addEventListener("progress", (e) => {
          try {
            const data = JSON.parse(e.data) as {
              stage: string;
              current: number;
              total: number;
              message: string;
            };

            reconnectDelay = 1000; // reset on success
            const percent = stageProgress[data.stage] ?? 50;

            if (data.stage === "analysis_complete") {
              updateFile(uploadId, { status: "completed", progress: 100 });
              toast.success("분석 완료! 검수 페이지에서 확인하세요.");
              es.close();
              sseRef.current.delete(uploadId);
            } else {
              updateFile(uploadId, { status: "processing", progress: percent });
            }
          } catch {
            // Ignore parse errors
          }
        });

        es.onerror = () => {
          es.close();
          sseRef.current.delete(uploadId);
          // Auto-reconnect with backoff (up to 10s)
          const timer = setTimeout(() => {
            reconnectDelay = Math.min(reconnectDelay * 2, 10_000);
            connect();
          }, reconnectDelay);
          reconnectTimers.current.set(uploadId, timer);
        };
      }

      connect();
    },
    [updateFile, documentType],
  );

  const uploadFile = useCallback(
    (file: File) => {
      if (documentType === 'textbook' && !bookTitle.trim()) {
        toast.error('교재 제목을 입력해주세요');
        return;
      }

      const id = `upload-${++fileIdCounter}`;
      const abortController = new AbortController();

      const entry: UploadedFile = {
        id,
        name: file.name,
        size: file.size,
        status: "uploading",
        progress: 0,
        abortController,
      };

      setFiles((prev) => [entry, ...prev]);

      const token = localStorage.getItem("token");
      const formData = new FormData();
      formData.append("file", file);
      formData.append('document_type', documentType);
      if (documentType === 'textbook') {
        formData.append('book_title', bookTitle);
        if (publisher) formData.append('publisher', publisher);
      }

      const xhr = new XMLHttpRequest();

      xhr.upload.addEventListener("progress", (e) => {
        if (e.lengthComputable) {
          const percent = Math.round((e.loaded / e.total) * 100);
          updateFile(id, { progress: percent });
        }
      });

      xhr.addEventListener("load", () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          let responseData: {
            id?: string;
            jobId?: string;
            fileId?: string;
          } = {};
          try {
            responseData = JSON.parse(xhr.responseText);
          } catch {
            // Response might not be JSON
          }
          const jobId = responseData.jobId;
          const fileId = responseData.id ?? responseData.fileId;

          updateFile(id, {
            status: jobId ? "processing" : "completed",
            progress: jobId ? 25 : 100,
            fileId: fileId ?? undefined,
          });

          if (jobId) {
            startSSE(id, jobId);
          }
        } else {
          let errorMsg = "업로드에 실패했습니다.";
          try {
            const body = JSON.parse(xhr.responseText);
            if (body.message) errorMsg = body.message;
          } catch {
            // Use default error
          }
          updateFile(id, {
            status: "failed",
            error: errorMsg,
          });
        }
      });

      xhr.addEventListener("error", () => {
        updateFile(id, {
          status: "failed",
          error: "네트워크 오류가 발생했습니다.",
        });
      });

      xhr.addEventListener("abort", () => {
        updateFile(id, {
          status: "failed",
          error: "업로드가 취소되었습니다.",
        });
      });

      abortController.signal.addEventListener("abort", () => {
        xhr.abort();
      });

      xhr.open("POST", `${API_URL}/files/pdf`);
      if (token) {
        xhr.setRequestHeader("Authorization", `Bearer ${token}`);
      }
      xhr.send(formData);
    },
    [updateFile, startSSE, documentType, bookTitle, publisher],
  );

  const processFiles = useCallback(
    (fileList: FileList | null) => {
      if (!fileList) return;

      Array.from(fileList).forEach((file) => {
        if (file.type !== "application/pdf") {
          const id = `upload-${++fileIdCounter}`;
          setFiles((prev) => [
            {
              id,
              name: file.name,
              size: file.size,
              status: "failed",
              progress: 0,
              error: "PDF 파일만 업로드할 수 있습니다.",
            },
            ...prev,
          ]);
          return;
        }

        if (file.size > MAX_FILE_SIZE) {
          const id = `upload-${++fileIdCounter}`;
          setFiles((prev) => [
            {
              id,
              name: file.name,
              size: file.size,
              status: "failed",
              progress: 0,
              error: "파일 크기가 100MB를 초과합니다.",
            },
            ...prev,
          ]);
          return;
        }

        uploadFile(file);
      });
    },
    [uploadFile],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      processFiles(e.dataTransfer.files);
    },
    [processFiles],
  );

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      processFiles(e.target.files);
      // Reset input so the same file can be selected again
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    },
    [processFiles],
  );

  // Restore in-progress jobs on page mount
  useEffect(() => {
    const token = localStorage.getItem("token");
    fetch(`${API_URL}/files`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((res) => res.json())
      .then((data: Array<{
        id: string;
        filename: string;
        ocrJobId: string | null;
        ocrStatus: string | null;
        problemCount: number;
        documentType: string;
      }>) => {
        const inProgress = data.filter(
          (f) => f.ocrStatus === "pending" || f.ocrStatus === "processing",
        );
        if (inProgress.length === 0) return;

        const restored: UploadedFile[] = inProgress.map((f) => ({
          id: `restored-${f.ocrJobId ?? f.id}`,
          name: f.filename,
          size: 0,
          status: "processing" as UploadStatus,
          progress: 30,
          fileId: f.id,
        }));

        setFiles((prev) => {
          const existingIds = new Set(prev.map((p) => p.fileId));
          const newOnes = restored.filter((r) => !existingIds.has(r.fileId));
          return [...newOnes, ...prev];
        });

        for (const f of inProgress) {
          if (f.ocrJobId) {
            startSSE(`restored-${f.ocrJobId}`, f.ocrJobId);
          }
        }
      })
      .catch(() => {
        // Silently ignore — non-critical
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const removeFile = (index: number) => {
    const file = files[index];
    // Cancel ongoing upload
    if (file.abortController && file.status === "uploading") {
      file.abortController.abort();
    }
    // Close SSE connection
    const es = sseRef.current.get(file.id);
    if (es) {
      es.close();
      sseRef.current.delete(file.id);
    }
    // Clear reconnect timer
    const timer = reconnectTimers.current.get(file.id);
    if (timer) {
      clearTimeout(timer);
      reconnectTimers.current.delete(file.id);
    }
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">PDF 업로드</h1>
        <p className="text-muted-foreground">
          수학 교재 PDF를 업로드하면 자동으로 문제를 추출합니다.
        </p>
      </div>

      <Card>
        <CardContent className="p-6">
          <div className="flex gap-4 mb-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="radio" name="docType" value="exam"
                checked={documentType === 'exam'}
                onChange={() => setDocumentType('exam')}
                className="accent-[#DFD0B8]" />
              <span className="text-sm font-medium">시험지</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="radio" name="docType" value="textbook"
                checked={documentType === 'textbook'}
                onChange={() => setDocumentType('textbook')}
                className="accent-[#DFD0B8]" />
              <span className="text-sm font-medium">교재</span>
            </label>
          </div>

          {documentType === 'textbook' && (
            <div className="space-y-3 mb-4">
              <input
                type="text"
                placeholder="책 제목 (필수)"
                value={bookTitle}
                onChange={e => setBookTitle(e.target.value)}
                className="w-full px-3 py-2 border border-border rounded-lg bg-brand-charcoal text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-brand-beige focus:border-brand-beige"
              />
              <input
                type="text"
                placeholder="출판사 (선택)"
                value={publisher}
                onChange={e => setPublisher(e.target.value)}
                className="w-full px-3 py-2 border border-border rounded-lg bg-brand-charcoal text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-brand-beige focus:border-brand-beige"
              />
            </div>
          )}

          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-12 transition-colors ${
              isDragging
                ? "border-brand-beige bg-brand-beige/5"
                : "border-border hover:border-brand-warm"
            }`}
          >
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-brand-charcoal">
              <Upload className="h-8 w-8 text-brand-beige" />
            </div>
            <p className="mt-4 text-lg font-medium">
              PDF 파일을 드래그하여 놓으세요
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              또는 아래 버튼을 클릭하여 파일을 선택하세요
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf"
              multiple
              className="hidden"
              onChange={handleFileInputChange}
            />
            <Button
              className="mt-4"
              onClick={() => fileInputRef.current?.click()}
            >
              <FileUp className="mr-2 h-4 w-4" />
              파일 선택
            </Button>
            <p className="mt-3 text-xs text-muted-foreground">
              PDF 파일만 가능 (최대 100MB)
            </p>
          </div>
        </CardContent>
      </Card>

      {files.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">업로드 현황</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {files.map((file, index) => (
              <div
                key={file.id}
                className="flex items-center gap-3 rounded-lg border border-border p-3"
              >
                <FileText className="h-8 w-8 shrink-0 text-brand-beige" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between">
                    <p className="truncate text-sm font-medium">{file.name}</p>
                    <div className="flex items-center gap-2">
                      {file.status === "completed" ? (
                        <CheckCircle2 className="h-4 w-4 text-green-400" />
                      ) : file.status === "failed" ? (
                        <AlertCircle className="h-4 w-4 text-destructive" />
                      ) : file.status === "uploading" ? (
                        <Badge variant="secondary">{file.progress}%</Badge>
                      ) : file.status === "processing" ? (
                        <Loader2 className="h-4 w-4 animate-spin text-brand-beige" />
                      ) : null}
                      <button
                        onClick={() => removeFile(index)}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <p className="text-xs text-muted-foreground">
                      {formatFileSize(file.size)}
                    </p>
                    <span className="text-xs text-muted-foreground">
                      {statusLabel[file.status]}
                    </span>
                  </div>
                  {file.error && (
                    <p className="mt-1 text-xs text-destructive">{file.error}</p>
                  )}
                  {file.status !== "completed" && file.status !== "failed" && (
                    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-brand-dark">
                      <div
                        className="h-full rounded-full bg-brand-beige transition-all"
                        style={{ width: `${file.progress}%` }}
                      />
                    </div>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
