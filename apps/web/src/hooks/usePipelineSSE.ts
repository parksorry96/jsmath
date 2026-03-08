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

const MAX_RECONNECT_DELAY = 10_000;

export function usePipelineSSE(ocrJobId: string | null) {
  const [progress, setProgress] = useState<PipelineProgress | null>(null);
  const [connected, setConnected] = useState(false);
  const esRef = useRef<EventSource | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectDelay = useRef(1000);
  const closed = useRef(false);

  const close = useCallback(() => {
    closed.current = true;
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
      setConnected(false);
    }
  }, []);

  useEffect(() => {
    if (!ocrJobId) return;
    closed.current = false;
    reconnectDelay.current = 1000;

    function connect() {
      if (closed.current) return;

      const apiUrl =
        process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/v1";
      const token = localStorage.getItem("token");
      const query = token
        ? `?access_token=${encodeURIComponent(token)}`
        : "";
      const es = new EventSource(`${apiUrl}/files/${ocrJobId}/events${query}`);
      esRef.current = es;

      es.onopen = () => {
        setConnected(true);
        reconnectDelay.current = 1000; // reset backoff on success
      };

      es.addEventListener("progress", (e) => {
        try {
          const data = JSON.parse(e.data) as PipelineProgress;
          setProgress(data);
        } catch {
          // Ignore parse errors
        }
      });

      es.onerror = () => {
        es.close();
        esRef.current = null;
        setConnected(false);

        // Auto-reconnect with exponential backoff
        if (!closed.current) {
          reconnectTimer.current = setTimeout(() => {
            reconnectDelay.current = Math.min(
              reconnectDelay.current * 2,
              MAX_RECONNECT_DELAY,
            );
            connect();
          }, reconnectDelay.current);
        }
      };
    }

    connect();

    return () => {
      close();
    };
  }, [ocrJobId, close]);

  const stagePercent = progress
    ? (STAGE_PROGRESS[progress.stage] ?? 50)
    : 0;

  return { progress, connected, stagePercent, close };
}
