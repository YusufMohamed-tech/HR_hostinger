import React from "react";
import { Header } from "@/components/layout/Header";
import { Sidebar } from "@/components/layout/Sidebar";
import { AuthGuard } from "@/components/auth/AuthGuard";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <div className="flex h-screen overflow-hidden bg-muted">
        <Sidebar />
        <div className="flex w-full flex-col lg:pl-[240px] bg-muted relative">
          <Header />
          <main className="flex-1 overflow-auto p-4 md:p-8 ml-0 lg:ml-2">
            <div className="mx-auto max-w-7xl">
              {children}
            </div>
          </main>
        </div>
      </div>
    </AuthGuard>
  );
}
