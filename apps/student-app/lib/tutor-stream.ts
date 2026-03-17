import { Platform } from "react-native";
import { API_URL } from "./api";
import { getItemAsync } from "./storage";

interface StreamTutorMessageParams {
  sessionId: string;
  content: string;
  imageS3Key?: string;
  signal?: AbortSignal;
  onChunk?: (content: string) => void;
}

function parseSseEvents(payload: string) {
  return payload
    .split(/\r?\n\r?\n/)
    .map((eventBlock) => eventBlock.trim())
    .filter(Boolean)
    .map((eventBlock) => {
      let event = "message";
      const dataLines: string[] = [];

      for (const line of eventBlock.split(/\r?\n/)) {
        if (line.startsWith("event:")) {
          event = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          dataLines.push(line.slice(5).trimStart());
        }
      }

      return {
        event,
        data: dataLines.join("\n"),
      };
    });
}

function getErrorMessage(payload: unknown, fallback: string) {
  if (typeof payload === "string" && payload) {
    return payload;
  }

  if (
    payload &&
    typeof payload === "object" &&
    "message" in payload &&
    typeof payload.message === "string"
  ) {
    return payload.message;
  }

  if (
    payload &&
    typeof payload === "object" &&
    "error" in payload &&
    typeof payload.error === "string"
  ) {
    return payload.error;
  }

  return fallback;
}

export async function streamTutorMessage({
  sessionId,
  content,
  imageS3Key,
  signal,
  onChunk,
}: StreamTutorMessageParams) {
  const token = Platform.OS === "web" ? null : await getItemAsync("auth_token");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "text/event-stream",
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(
    `${API_URL}/student-ai/tutor/sessions/${sessionId}/message`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({ content, imageS3Key }),
      credentials: Platform.OS === "web" ? "include" : undefined,
      signal,
    },
  );

  if (!res.ok) {
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = await res.text().catch(() => null);
    }

    throw new Error(
      getErrorMessage(body, `Request failed with status ${res.status}`),
    );
  }

  let tutorContent = "";

  const applySsePayload = (payload: string) => {
    for (const { event, data } of parseSseEvents(payload)) {
      if (event === "done" || data === "{}" || data === "[DONE]") {
        continue;
      }

      if (event === "error") {
        try {
          const parsed = JSON.parse(data) as { error?: string };
          throw new Error(
            parsed.error ?? "응답을 받지 못했어요. 다시 시도해주세요.",
          );
        } catch (error) {
          throw error instanceof Error
            ? error
            : new Error("응답을 받지 못했어요. 다시 시도해주세요.");
        }
      }

      try {
        const parsed = JSON.parse(data) as { chunk?: string; content?: string };
        const text = parsed.chunk ?? parsed.content;
        if (text) {
          tutorContent += text;
          onChunk?.(tutorContent);
        }
      } catch {
        continue;
      }
    }
  };

  if (res.body && typeof res.body.getReader === "function") {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const segments = buffer.split(/\r?\n\r?\n/);
      buffer = segments.pop() ?? "";

      for (const segment of segments) {
        applySsePayload(segment);
      }
    }

    if (buffer.trim()) {
      applySsePayload(buffer);
    }
  } else {
    applySsePayload(await res.text());
  }

  return tutorContent;
}
