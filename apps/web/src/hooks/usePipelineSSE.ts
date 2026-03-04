"use client";

import { useEffect, useState, useRef, useCallback } from "react";

interface PipelineProgress {
  ocrJobId: string;
  stage: string;
  current: number;
  total: number;
  message: string;
}

const STAGE_PROGRESS: Record<string, number> = {
  ocr_submit: 25,
  ocr_processing: 40,
  parsing: 55,
  segmentation: 65,
  ocr_complete: 70,
  analyzing: 85,
  analysis_complete: 100,
};

export function usePipelineSSE(ocrJobId: string | null) {
  const [progress, setProgress] = useState<PipelineProgress | null>(null);
  const [connected, setConnected] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  const close = useCallback(() => {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
      setConnected(false);
    }
  }, []);

  useEffect(() => {
    if (!ocrJobId) return;

    const apiUrl =
      process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/v1";
    const es = new EventSource(`${apiUrl}/files/${ocrJobId}/events`);
    esRef.current = es;

    es.onopen = () => setConnected(true);
    es.addEventListener("progress", (e) => {
      try {
        const data = JSON.parse(e.data) as PipelineProgress;
        setProgress(data);
      } catch {
        // Ignore parse errors
      }
    });
    es.onerror = () => {
      setConnected(false);
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [ocrJobId]);

  const stagePercent = progress
    ? (STAGE_PROGRESS[progress.stage] ?? 50)
    : 0;

  return { progress, connected, stagePercent, close };
}
