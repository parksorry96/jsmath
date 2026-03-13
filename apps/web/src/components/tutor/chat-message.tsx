"use client";

import { LatexRenderer } from "@/components/math/latex-renderer";
import { cn } from "@/lib/utils";

interface ChatMessageProps {
  role: "student" | "tutor";
  content: string;
  createdAt?: string;
  isStreaming?: boolean;
}

export function ChatMessage({
  role,
  content,
  createdAt,
  isStreaming,
}: ChatMessageProps) {
  const isStudent = role === "student";

  return (
    <div
      className={cn("flex w-full gap-3", isStudent ? "justify-end" : "justify-start")}
    >
      {!isStudent && (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-beige/20 text-sm font-semibold text-brand-beige">
          AI
        </div>
      )}

      <div
        className={cn(
          "max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed",
          isStudent
            ? "bg-blue-600 text-white"
            : "bg-muted text-foreground",
        )}
      >
        <LatexRenderer content={content} />
        {isStreaming && (
          <span className="ml-1 inline-block h-4 w-1 animate-pulse bg-current" />
        )}
        {createdAt && (
          <p
            className={cn(
              "mt-1.5 text-[10px]",
              isStudent ? "text-blue-200" : "text-muted-foreground",
            )}
          >
            {new Date(createdAt).toLocaleTimeString("ko-KR", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </p>
        )}
      </div>

      {isStudent && (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-600 text-sm font-semibold text-white">
          나
        </div>
      )}
    </div>
  );
}
