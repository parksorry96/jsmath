export interface SseMessage {
  data: string;
  event: string;
  id?: string;
}

interface StreamSseOptions {
  url: string;
  signal: AbortSignal;
  onMessage: (message: SseMessage) => void;
  onOpen?: () => void;
}

function parseEventChunk(chunk: string): SseMessage | null {
  const lines = chunk.split("\n");
  let event = "message";
  let id: string | undefined;
  const data: string[] = [];

  for (const line of lines) {
    if (!line || line.startsWith(":")) {
      continue;
    }
    if (line.startsWith("event:")) {
      event = line.slice(6).trim() || "message";
      continue;
    }
    if (line.startsWith("data:")) {
      data.push(line.slice(5).trimStart());
      continue;
    }
    if (line.startsWith("id:")) {
      id = line.slice(3).trim();
    }
  }

  if (data.length === 0) {
    return null;
  }

  return {
    data: data.join("\n"),
    event,
    id,
  };
}

export async function streamSse({
  url,
  signal,
  onMessage,
  onOpen,
}: StreamSseOptions): Promise<void> {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "text/event-stream",
      Cache: "no-cache",
    },
    cache: "no-store",
    credentials: "include",
    signal,
  });

  if (!response.ok) {
    throw new Error(`SSE request failed with status ${response.status}`);
  }
  if (!response.body) {
    throw new Error("SSE response body is missing");
  }

  onOpen?.();

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");

    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const rawEvent = buffer.slice(0, boundary).trim();
      buffer = buffer.slice(boundary + 2);

      if (rawEvent) {
        const parsed = parseEventChunk(rawEvent);
        if (parsed) {
          onMessage(parsed);
        }
      }

      boundary = buffer.indexOf("\n\n");
    }
  }

  if (!signal.aborted) {
    throw new Error("SSE connection closed");
  }
}
