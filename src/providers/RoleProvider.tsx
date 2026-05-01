"use client";

import React, { createContext, useContext, useEffect, useState, ReactNode, useCallback } from "react";
import { Role, User } from "@/types";
import { createClient } from "@/lib/supabase/client";
import type { User as SupabaseUser } from "@supabase/supabase-js";

interface RoleContextProps {
  currentUser: User | null;
  loading: boolean;
  login: (input: { email: string; role: Role; name?: string }) => Promise<{ success: boolean; message: string }>;
  logout: () => Promise<void>;
  switchRole: (role: Role) => void;
  supabaseUser: SupabaseUser | null;
}

const RoleContext = createContext<RoleContextProps | undefined>(undefined);

/**
 * Map database role string to the UI Role type.
 */
function mapDbRole(dbRole: string | null | undefined): Role {
  switch (dbRole) {
    case "super_admin": return "Super Admin";
    case "admin": return "Admin";
    case "team_leader": return "Team Leader";
    case "employee": return "Employee";
    default: return "Employee";
  }
}

export function RoleProvider({ children }: { children: ReactNode }) {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [supabaseUser, setSupabaseUser] = useState<SupabaseUser | null>(null);
  const [loading, setLoading] = useState(true);

  const supabase = createClient();

  /**
   * Fetch the user's profile + role from Supabase and build the User object.
   */
  const loadUserData = useCallback(async (authUser: SupabaseUser) => {
    // Fetch org membership (role)
    const { data: membership } = await supabase
      .from("org_members" as never)
      .select("org_id, role")
      .eq("user_id", authUser.id)
      .limit(1)
      .single() as { data: { org_id: string; role: string } | null; error: unknown };

    // Fetch profile
    const { data: profile } = await supabase
      .from("profiles" as never)
      .select("full_name, email, phone, title")
      .eq("user_id", authUser.id)
      .single() as { data: { full_name: string | null; email: string | null; phone: string | null; title: string | null } | null; error: unknown };

    const role = mapDbRole(membership?.role);
    const orgId = membership?.org_id ?? "";

    const user: User = {
      id: authUser.id,
      name: profile?.full_name ?? authUser.email?.split("@")[0] ?? "User",
      email: profile?.email ?? authUser.email ?? "",
      role,
      orgId,
    };

    setCurrentUser(user);
    setSupabaseUser(authUser);
  }, [supabase]);

  /**
   * Initialize: check existing Supabase session.
   */
  useEffect(() => {
    const init = async () => {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (authUser) {
        await loadUserData(authUser);
      }
      setLoading(false);
    };

    init();

    // Listen for auth state changes (login, logout, token refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (event === "SIGNED_IN" && session?.user) {
          await loadUserData(session.user);
        } else if (event === "SIGNED_OUT") {
          setCurrentUser(null);
          setSupabaseUser(null);
        }
      }
    );

    return () => subscription.unsubscribe();
  }, [loadUserData, supabase.auth]);

  /**
   * Login with magic link.
   * Returns a message to display (e.g. "Check your email").
   */
  const login = async (input: { email: string; role: Role; name?: string }): Promise<{ success: boolean; message: string }> => {
    const { error } = await supabase.auth.signInWithOtp({
      email: input.email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
        data: {
          full_name: input.name || input.email.split("@")[0],
          requested_role: input.role,
        },
      },
    });

    if (error) {
      return { success: false, message: error.message };
    }

    return { success: true, message: "Magic link sent! Check your email inbox." };
  };

  /**
   * Sign out — clears the Supabase session.
   */
  const logout = async () => {
    await supabase.auth.signOut();
    setCurrentUser(null);
    setSupabaseUser(null);
  };

  /**
   * Switch role (admin feature for testing).
   * Updates the org_members record in the database.
   */
  const switchRole = (role: Role) => {
    if (!currentUser) return;

    // Update local state immediately for responsive UI
    setCurrentUser({ ...currentUser, role });

    // Note: In Phase 3+ we'll add an API route to persist this
    // to org_members. For now it's client-side only.
  };

  return (
    <RoleContext.Provider value={{ currentUser, loading, login, logout, switchRole, supabaseUser }}>
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
