import React from "react";
import { AuthGuard } from "@/components/auth/AuthGuard";
import { ErrorBoundary } from "@/components/ErrorBoundary";

export default function LearnLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <div className="min-h-screen bg-muted text-foreground" dir="rtl">
        <ErrorBoundary>{children}</ErrorBoundary>
      </div>
    </AuthGuard>
  );
}
