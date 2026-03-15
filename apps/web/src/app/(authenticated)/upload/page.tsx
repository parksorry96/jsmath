"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  FileText,
  FileUp,
  Loader2,
  Upload,
  X,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import { streamSse } from "@/lib/sse";
import { toast } from "sonner";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/v1";
const MULTIPART_UPLOAD_CONCURRENCY = 4;

type DocumentType = "exam" | "textbook";
type UploadRole = "exam" | "textbook_problem" | "textbook_answer";
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
  documentType: DocumentType;
  autoAnalyze: boolean;
  status: UploadStatus;
  progress: number;
  error?: string;
  fileId?: string;
  abortController?: AbortController;
  stage?: string;
  stageMessage?: string;
  stageCurrent?: number;
  stageTotal?: number;
}

interface MultipartInitResponse {
  key: string;
  uploadId: string;
  partSize: number;
  partCount: number;
}

interface MultipartUrlsResponse {
  urls: Array<{ partNumber: number; url: string }>;
}

interface UploadRegisterResponse {
  id?: string;
  jobId?: string;
  fileId?: string;
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

function isPdfFile(file: File): boolean {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function getStageProgress(documentType: DocumentType): Record<string, number> {
  if (documentType === "textbook") {
    return {
      ocr_submit: 15,
      ocr_processing: 30,
      parsing: 45,
      detect_sections: 55,
      segmentation: 65,
      answer_matching: 75,
      ocr_complete: 80,
      analyzing: 90,
      analysis_complete: 100,
    };
  }

  return {
    ocr_submit: 25,
    ocr_processing: 40,
    parsing: 55,
    segmentation: 65,
    ocr_complete: 70,
    analyzing: 85,
    analysis_complete: 100,
  };
}

function getStageRanges(documentType: DocumentType): Record<string, [number, number]> {
  if (documentType === "textbook") {
    return {
      ocr_submit: [0, 15],
      ocr_processing: [15, 30],
      parsing: [30, 45],
      detect_sections: [45, 55],
      segmentation: [55, 70],
      answer_matching: [70, 80],
      ocr_complete: [80, 85],
      analyzing: [85, 98],
      analysis_complete: [100, 100],
    };
  }

  return {
    ocr_submit: [0, 25],
    ocr_processing: [25, 40],
    parsing: [40, 55],
    segmentation: [55, 70],
    ocr_complete: [70, 80],
    analyzing: [80, 98],
    analysis_complete: [100, 100],
  };
}

function getProgressFromStage(args: {
  documentType: DocumentType;
  stage: string;
  current?: number;
  total?: number;
}) {
  const { documentType, stage, current = 0, total = 0 } = args;
  const ranges = getStageRanges(documentType);
  const range = ranges[stage];
  if (!range) {
    return getStageProgress(documentType)[stage] ?? 50;
  }

  const [start, end] = range;
  if (stage === "analysis_complete") {
    return 100;
  }
  if (total > 0 && current >= 0) {
    const ratio = Math.max(0, Math.min(1, current / total));
    return Math.round(start + (end - start) * ratio);
  }

  return end;
}

function formatTextbookUploadName(problemFile: File, answerFile?: File | null) {
  if (!answerFile) {
    return problemFile.name;
  }

  return `${problemFile.name} + ${answerFile.name}`;
}

function uploadPart(args: {
  url: string;
  blob: Blob;
  signal: AbortSignal;
  onProgress: (loaded: number) => void;
}): Promise<string> {
  const { url, blob, signal, onProgress } = args;

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let settled = false;

    const finalize = (callback: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", abortRequest);
      callback();
    };

    const abortRequest = () => {
      xhr.abort();
    };

    signal.addEventListener("abort", abortRequest, { once: true });

    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) {
        onProgress(event.loaded);
      }
    });

    xhr.addEventListener("load", () => {
      finalize(() => {
        if (xhr.status < 200 || xhr.status >= 300) {
          reject(new Error(`Part upload failed (${xhr.status})`));
          return;
        }

        onProgress(blob.size);
        const etag = xhr.getResponseHeader("ETag") ?? xhr.getResponseHeader("etag");
        if (!etag) {
          reject(new Error("Missing ETag from S3 upload"));
          return;
        }

        resolve(etag);
      });
    });

    xhr.addEventListener("error", () => {
      finalize(() => {
        reject(new Error("Part upload failed"));
      });
    });

    xhr.addEventListener("abort", () => {
      finalize(() => {
        reject(new DOMException("Upload aborted", "AbortError"));
      });
    });

    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", "application/pdf");
    xhr.send(blob);
  });
}

