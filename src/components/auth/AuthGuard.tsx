"use client";

import React, { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useRoleContext } from "@/providers/RoleProvider";

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { currentUser, loading } = useRoleContext();

  useEffect(() => {
    if (!loading && !currentUser) {
      router.replace("/login");
    }
  }, [loading, currentUser, router]);

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <div className="text-sm text-gray-500">Checking session...</div>
      </div>
    );
  }

  if (!currentUser) {
    return null;
  }

  return <>{children}</>;
}
