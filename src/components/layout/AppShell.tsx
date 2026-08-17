"use client";

import { usePathname } from "next/navigation";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { AccountingWorkspaceNav } from "@/components/accounting/navigation/AccountingWorkspaceNav";
import { SalesShiftMonitor } from "@/components/sales/SalesShiftMonitor";
import { ErrorBoundary } from "@/components/ErrorBoundary";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isFinanceRoute =
    pathname.startsWith("/accounting") ||
    pathname.startsWith("/banking") ||
    pathname.startsWith("/chat") ||
    pathname.startsWith("/notifications") ||
    pathname.startsWith("/payroll") ||
    pathname.startsWith("/lms") ||
    pathname.startsWith("/learn");

  return (
    <div className="flex h-screen overflow-hidden bg-muted" dir="rtl">
      {!isFinanceRoute && <Sidebar />}
      <div
        className={`flex w-full flex-col bg-muted relative ${
          isFinanceRoute ? "" : "lg:pr-[240px]"
        }`}
      >
        <Header />
        {isFinanceRoute && <AccountingWorkspaceNav />}
        <SalesShiftMonitor />
        <main className="flex-1 overflow-y-auto overflow-x-hidden p-4 md:p-8 mr-0 lg:mr-2">
          <div className="mx-auto max-w-7xl">
            <ErrorBoundary>{children}</ErrorBoundary>
          </div>
        </main>
      </div>
    </div>
  );
}
