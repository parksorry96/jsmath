"use client";

import { useState, useCallback, useRef } from "react";
import { api } from "@/lib/api";

export interface ChatMessage {
  role: "student" | "tutor";
  content: string;
  createdAt: string;
}

interface ProblemInfo {
  id: string;
  stemLatex: string;
  stemText: string;
  problemType: string;
  difficulty: number | null;
  subject: string | null;
  unitMajor: string | null;
}

interface SessionResponse {
  id: string;
  problemId: string;
  status: string;
  messages: ChatMessage[];
  problem: ProblemInfo | null;
}

export function useTutorChat() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [problem, setProblem] = useState<ProblemInfo | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [currentStreamContent, setCurrentStreamContent] = useState("");
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const startSession = useCallback(async (problemId: string) => {
    setIsStarting(true);
    setError(null);
    try {
      const data = await api.post<SessionResponse>("/tutor/sessions", {
        problemId,
      });
      setSessionId(data.id);
      setMessages(data.messages);
      setProblem(data.problem);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start session");
    } finally {
      setIsStarting(false);
    }
  }, []);

  const loadSession = useCallback(async (id: string) => {
    setIsStarting(true);
    setError(null);
    try {
      const data = await api.get<SessionResponse>(`/tutor/sessions/${id}`);
      setSessionId(data.id);
      setMessages(data.messages);
      setProblem(data.problem);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load session");
    } finally {
      setIsStarting(false);
    }
  }, []);

  const sendMessage = useCallback(
    async (content: string) => {
      if (!sessionId || isStreaming) return;

      setError(null);
      setIsStreaming(true);
      setCurrentStreamContent("");

      // Add student message immediately
      const studentMsg: ChatMessage = {
        role: "student",
        content,
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, studentMsg]);

      const apiUrl =
        process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/v1";
      const token =
        typeof window !== "undefined" ? localStorage.getItem("token") : null;

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const response = await fetch(
          `${apiUrl}/tutor/sessions/${sessionId}/message`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "text/event-stream",
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({ content }),
            signal: controller.signal,
          },
        );

        if (!response.ok) {
          throw new Error(`Request failed with status ${response.status}`);
        }
        if (!response.body) {
          throw new Error("Response body is missing");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let accumulated = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          let boundary = buffer.indexOf("\n\n");
          while (boundary !== -1) {
            const rawEvent = buffer.slice(0, boundary).trim();
            buffer = buffer.slice(boundary + 2);

            if (rawEvent.startsWith("event: error")) {
              const dataLine = rawEvent
                .split("\n")
                .find((l) => l.startsWith("data:"));
              if (dataLine) {
                const errData = JSON.parse(dataLine.slice(5).trim());
                throw new Error(errData.error || "Stream error");
              }
            }

            if (rawEvent.startsWith("event: done")) {
              break;
            }

            if (rawEvent.startsWith("data:")) {
              try {
                const parsed = JSON.parse(rawEvent.slice(5).trim());
                if (parsed.chunk) {
                  accumulated += parsed.chunk;
                  setCurrentStreamContent(accumulated);
                }
              } catch {
                // Ignore parse errors
              }
            }

            boundary = buffer.indexOf("\n\n");
          }
        }

        // Add the completed tutor message
        if (accumulated) {
          const tutorMsg: ChatMessage = {
            role: "tutor",
            content: accumulated,
            createdAt: new Date().toISOString(),
          };
          setMessages((prev) => [...prev, tutorMsg]);
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Failed to send message");
      } finally {
        setIsStreaming(false);
        setCurrentStreamContent("");
        abortRef.current = null;
      }
    },
    [sessionId, isStreaming],
  );

  const endSession = useCallback(async () => {
    if (!sessionId) return;
    abortRef.current?.abort();
    try {
      await api.post(`/tutor/sessions/${sessionId}/end`);
    } catch {
      // Ignore errors on end
    }
    setSessionId(null);
    setMessages([]);
    setProblem(null);
  }, [sessionId]);

  return {
    sessionId,
    messages,
    problem,
    isStreaming,
    isStarting,
    currentStreamContent,
    error,
    startSession,
    loadSession,
    sendMessage,
    endSession,
  };
}
