"use client";

import React, { createContext, useContext, useReducer, useCallback, useRef } from "react";
import { usePathname } from "next/navigation";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  isStreaming?: boolean;
}

interface ChatState {
  messages: ChatMessage[];
  isLoading: boolean;
  isOpen: boolean;
  error: string | null;
}

type ChatAction =
  | { type: "ADD_MESSAGE"; payload: ChatMessage }
  | { type: "APPEND_TO_LAST"; payload: string }
  | { type: "FINISH_STREAM" }
  | { type: "SET_LOADING"; payload: boolean }
  | { type: "SET_OPEN"; payload: boolean }
  | { type: "SET_ERROR"; payload: string | null }
  | { type: "CLEAR" };

function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "ADD_MESSAGE":
      return { ...state, messages: [...state.messages, action.payload] };
    case "APPEND_TO_LAST": {
      const msgs = [...state.messages];
      const last = msgs[msgs.length - 1];
      if (last && last.role === "assistant") {
        msgs[msgs.length - 1] = { ...last, content: last.content + action.payload };
      }
      return { ...state, messages: msgs };
    }
    case "FINISH_STREAM": {
      const msgs = [...state.messages];
      const last = msgs[msgs.length - 1];
      if (last && last.role === "assistant") {
        msgs[msgs.length - 1] = { ...last, isStreaming: false };
      }
      return { ...state, messages: msgs, isLoading: false };
    }
    case "SET_LOADING":
      return { ...state, isLoading: action.payload };
    case "SET_OPEN":
      return { ...state, isOpen: action.payload };
    case "SET_ERROR":
      return { ...state, error: action.payload, isLoading: false };
    case "CLEAR":
      return { ...state, messages: [], error: null };
    default:
      return state;
  }
}

interface ChatContextValue {
  state: ChatState;
  sendMessage: (content: string) => void;
  setOpen: (open: boolean) => void;
  clearChat: () => void;
}

const ChatContext = createContext<ChatContextValue | null>(null);

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const abortRef = useRef<AbortController | null>(null);

  const [state, dispatch] = useReducer(chatReducer, {
    messages: [],
    isLoading: false,
    isOpen: false,
    error: null,
  });

  const sendMessage = useCallback(
    async (content: string) => {
      if (!content.trim()) return;

      // Abort any ongoing request
      abortRef.current?.abort();
      abortRef.current = new AbortController();

      const userMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: content.trim(),
        timestamp: Date.now(),
      };
      dispatch({ type: "ADD_MESSAGE", payload: userMsg });
      dispatch({ type: "SET_LOADING", payload: true });
      dispatch({ type: "SET_ERROR", payload: null });

      // Add placeholder assistant message
      const assistantMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: "",
        timestamp: Date.now(),
        isStreaming: true,
      };
      dispatch({ type: "ADD_MESSAGE", payload: assistantMsg });

      try {
        const allMessages = [...state.messages, userMsg].map((m) => ({
          role: m.role,
          content: m.content,
        }));

        const res = await fetch("/api/chatbot/message", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: allMessages, currentPage: pathname }),
          signal: abortRef.current.signal,
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: "Request failed" }));
          throw new Error(err.error || err.message || `HTTP ${res.status}`);
        }

        const reader = res.body?.getReader();
        if (!reader) throw new Error("No response stream");

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            try {
              const data = JSON.parse(line.slice(6));
              if (data.type === "text") {
                dispatch({ type: "APPEND_TO_LAST", payload: data.content });
              } else if (data.type === "error") {
                dispatch({ type: "SET_ERROR", payload: data.message });
              }
            } catch {
              // skip malformed JSON
            }
          }
        }

        dispatch({ type: "FINISH_STREAM" });
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") return;
        dispatch({
          type: "SET_ERROR",
          payload: err instanceof Error ? err.message : "Something went wrong",
        });
        dispatch({ type: "FINISH_STREAM" });
      }
    },
    [state.messages, pathname]
  );

  const setOpen = useCallback((open: boolean) => {
    dispatch({ type: "SET_OPEN", payload: open });
  }, []);

  const clearChat = useCallback(() => {
    abortRef.current?.abort();
    dispatch({ type: "CLEAR" });
  }, []);

  return (
    <ChatContext.Provider value={{ state, sendMessage, setOpen, clearChat }}>
      {children}
    </ChatContext.Provider>
  );
}

export function useChatbot() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error("useChatbot must be used within ChatProvider");
  return ctx;
}
