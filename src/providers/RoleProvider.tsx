"use client";

import React, { createContext, useContext, useEffect, useState, ReactNode, useCallback, useMemo } from "react";
import { Role, User } from "@/types";
import { createClient } from "@/lib/supabase/client";

interface RoleContextProps {
  currentUser: User | null;
  loading: boolean;
  login: (input: { email: string; password: string }) => Promise<{ success: boolean; message: string }>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const RoleContext = createContext<RoleContextProps | undefined>(undefined);

export function RoleProvider({ children }: { children: ReactNode }) {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const supabase = useMemo(() => createClient(), []);

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data: userData, error: userError } = await supabase.auth.getUser();
    const user = userData?.user;

    if (userError || !user) {
      setCurrentUser(null);
      setLoading(false);
      return;
    }

    const [{ data: membership }, { data: profile }, { data: employee }] = await Promise.all([
      supabase
        .from("org_members")
        .select("org_id, role")
        .eq("user_id", user.id)
        .maybeSingle(),
      supabase
        .from("profiles")
        .select("full_name, email")
        .eq("user_id", user.id)
        .maybeSingle(),
      supabase
        .from("employees")
        .select("id")
        .eq("user_id", user.id)
        .maybeSingle(),
    ]);

    const rawRole = (membership as unknown as Record<string, unknown>)?.role;
    let role: Role = "Employee";
    if (rawRole === "admin") role = "Admin";
    else if (rawRole === "hr_admin") role = "HR_Admin";
    else if (rawRole === "hr_recruitment") role = "HR_Recruitment";
    else if (rawRole === "training_manager") role = "Training_Manager";

    const name = String((profile as unknown as Record<string, unknown>)?.full_name || user.user_metadata?.full_name || user.email || "User");
    const email = String((profile as unknown as Record<string, unknown>)?.email || user.email || "");

    setCurrentUser({
      id: user.id,
      name,
      email,
      role,
      orgId: String((membership as unknown as Record<string, unknown>)?.org_id || ""),
      employeeId: (employee as unknown as Record<string, unknown>)?.id ? String((employee as unknown as Record<string, unknown>)?.id) : undefined,
    });
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    refresh();
    const { data: listener } = supabase.auth.onAuthStateChange(() => {
      refresh();
    });
    return () => {
      listener.subscription.unsubscribe();
    };
  }, [refresh, supabase]);

  const login = async (input: { email: string; password: string }): Promise<{ success: boolean; message: string }> => {
    const { error } = await supabase.auth.signInWithPassword({
      email: input.email,
      password: input.password,
    });

    if (error) {
      return { success: false, message: "البريد الإلكتروني أو كلمة المرور غير صحيحة." };
    }

    await refresh();
    return { success: true, message: "تم تسجيل الدخول بنجاح." };
  };

  const logout = async () => {
    await supabase.auth.signOut();
    setCurrentUser(null);
  };

  return (
    <RoleContext.Provider value={{ currentUser, loading, login, logout, refresh }}>
      {children}
    </RoleContext.Provider>
  );
}

export function useRoleContext() {
  const context = useContext(RoleContext);
  if (!context) {
    throw new Error("useRoleContext must be used within a RoleProvider");
  }
  return context;
}
