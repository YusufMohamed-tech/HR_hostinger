import React from "react";
import { AuthGuard } from "@/components/auth/AuthGuard";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ChatProvider } from "@/components/chatbot/ChatProvider";
import { ChatWidget } from "@/components/chatbot/ChatWidget";

export default function LearnLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <ChatProvider>
        <div className="min-h-screen bg-muted text-foreground" dir="rtl">
          <ErrorBoundary>{children}</ErrorBoundary>
        </div>
        <ChatWidget />
      </ChatProvider>
    </AuthGuard>
  );
}
