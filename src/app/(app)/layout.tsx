import React from "react";
import { AuthGuard } from "@/components/auth/AuthGuard";
import { ChatProvider } from "@/components/chatbot/ChatProvider";
import { ChatWidget } from "@/components/chatbot/ChatWidget";
import { AccountingEntityProvider } from "@/providers/AccountingEntityProvider";
import { AppShell } from "@/components/layout/AppShell";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <ChatProvider>
        <AccountingEntityProvider>
          <AppShell>{children}</AppShell>
          <ChatWidget />
        </AccountingEntityProvider>
      </ChatProvider>
    </AuthGuard>
  );
}