async function uploadMultipartPdf(args: {
  file: File;
  role: UploadRole;
  signal: AbortSignal;
  onProgress: (loaded: number, total: number) => void;
}) {
  const { file, role, signal, onProgress } = args;
  const init = await api.post<MultipartInitResponse>(
    "/files/uploads/multipart/initiate",
    {
      filename: file.name,
      size: file.size,
      role,
      contentType: file.type || "application/pdf",
    },
  );

  let completed = false;

  try {
    const partNumbers = Array.from(
      { length: init.partCount },
      (_value, index) => index + 1,
    );
    const { urls } = await api.post<MultipartUrlsResponse>(
      "/files/uploads/multipart/urls",
      {
        key: init.key,
        uploadId: init.uploadId,
        partNumbers,
      },
    );

    const uploadedBytesByPart = new Map<number, number>();
    let totalUploadedBytes = 0;
    const completedParts: Array<{ partNumber: number; etag: string }> = [];
    let cursor = 0;

    const uploadNextPart = async () => {
      while (cursor < urls.length) {
        const currentIndex = cursor;
        cursor += 1;
        const currentPart = urls[currentIndex];
        const start = (currentPart.partNumber - 1) * init.partSize;
        const end = Math.min(start + init.partSize, file.size);
        const blob = file.slice(start, end);

        const etag = await uploadPart({
          url: currentPart.url,
          blob,
          signal,
          onProgress: (loaded) => {
            const previousLoaded =
              uploadedBytesByPart.get(currentPart.partNumber) ?? 0;
            uploadedBytesByPart.set(currentPart.partNumber, loaded);
            totalUploadedBytes += loaded - previousLoaded;
            onProgress(Math.min(totalUploadedBytes, file.size), file.size);
          },
        });

        completedParts.push({
          partNumber: currentPart.partNumber,
          etag,
        });
      }
    };

    await Promise.all(
      Array.from(
        { length: Math.min(MULTIPART_UPLOAD_CONCURRENCY, urls.length) },
        () => uploadNextPart(),
      ),
    );

    await api.post("/files/uploads/multipart/complete", {
      key: init.key,
      uploadId: init.uploadId,
      parts: completedParts,
    });
    completed = true;
    onProgress(file.size, file.size);

    return {
      key: init.key,
      filename: file.name,
      size: file.size,
    };
  } catch (error) {
    if (!completed) {
      void api
        .post("/files/uploads/multipart/abort", {
          key: init.key,
          uploadId: init.uploadId,
        })
        .catch(() => undefined);
    }
    throw error;
  }
}

let fileIdCounter = 0;

