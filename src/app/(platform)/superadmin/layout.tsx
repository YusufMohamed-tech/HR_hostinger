import React from "react";
import { AuthGuard } from "@/components/auth/AuthGuard";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { PlatformHeader } from "@/components/layout/PlatformHeader";
import { PlatformSidebar } from "@/components/layout/PlatformSidebar";

export default function SuperadminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <div className="flex h-screen overflow-hidden bg-muted" dir="rtl">
        <PlatformSidebar />
        <div className="relative flex w-full flex-col bg-muted lg:pr-[260px]">
          <PlatformHeader />
          <main className="mr-0 flex-1 overflow-auto p-4 md:p-8 lg:mr-2">
            <div className="mx-auto max-w-7xl">
              <ErrorBoundary>{children}</ErrorBoundary>
            </div>
          </main>
        </div>
      </div>
    </AuthGuard>
  );
}