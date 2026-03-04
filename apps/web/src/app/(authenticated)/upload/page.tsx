"use client";

import { useState, useCallback, useRef } from "react";
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

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/v1";

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB

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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollingRef = useRef<Map<string, ReturnType<typeof setInterval>>>(
    new Map(),
  );

  const updateFile = useCallback(
    (id: string, updates: Partial<UploadedFile>) => {
      setFiles((prev) =>
        prev.map((f) => (f.id === id ? { ...f, ...updates } : f)),
      );
    },
    [],
  );

  const pollStatus = useCallback(
    (uploadId: string, fileId: string) => {
      const token = localStorage.getItem("token");
      const interval = setInterval(async () => {
        try {
          const res = await fetch(`${API_URL}/files/${fileId}/status`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          });
          if (!res.ok) throw new Error("Status check failed");

          const data = (await res.json()) as {
            status: string;
            progress?: number;
          };

          if (data.status === "completed") {
            updateFile(uploadId, {
              status: "completed",
              progress: 100,
            });
            clearInterval(interval);
            pollingRef.current.delete(uploadId);
          } else if (data.status === "failed") {
            updateFile(uploadId, {
              status: "failed",
              error: "OCR 처리에 실패했습니다.",
            });
            clearInterval(interval);
            pollingRef.current.delete(uploadId);
          } else {
            updateFile(uploadId, {
              status: "processing",
              progress: data.progress ?? 50,
            });
          }
        } catch {
          // Silently retry on transient errors
        }
      }, 3000);

      pollingRef.current.set(uploadId, interval);
    },
    [updateFile],
  );

  const uploadFile = useCallback(
    (file: File) => {
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

      const xhr = new XMLHttpRequest();

      xhr.upload.addEventListener("progress", (e) => {
        if (e.lengthComputable) {
          const percent = Math.round((e.loaded / e.total) * 100);
          updateFile(id, { progress: percent });
        }
      });

      xhr.addEventListener("load", () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          let responseData: { id?: string; fileId?: string } = {};
          try {
            responseData = JSON.parse(xhr.responseText);
          } catch {
            // Response might not be JSON
          }
          const fileId = responseData.id ?? responseData.fileId;

          updateFile(id, {
            status: fileId ? "processing" : "completed",
            progress: fileId ? 50 : 100,
            fileId: fileId ?? undefined,
          });

          if (fileId) {
            pollStatus(id, fileId);
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
    [updateFile, pollStatus],
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

  const removeFile = (index: number) => {
    const file = files[index];
    // Cancel ongoing upload
    if (file.abortController && file.status === "uploading") {
      file.abortController.abort();
    }
    // Stop polling
    const interval = pollingRef.current.get(file.id);
    if (interval) {
      clearInterval(interval);
      pollingRef.current.delete(file.id);
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
        <CardContent className="p-0">
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
