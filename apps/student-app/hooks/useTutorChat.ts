import { useState, useCallback, useRef, useEffect } from "react";
import { api } from "@/lib/api";
import { getItemAsync } from "@/lib/storage";

const API_URL = process.env.EXPO_PUBLIC_API_URL || "http://192.168.0.78:3001/v1";

interface Message {
  id: string;
  role: "student" | "tutor";
  content: string;
}

interface SessionData {
  id: string;
  problemId: string;
  messages: Array<{ role: string; content: string; createdAt: string }>;
  problem?: {
    id: string;
    stemLatex: string;
    stemText: string;
    subject: string | null;
    unitMajor: string | null;
    difficulty: number | null;
  };
}

export function useTutorChat(sessionId: string) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [problem, setProblem] = useState<SessionData["problem"] | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const abortRef = useRef<AbortController | null>(null);

  // Load existing session messages on mount
  useEffect(() => {
    if (!sessionId) return;
    (async () => {
      try {
        const session = await api.get<SessionData>(`/student-ai/tutor/sessions/${sessionId}`);
        if (session.problem) setProblem(session.problem);
        if (session.messages?.length > 0) {
          setMessages(
            session.messages.map((m, i) => ({
              id: `init-${i}`,
              role: m.role as "student" | "tutor",
              content: m.content,
            })),
          );
        }
      } catch {
        // Session may not exist yet
      } finally {
        setIsLoading(false);
      }
    })();
  }, [sessionId]);

  const sendMessage = useCallback(async (content: string, imageS3Key?: string) => {
    const studentMsg: Message = { id: Date.now().toString(), role: "student", content };
    setMessages((prev) => [...prev, studentMsg]);
    setIsStreaming(true);

    try {
      const token = await getItemAsync("auth_token");
      abortRef.current = new AbortController();

      const res = await fetch(
        `${API_URL}/student-ai/tutor/sessions/${sessionId}/message`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ content, imageS3Key }),
          signal: abortRef.current.signal,
        },
      );

      if (!res.ok || !res.body) throw new Error("Stream failed");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let tutorContent = "";
      const tutorMsgId = `tutor-${Date.now()}`;

      setMessages((prev) => [...prev, { id: tutorMsgId, role: "tutor", content: "" }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6);
            if (data === "[DONE]") break;
            try {
              const parsed = JSON.parse(data);
              if (parsed.content) {
                tutorContent += parsed.content;
                setMessages((prev) =>
                  prev.map((m) => m.id === tutorMsgId ? { ...m, content: tutorContent } : m),
                );
              }
            } catch { /* non-JSON SSE line */ }
          }
        }
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        setMessages((prev) => [
          ...prev,
          { id: `error-${Date.now()}`, role: "tutor", content: "응답을 받지 못했어요. 다시 시도해주세요." },
        ]);
      }
    } finally {
      setIsStreaming(false);
    }
  }, [sessionId]);

  const abort = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return { messages, problem, isStreaming, isLoading, sendMessage, abort };
}
