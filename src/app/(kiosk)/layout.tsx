import React from "react";
import { AuthGuard } from "@/components/auth/AuthGuard";
import { ChatProvider } from "@/components/chatbot/ChatProvider";
import { ChatWidget } from "@/components/chatbot/ChatWidget";

export default function KioskLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <ChatProvider>
        {children}
        <ChatWidget />
      </ChatProvider>
    </AuthGuard>
  );
}
