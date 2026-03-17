import { useState, useCallback, useRef, useEffect } from "react";
import { api } from "@/lib/api";
import { streamTutorMessage } from "@/lib/tutor-stream";

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

    return () => {
      abortRef.current?.abort();
    };
  }, [sessionId]);

  const sendMessage = useCallback(async (content: string, imageS3Key?: string) => {
    const studentMsg: Message = { id: Date.now().toString(), role: "student", content };
    setMessages((prev) => [...prev, studentMsg]);
    setIsStreaming(true);
    let tutorMsgId: string | null = null;

    try {
      abortRef.current = new AbortController();

      let tutorContent = "";
      const createdTutorMsgId = `tutor-${Date.now()}`;
      tutorMsgId = createdTutorMsgId;
      setMessages((prev) => [
        ...prev,
        { id: createdTutorMsgId, role: "tutor", content: "" },
      ]);

      await streamTutorMessage({
        sessionId,
        content,
        imageS3Key,
        signal: abortRef.current.signal,
        onChunk: (nextContent) => {
          tutorContent = nextContent;
          setMessages((prev) =>
            prev.map((message) =>
              message.id === tutorMsgId
                ? { ...message, content: nextContent }
                : message,
            ),
          );
        },
      });
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        const errorMessage =
          e instanceof Error && e.message
            ? e.message
            : "응답을 받지 못했어요. 다시 시도해주세요.";

        setMessages((prev) => {
          const placeholderId = tutorMsgId;

          if (!placeholderId) {
            return [
              ...prev,
              { id: `error-${Date.now()}`, role: "tutor", content: errorMessage },
            ];
          }

          let replaced = false;
          const next = prev.map((message) => {
            if (message.id === placeholderId) {
              replaced = true;
              return { ...message, content: errorMessage };
            }

            return message;
          });

          return replaced
            ? next
            : [...next, { id: `error-${Date.now()}`, role: "tutor", content: errorMessage }];
        });
      }
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
    }
  }, [sessionId]);

  const abort = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return { messages, problem, isStreaming, isLoading, sendMessage, abort };
}
