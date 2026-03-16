import { useState, useCallback, useRef } from "react";
import { getItemAsync } from "@/lib/storage";

const API_URL = process.env.EXPO_PUBLIC_API_URL || "http://localhost:3001/v1";

interface Message {
  id: string;
  role: "student" | "tutor";
  content: string;
}

export function useTutorChat(sessionId: string) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const sendMessage = useCallback(async (content: string, imageS3Key?: string) => {
    // Add student message
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

      // Add empty tutor message
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

  return { messages, isStreaming, sendMessage, abort };
}
