"use client";

import React, { useState, useRef, useEffect } from "react";
import { MessageCircle, X, Minimize2, Trash2, Send, Loader2 } from "lucide-react";
import { useChatbot, type ChatMessage } from "./ChatProvider";

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} mb-3`}>
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
          isUser
            ? "bg-primary text-primary-foreground rounded-br-md"
            : "bg-muted text-foreground rounded-bl-md"
        }`}
      >
        {message.content || (
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            <span className="text-xs">يكتب...</span>
          </span>
        )}
      </div>
    </div>
  );
}

const SUGGESTIONS_AR = [
  "كيف أسجل حضوري؟",
  "كيف أقدم طلب إجازة؟",
  "كيف أضيف موظف جديد؟",
  "كيف أشغل الرواتب؟",
];

const SUGGESTIONS_EN = [
  "How do I check in?",
  "How to submit a leave request?",
  "How to add a new employee?",
  "How to run payroll?",
];

function WelcomeScreen({ onSuggestionClick }: { onSuggestionClick: (s: string) => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
        <MessageCircle className="h-8 w-8 text-primary" />
      </div>
      <h3 className="mb-1 text-base font-semibold text-foreground">مساعد تطوير</h3>
      <p className="mb-4 text-xs text-muted-foreground">
        أنا هنا لمساعدتك في استخدام النظام. اسألني أي شيء!
      </p>
      <div className="w-full space-y-2">
        <p className="text-[11px] font-medium text-muted-foreground mb-2">جرّب أن تسأل:</p>
        {SUGGESTIONS_AR.map((s) => (
          <button
            key={s}
            onClick={() => onSuggestionClick(s)}
            className="w-full rounded-lg border bg-background px-3 py-2 text-right text-xs text-foreground hover:bg-accent transition-colors"
          >
            {s}
          </button>
        ))}
      </div>
      <div className="w-full space-y-2 mt-3">
        <p className="text-[11px] font-medium text-muted-foreground mb-2">Or try in English:</p>
        {SUGGESTIONS_EN.map((s) => (
          <button
            key={s}
            onClick={() => onSuggestionClick(s)}
            className="w-full rounded-lg border bg-background px-3 py-2 text-left text-xs text-foreground hover:bg-accent transition-colors"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ChatWidget() {
  const { state, sendMessage, setOpen, clearChat } = useChatbot();
  const [input, setInput] = useState("");
  const [isMinimized, setIsMinimized] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [state.messages]);

  useEffect(() => {
    if (state.isOpen && !isMinimized) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [state.isOpen, isMinimized]);

  const handleSend = () => {
    if (!input.trim() || state.isLoading) return;
    sendMessage(input);
    setInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSuggestionClick = (suggestion: string) => {
    sendMessage(suggestion);
  };

  // Floating button
  if (!state.isOpen) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 left-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg hover:bg-primary/90 transition-all hover:scale-105 animate-in fade-in slide-in-from-bottom-4"
        aria-label="فتح المساعد"
      >
        <MessageCircle className="h-6 w-6" />
      </button>
    );
  }

  return (
    <div
      className={`fixed bottom-6 left-6 z-50 flex flex-col rounded-2xl border bg-background shadow-2xl transition-all animate-in fade-in slide-in-from-bottom-4 ${
        isMinimized ? "h-14 w-80" : "h-[600px] w-[380px] sm:w-[400px]"
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between rounded-t-2xl border-b bg-primary px-4 py-3 shrink-0">
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-green-400 animate-pulse" />
          <span className="font-medium text-primary-foreground text-sm">مساعد تطوير</span>
        </div>
        <div className="flex items-center gap-1">
          {state.messages.length > 0 && (
            <button
              onClick={clearChat}
              className="rounded p-1.5 text-primary-foreground/70 hover:text-primary-foreground hover:bg-primary-foreground/10 transition-colors"
              title="محادثة جديدة"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
          <button
            onClick={() => setIsMinimized(!isMinimized)}
            className="rounded p-1.5 text-primary-foreground/70 hover:text-primary-foreground hover:bg-primary-foreground/10 transition-colors"
          >
            <Minimize2 className="h-4 w-4" />
          </button>
          <button
            onClick={() => setOpen(false)}
            className="rounded p-1.5 text-primary-foreground/70 hover:text-primary-foreground hover:bg-primary-foreground/10 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Body */}
      {!isMinimized && (
        <>
          <div className="flex-1 overflow-y-auto p-4" dir="auto">
            {state.messages.length === 0 ? (
              <WelcomeScreen onSuggestionClick={handleSuggestionClick} />
            ) : (
              <>
                {state.messages.map((msg) => (
                  <MessageBubble key={msg.id} message={msg} />
                ))}
                <div ref={messagesEndRef} />
              </>
            )}
          </div>

          {/* Error */}
          {state.error && (
            <div className="mx-4 mb-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {state.error}
            </div>
          )}

          {/* Input */}
          <div className="shrink-0 border-t p-3">
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="اكتب سؤالك هنا... / Type your question..."
                className="flex-1 resize-none rounded-xl border bg-muted/50 px-3 py-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 min-h-[40px] max-h-[100px]"
                rows={1}
                dir="auto"
                disabled={state.isLoading}
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || state.isLoading}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground disabled:opacity-50 disabled:cursor-not-allowed hover:bg-primary/90 transition-colors"
              >
                {state.isLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </button>
            </div>
            <p className="mt-1.5 text-center text-[10px] text-muted-foreground">
              مدعوم بالذكاء الاصطناعي | Powered by AI
            </p>
          </div>
        </>
      )}
    </div>
  );
}
