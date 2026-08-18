"use client";

import { usePathname } from "next/navigation";
import { useRoleContext } from "@/providers/RoleProvider";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { AccountingWorkspaceNav } from "@/components/accounting/navigation/AccountingWorkspaceNav";
import { SalesShiftMonitor } from "@/components/sales/SalesShiftMonitor";
import { ErrorBoundary } from "@/components/ErrorBoundary";

const FINANCE_ROLES = new Set(["Finance_Manager", "Accountant", "Finance_Viewer"]);

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { currentUser } = useRoleContext();
  const role = currentUser?.role ?? "";
  const isFinanceUser = FINANCE_ROLES.has(role);
  const isFinanceRoute =
    isFinanceUser ||
    pathname.startsWith("/accounting") ||
    pathname.startsWith("/banking");

  return (
    <div className="flex h-screen bg-muted" dir="rtl">
      {!isFinanceRoute && <Sidebar />}
      <div
        className={`flex w-full flex-col bg-muted relative min-h-0 ${
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
