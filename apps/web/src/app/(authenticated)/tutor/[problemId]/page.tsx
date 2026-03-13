"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Send,
  Lightbulb,
  X,
  ArrowLeft,
  LoaderCircle,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { LatexRenderer } from "@/components/math/latex-renderer";
import { ChatMessage } from "@/components/tutor/chat-message";
import { useTutorChat } from "@/hooks/useTutorChat";

export default function TutorPage() {
  const params = useParams<{ problemId: string }>();
  const router = useRouter();
  const [input, setInput] = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const {
    sessionId,
    messages,
    problem,
    isStreaming,
    isStarting,
    currentStreamContent,
    error,
    startSession,
    sendMessage,
    endSession,
  } = useTutorChat();

  // Start session on mount
  useEffect(() => {
    if (params.problemId && !sessionId && !isStarting) {
      startSession(params.problemId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.problemId]);

  // Auto-scroll to bottom on new messages or streaming content
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, currentStreamContent]);

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed || isStreaming) return;
    setInput("");
    void sendMessage(trimmed);
  };

  const handleHint = () => {
    if (isStreaming) return;
    setInput("");
    void sendMessage("힌트를 좀 더 주세요.");
  };

  const handleEnd = async () => {
    await endSession();
    router.back();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (isStarting) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <LoaderCircle className="h-8 w-8 animate-spin text-brand-beige" />
          <p className="text-sm text-muted-foreground">
            AI 튜터를 준비하고 있습니다...
          </p>
        </div>
      </div>
    );
  }

  if (error && !sessionId) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Card className="max-w-md">
          <CardContent className="flex flex-col items-center gap-4 p-8">
            <AlertCircle className="h-10 w-10 text-destructive" />
            <p className="text-sm font-medium">{error}</p>
            <Button variant="outline" onClick={() => router.back()}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              돌아가기
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100svh-8rem)] flex-col gap-4 lg:flex-row">
      {/* Left panel: Problem display */}
      <div className="shrink-0 lg:w-[45%] lg:max-w-xl">
        <Card className="h-full">
          <CardContent className="flex h-full flex-col p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-muted-foreground">
                문제
              </h2>
              {problem?.subject && (
                <span className="text-xs text-muted-foreground">
                  {problem.subject}
                  {problem.unitMajor ? ` / ${problem.unitMajor}` : ""}
                </span>
              )}
            </div>
            <div className="flex-1 overflow-auto">
              {problem && (
                <LatexRenderer
                  content={problem.stemLatex || problem.stemText}
                  className="text-sm"
                />
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Right panel: Chat */}
      <div className="flex min-h-0 flex-1 flex-col">
        {/* Chat header */}
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 lg:hidden"
              onClick={() => router.back()}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <h1 className="text-lg font-semibold">AI 튜터</h1>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleEnd}
            className="text-destructive hover:text-destructive"
          >
            <X className="mr-1.5 h-3.5 w-3.5" />
            대화 종료
          </Button>
        </div>

        {/* Messages area */}
        <Card className="flex min-h-0 flex-1 flex-col">
          <CardContent className="flex min-h-0 flex-1 flex-col p-0">
            <div className="flex-1 space-y-4 overflow-auto p-4">
              {messages.map((msg, i) => (
                <ChatMessage
                  key={i}
                  role={msg.role}
                  content={msg.content}
                  createdAt={msg.createdAt}
                />
              ))}

              {/* Streaming message */}
              {isStreaming && currentStreamContent && (
                <ChatMessage
                  role="tutor"
                  content={currentStreamContent}
                  isStreaming
                />
              )}

              <div ref={chatEndRef} />
            </div>

            {/* Input area */}
            <div className="border-t p-3">
              {error && sessionId && (
                <p className="mb-2 text-xs text-destructive">{error}</p>
              )}
              <div className="flex items-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleHint}
                  disabled={isStreaming}
                  className="shrink-0"
                >
                  <Lightbulb className="mr-1.5 h-3.5 w-3.5" />
                  힌트
                </Button>
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="답변을 입력하세요..."
                  rows={1}
                  disabled={isStreaming}
                  className="min-h-[40px] max-h-[120px] flex-1 resize-none rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-beige/50 disabled:opacity-50"
                />
                <Button
                  size="icon"
                  onClick={handleSend}
                  disabled={!input.trim() || isStreaming}
                  className="shrink-0"
                >
                  {isStreaming ? (
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
