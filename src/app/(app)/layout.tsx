import React from "react";
import { Header } from "@/components/layout/Header";
import { Sidebar } from "@/components/layout/Sidebar";
import { AuthGuard } from "@/components/auth/AuthGuard";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { SalesShiftMonitor } from "@/components/sales/SalesShiftMonitor";
import { ChatProvider } from "@/components/chatbot/ChatProvider";
import { ChatWidget } from "@/components/chatbot/ChatWidget";
import { AccountingEntityProvider } from "@/providers/AccountingEntityProvider";
import { AccountingWorkspaceNav } from "@/components/accounting/navigation/AccountingWorkspaceNav";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <ChatProvider>
        <AccountingEntityProvider>
          <div className="flex h-screen overflow-hidden bg-muted" dir="rtl">
            <Sidebar />
            <div className="flex w-full flex-col lg:pr-[240px] bg-muted relative">
              <Header />
              <AccountingWorkspaceNav />
              <SalesShiftMonitor />
              <main className="flex-1 overflow-auto p-4 md:p-8 mr-0 lg:mr-2">
                <div className="mx-auto max-w-7xl">
                  <ErrorBoundary>
                    {children}
                  </ErrorBoundary>
                </div>
              </main>
            </div>
            <ChatWidget />
          </div>
        </AccountingEntityProvider>
      </ChatProvider>
    </AuthGuard>
  );
}
