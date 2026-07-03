import React from "react";
import { AuthGuard } from "@/components/auth/AuthGuard";

export default function AgentKioskLayout({ children }: { children: React.ReactNode }) {
  return <AuthGuard>{children}</AuthGuard>;
}