export default function UploadPage() {
  const [isDragging, setIsDragging] = useState(false);
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [documentType, setDocumentType] = useState<DocumentType>("exam");
  const [autoAnalyze, setAutoAnalyze] = useState(false);
  const [bookTitle, setBookTitle] = useState("");
  const [publisher, setPublisher] = useState("");
  const [textbookProblemFile, setTextbookProblemFile] = useState<File | null>(null);
  const [textbookAnswerFile, setTextbookAnswerFile] = useState<File | null>(null);
  const examFileInputRef = useRef<HTMLInputElement>(null);
  const problemFileInputRef = useRef<HTMLInputElement>(null);
  const answerFileInputRef = useRef<HTMLInputElement>(null);
  const streamControllers = useRef<Map<string, AbortController>>(new Map());
  const reconnectTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const updateFile = useCallback(
    (id: string, updates: Partial<UploadedFile>) => {
      setFiles((prev) => prev.map((file) => (file.id === id ? { ...file, ...updates } : file)));
    },
    [],
  );

  const startSSE = useCallback(
    (
      uploadId: string,
      jobId: string,
      uploadDocumentType: DocumentType,
      uploadAutoAnalyze: boolean,
    ) => {
      const token = localStorage.getItem("token");
      if (!token) {
        updateFile(uploadId, {
          status: "failed",
          error: "로그인이 필요합니다. 다시 로그인해주세요.",
        });
        return;
      }

      const existing = streamControllers.current.get(uploadId);
      if (existing) {
        existing.abort();
        streamControllers.current.delete(uploadId);
      }

      const timer = reconnectTimers.current.get(uploadId);
      if (timer) {
        clearTimeout(timer);
        reconnectTimers.current.delete(uploadId);
      }

      let reconnectDelay = 1000;

      const connect = () => {
        const controller = new AbortController();
        streamControllers.current.set(uploadId, controller);

        void streamSse({
          url: `${API_URL}/files/${jobId}/events`,
          token,
          signal: controller.signal,
          onOpen: () => {
            reconnectDelay = 1000;
          },
          onMessage: (message) => {
            if (message.event !== "progress") {
              return;
            }

            try {
              const data = JSON.parse(message.data) as {
                stage: string;
                current: number;
                total: number;
                message: string;
              };

              const percent = getProgressFromStage({
                documentType: uploadDocumentType,
                stage: data.stage,
                current: data.current,
                total: data.total,
              });

              if (data.stage === "analysis_complete") {
                updateFile(uploadId, {
                  status: "completed",
                  progress: 100,
                  stage: data.stage,
                  stageMessage: data.message,
                  stageCurrent: data.current,
                  stageTotal: data.total,
                });
                toast.success("분석 완료! 검수 페이지에서 확인하세요.");
                controller.abort();
                if (streamControllers.current.get(uploadId) === controller) {
                  streamControllers.current.delete(uploadId);
                }
                return;
              }

              if (data.stage === "ocr_complete" && !uploadAutoAnalyze) {
                updateFile(uploadId, {
                  status: "completed",
                  progress: 100,
                  stage: data.stage,
                  stageMessage: data.message,
                  stageCurrent: data.current,
                  stageTotal: data.total,
                });
                toast.success("OCR 완료! 검수 페이지에서 확인하세요.");
                controller.abort();
                if (streamControllers.current.get(uploadId) === controller) {
                  streamControllers.current.delete(uploadId);
                }
                return;
              }

              updateFile(uploadId, {
                status: "processing",
                progress: percent,
                stage: data.stage,
                stageMessage: data.message,
                stageCurrent: data.current,
                stageTotal: data.total,
              });
            } catch {
              // Ignore malformed SSE payloads.
            }
          },
        }).catch(() => {
          if (controller.signal.aborted) {
            return;
          }

          if (streamControllers.current.get(uploadId) === controller) {
            streamControllers.current.delete(uploadId);
          }

          const reconnectTimer = setTimeout(() => {
            reconnectDelay = Math.min(reconnectDelay * 2, 10_000);
            connect();
          }, reconnectDelay);
          reconnectTimers.current.set(uploadId, reconnectTimer);
        });
      };

      connect();
    },
    [updateFile],
  );

  useEffect(() => {
    return () => {
      for (const controller of streamControllers.current.values()) {
        controller.abort();
      }
      streamControllers.current.clear();

      for (const timer of reconnectTimers.current.values()) {
        clearTimeout(timer);
      }
      reconnectTimers.current.clear();
    };
  }, []);

  const createUploadEntry = useCallback(
    (
      name: string,
      size: number,
      uploadDocumentType: DocumentType,
      uploadAutoAnalyze: boolean,
    ) => {
      const id = `upload-${++fileIdCounter}`;
      const abortController = new AbortController();

      setFiles((prev) => [
        {
          id,
          name,
          size,
          documentType: uploadDocumentType,
          autoAnalyze: uploadAutoAnalyze,
          status: "uploading",
          progress: 0,
          abortController,
        },
        ...prev,
      ]);

      return { id, abortController };
    },
    [],
  );

  const handleRegisteredUpload = useCallback(
    (
      uploadId: string,
      response: UploadRegisterResponse,
      uploadDocumentType: DocumentType,
      uploadAutoAnalyze: boolean,
    ) => {
      const jobId = response.jobId;
      const fileId = response.id ?? response.fileId;

      updateFile(uploadId, {
        status: jobId ? "processing" : "completed",
        progress: jobId ? 25 : 100,
        fileId: fileId ?? undefined,
      });

      if (jobId) {
        startSSE(uploadId, jobId, uploadDocumentType, uploadAutoAnalyze);
      }
    },
    [startSSE, updateFile],
  );

  const uploadExamFile = useCallback(
    (file: File) => {
      const { id, abortController } = createUploadEntry(
        file.name,
        file.size,
        "exam",
        autoAnalyze,
      );

      void (async () => {
        try {
          const uploaded = await uploadMultipartPdf({
            file,
            role: "exam",
            signal: abortController.signal,
            onProgress: (loaded, total) => {
              updateFile(id, {
                progress: Math.round((loaded / total) * 100),
              });
            },
          });

          const response = await api.post<UploadRegisterResponse>("/files/pdf/register", {
            key: uploaded.key,
            filename: uploaded.filename,
            size: uploaded.size,
            document_type: "exam",
            auto_analyze: autoAnalyze,
          });

          handleRegisteredUpload(id, response, "exam", autoAnalyze);
        } catch (error) {
          updateFile(id, {
            status: "failed",
            error: isAbortError(error)
              ? "업로드가 취소되었습니다."
              : error instanceof Error
                ? error.message
                : "업로드에 실패했습니다.",
          });
        }
      })();
    },
    [autoAnalyze, createUploadEntry, handleRegisteredUpload, updateFile],
  );

  const uploadTextbookFiles = useCallback(() => {
    if (!bookTitle.trim()) {
      toast.error("교재 제목을 입력해주세요");
      return;
    }

    if (!textbookProblemFile) {
      toast.error("문제집 PDF를 선택해주세요");
      return;
    }

    const totalSize = textbookProblemFile.size + (textbookAnswerFile?.size ?? 0);
    const { id, abortController } = createUploadEntry(
      formatTextbookUploadName(textbookProblemFile, textbookAnswerFile),
      totalSize,
      "textbook",
      autoAnalyze,
    );

    void (async () => {
      let problemLoaded = 0;
      let answerLoaded = 0;
      const reportCombinedProgress = () => {
        updateFile(id, {
          progress: Math.round(
            ((problemLoaded + answerLoaded) / Math.max(totalSize, 1)) * 100,
          ),
        });
      };

      try {
        const uploadedProblem = await uploadMultipartPdf({
          file: textbookProblemFile,
          role: "textbook_problem",
          signal: abortController.signal,
          onProgress: (loaded) => {
            problemLoaded = loaded;
            reportCombinedProgress();
          },
        });

        const uploadedAnswer = textbookAnswerFile
          ? await uploadMultipartPdf({
              file: textbookAnswerFile,
              role: "textbook_answer",
              signal: abortController.signal,
              onProgress: (loaded) => {
                answerLoaded = loaded;
                reportCombinedProgress();
              },
            })
          : null;

        const response = await api.post<UploadRegisterResponse>("/files/textbook/register", {
          problem_key: uploadedProblem.key,
          problem_filename: uploadedProblem.filename,
          problem_size: uploadedProblem.size,
          answer_key: uploadedAnswer?.key ?? null,
          answer_size: uploadedAnswer?.size ?? null,
          book_title: bookTitle.trim(),
          publisher: publisher.trim() || null,
          auto_analyze: autoAnalyze,
        });

        handleRegisteredUpload(id, response, "textbook", autoAnalyze);

        setTextbookProblemFile(null);
        setTextbookAnswerFile(null);
        if (problemFileInputRef.current) {
          problemFileInputRef.current.value = "";
        }
        if (answerFileInputRef.current) {
          answerFileInputRef.current.value = "";
        }
      } catch (error) {
        updateFile(id, {
          status: "failed",
          error: isAbortError(error)
            ? "업로드가 취소되었습니다."
            : error instanceof Error
              ? error.message
              : "업로드에 실패했습니다.",
        });
      }
    })();
  }, [
    bookTitle,
    autoAnalyze,
    createUploadEntry,
    handleRegisteredUpload,
    publisher,
    textbookAnswerFile,
    textbookProblemFile,
    updateFile,
  ]);

  const processFiles = useCallback(
    (fileList: FileList | null) => {
      if (!fileList) return;

      Array.from(fileList).forEach((file) => {
        if (!isPdfFile(file)) {
          const id = `upload-${++fileIdCounter}`;
          setFiles((prev) => [
            {
              id,
              name: file.name,
              size: file.size,
            documentType: "exam",
            autoAnalyze,
            status: "failed",
              progress: 0,
              error: "PDF 파일만 업로드할 수 있습니다.",
            },
            ...prev,
          ]);
          return;
        }

        uploadExamFile(file);
      });
    },
    [uploadExamFile],
  );

  const handleDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      setIsDragging(false);
      processFiles(event.dataTransfer.files);
    },
    [processFiles],
  );

  const handleFileInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      processFiles(event.target.files);
      if (examFileInputRef.current) {
        examFileInputRef.current.value = "";
      }
    },
    [processFiles],
  );

  const handleTextbookFileChange = useCallback(
    (kind: "problem" | "answer", fileList: FileList | null) => {
      const selectedFile = fileList?.[0];
      if (!selectedFile) {
        return;
      }

      if (!isPdfFile(selectedFile)) {
        toast.error("PDF 파일만 업로드할 수 있습니다.");
        return;
      }

      if (kind === "problem") {
        setTextbookProblemFile(selectedFile);
        return;
      }

      setTextbookAnswerFile(selectedFile);
    },
    [],
  );

  useEffect(() => {
    const token = localStorage.getItem("token");
    fetch(`${API_URL}/files`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((response) => response.json())
      .then(
        (data: Array<{
          id: string;
          filename: string;
          ocrJobId: string | null;
          ocrStatus: string | null;
          problemCount: number;
          documentType: string;
          autoAnalyze?: boolean;
        }>) => {
          const inProgress = data.filter(
            (file) => file.ocrStatus === "pending" || file.ocrStatus === "processing",
          );
          if (inProgress.length === 0) {
            return;
          }

          const restored: UploadedFile[] = inProgress.map((file) => ({
            id: `restored-${file.ocrJobId ?? file.id}`,
            name: file.filename,
            size: 0,
            documentType: file.documentType === "textbook" ? "textbook" : "exam",
            autoAnalyze: Boolean(file.autoAnalyze ?? true),
            status: "processing",
            progress: 30,
            fileId: file.id,
          }));

          setFiles((prev) => {
            const existingIds = new Set(prev.map((file) => file.fileId));
            const nextFiles = restored.filter((file) => !existingIds.has(file.fileId));
            return [...nextFiles, ...prev];
          });

          for (const file of inProgress) {
            if (file.ocrJobId) {
              startSSE(
                `restored-${file.ocrJobId}`,
                file.ocrJobId,
                file.documentType === "textbook" ? "textbook" : "exam",
                Boolean(file.autoAnalyze ?? true),
              );
            }
          }
        },
      )
      .catch(() => {
        // Non-critical restore path.
      });
  }, [startSSE]);

  const removeFile = useCallback(
    (index: number) => {
      const file = files[index];
      if (!file) {
        return;
      }

      if (file.abortController && file.status === "uploading") {
        file.abortController.abort();
      }

      const controller = streamControllers.current.get(file.id);
      if (controller) {
        controller.abort();
        streamControllers.current.delete(file.id);
      }

      const timer = reconnectTimers.current.get(file.id);
      if (timer) {
        clearTimeout(timer);
        reconnectTimers.current.delete(file.id);
      }

      setFiles((prev) => prev.filter((_item, currentIndex) => currentIndex !== index));
    },
    [files],
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">PDF 업로드</h1>
        <p className="text-muted-foreground">
          시험지나 교재 PDF를 업로드하면 자동으로 문제를 추출합니다.
        </p>
      </div>

      <Card>
        <CardContent className="p-6">
          <div className="mb-4 flex gap-4">
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="radio"
                name="docType"
                value="exam"
                checked={documentType === "exam"}
                onChange={() => setDocumentType("exam")}
                className="accent-[#DFD0B8]"
              />
              <span className="text-sm font-medium">시험지</span>
            </label>
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="radio"
                name="docType"
                value="textbook"
                checked={documentType === "textbook"}
                onChange={() => setDocumentType("textbook")}
                className="accent-[#DFD0B8]"
              />
              <span className="text-sm font-medium">교재</span>
            </label>
          </div>

          <label className="mb-4 flex cursor-pointer items-center gap-3 rounded-lg border border-border bg-brand-charcoal/40 px-4 py-3">
            <input
              type="checkbox"
              checked={autoAnalyze}
              onChange={(event) => setAutoAnalyze(event.target.checked)}
              className="h-4 w-4 accent-[#DFD0B8]"
            />
            <div>
              <p className="text-sm font-medium">업로드 후 AI 자동분석</p>
              <p className="text-xs text-muted-foreground">
                끄면 OCR과 정답 매칭까지만 진행하고, AI 분석은 나중에 수동으로 실행합니다.
              </p>
            </div>
          </label>

          {documentType === "exam" ? (
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
              <p className="mt-4 text-lg font-medium">PDF 파일을 드래그하여 놓으세요</p>
              <p className="mt-1 text-sm text-muted-foreground">
                또는 아래 버튼을 클릭하여 파일을 선택하세요
              </p>
              <input
                ref={examFileInputRef}
                type="file"
                accept="application/pdf"
                multiple
                className="hidden"
                onChange={handleFileInputChange}
              />
              <Button className="mt-4" onClick={() => examFileInputRef.current?.click()}>
                <FileUp className="mr-2 h-4 w-4" />
                파일 선택
              </Button>
              <p className="mt-3 text-xs text-muted-foreground">
                대용량 PDF는 브라우저에서 S3로 직접 업로드합니다.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-3">
                <input
                  type="text"
                  placeholder="책 제목 (필수)"
                  value={bookTitle}
                  onChange={(event) => setBookTitle(event.target.value)}
                  className="w-full rounded-lg border border-border bg-brand-charcoal px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-brand-beige focus:outline-none focus:ring-1 focus:ring-brand-beige"
                />
                <input
                  type="text"
                  placeholder="출판사 (선택)"
                  value={publisher}
                  onChange={(event) => setPublisher(event.target.value)}
                  className="w-full rounded-lg border border-border bg-brand-charcoal px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-brand-beige focus:outline-none focus:ring-1 focus:ring-brand-beige"
                />
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-lg border border-border bg-brand-charcoal/40 p-4">
                  <p className="text-sm font-medium">문제집 PDF</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    필수. 답지가 포함된 통합 교재 PDF만 있으면 이것만 올리면 됩니다.
                  </p>
                  <input
                    ref={problemFileInputRef}
                    type="file"
                    accept="application/pdf"
                    className="hidden"
                    onChange={(event) => handleTextbookFileChange("problem", event.target.files)}
                  />
                  <Button
                    variant="outline"
                    className="mt-4"
                    onClick={() => problemFileInputRef.current?.click()}
                  >
                    <FileUp className="mr-2 h-4 w-4" />
                    문제집 선택
                  </Button>
                  {textbookProblemFile && (
                    <div className="mt-3 flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm">{textbookProblemFile.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatFileSize(textbookProblemFile.size)}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setTextbookProblemFile(null);
                          if (problemFileInputRef.current) {
                            problemFileInputRef.current.value = "";
                          }
                        }}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </div>

                <div className="rounded-lg border border-border bg-brand-charcoal/40 p-4">
                  <p className="text-sm font-medium">답지 PDF</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    선택. 문제집과 분리된 답지일 때만 추가로 올리면 됩니다.
                  </p>
                  <input
                    ref={answerFileInputRef}
                    type="file"
                    accept="application/pdf"
                    className="hidden"
                    onChange={(event) => handleTextbookFileChange("answer", event.target.files)}
                  />
                  <Button
                    variant="outline"
                    className="mt-4"
                    onClick={() => answerFileInputRef.current?.click()}
                  >
                    <FileUp className="mr-2 h-4 w-4" />
                    답지 선택
                  </Button>
                  {textbookAnswerFile && (
                    <div className="mt-3 flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm">{textbookAnswerFile.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatFileSize(textbookAnswerFile.size)}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setTextbookAnswerFile(null);
                          if (answerFileInputRef.current) {
                            answerFileInputRef.current.value = "";
                          }
                        }}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between rounded-lg border border-border bg-brand-dark/60 px-4 py-3">
                <p className="text-sm text-muted-foreground">
                  답지 PDF가 있으면 별도 OCR 후 문제집과 매칭합니다. 없으면 교재 안의 답지를
                  그대로 찾습니다.
                </p>
                <Button
                  onClick={uploadTextbookFiles}
                  disabled={!bookTitle.trim() || !textbookProblemFile}
                >
                  교재 업로드
                </Button>
              </div>
            </div>
          )}
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
                    <div className="flex min-w-0 items-center gap-2">
                      <p className="truncate text-sm font-medium">{file.name}</p>
                      <Badge variant="outline">
                        {file.documentType === "textbook" ? "교재" : "시험지"}
                      </Badge>
                    </div>
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
                    <p className="text-xs text-muted-foreground">{formatFileSize(file.size)}</p>
                    <span className="text-xs text-muted-foreground">
                      {statusLabel[file.status]}
                    </span>
                  </div>
                  {file.stageMessage && (
                    <p className="mt-1 text-xs text-brand-beige">
                      {file.stageMessage}
                      {!file.stageMessage.includes("/")
                      && file.stageTotal && file.stageTotal > 0
                        ? ` · ${file.stageCurrent ?? 0}/${file.stageTotal}`
                        : ""}
                    </p>
                  )}
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
