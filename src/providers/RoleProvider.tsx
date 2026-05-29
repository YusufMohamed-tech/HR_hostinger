"use client";

import React, { createContext, useContext, useEffect, useState, ReactNode, useCallback, useMemo } from "react";
import { OrgMembershipRole, User, WorkspaceRole } from "@/types";
import { createClient } from "@/lib/supabase/client";
import { roleFromOrgRole } from "@/lib/rbac";

interface RoleContextProps {
  currentUser: User | null;
  loading: boolean;
  login: (input: { email: string; password: string }) => Promise<{ success: boolean; message: string }>;
  logout: () => Promise<void>;
  refresh: () => Promise<User | null>;
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
      return null;
    }

    const [{ data: platformAdmin, error: platformAdminError }, { data: membership }, { data: profile }, { data: employee }] = await Promise.all([
      supabase
        .from("platform_admins")
        .select("role, status")
        .eq("user_id", user.id)
        .maybeSingle(),
      supabase
        .from("org_members")
        .select("org_id, role")
        .eq("user_id", user.id)
        .maybeSingle(),
      supabase
        .from("profiles")
        .select("full_name, email, account_status")
        .eq("user_id", user.id)
        .maybeSingle(),
      supabase
        .from("employees")
        .select("id")
        .eq("user_id", user.id)
        .maybeSingle(),
    ]);

    const membershipRecord = membership as unknown as Record<string, unknown> | null;
    const rawRole = typeof membershipRecord?.role === "string"
      ? membershipRecord.role as OrgMembershipRole
      : null;
    const platformAdminRecord = platformAdmin as unknown as Record<string, unknown> | null;
    const platformTableMissing = platformAdminError?.code === "42P01";
    const isPlatformSuperadmin = platformAdminRecord?.role === "superadmin" && platformAdminRecord.status === "active";
    const membershipRole = roleFromOrgRole(rawRole);
    const role = isPlatformSuperadmin
      ? "Superadmin"
      : !platformTableMissing && rawRole === "super_admin"
        ? null
        : membershipRole;
    const isSystemSuperadmin = isPlatformSuperadmin || (platformTableMissing && rawRole === "super_admin");
    const systemRole = isSystemSuperadmin ? "Superadmin" : null;
    const workspaceRole: WorkspaceRole | null = systemRole ? null : role as WorkspaceRole;

    if (!role) {
      setCurrentUser(null);
      setLoading(false);
      return null;
    }

    if (!isSystemSuperadmin) {
      const accountStatus = String((profile as unknown as Record<string, unknown>)?.account_status || "active").toLowerCase();
      const orgId = String(membershipRecord?.org_id || "");
      const { data: organization } = orgId
        ? await supabase.from("organizations").select("status").eq("id", orgId).maybeSingle()
        : { data: null };
      const organizationStatus = String((organization as unknown as Record<string, unknown> | null)?.status || "active").toLowerCase();

      if (accountStatus !== "active" || organizationStatus !== "active") {
        setCurrentUser(null);
        setLoading(false);
        return null;
      }
    }

    const name = String((profile as unknown as Record<string, unknown>)?.full_name || user.user_metadata?.full_name || user.email || "User");
    const email = String((profile as unknown as Record<string, unknown>)?.email || user.email || "");

    const nextUser: User = {
      id: user.id,
      name,
      email,
      role,
      systemRole,
      workspaceRole,
      orgMembershipRole: rawRole,
      orgId: isSystemSuperadmin ? "" : String(membershipRecord?.org_id || ""),
      employeeId: isSystemSuperadmin
        ? undefined
        : (employee as unknown as Record<string, unknown>)?.id ? String((employee as unknown as Record<string, unknown>)?.id) : undefined,
    };

    setCurrentUser(nextUser);
    setLoading(false);
    return nextUser;
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

    const loadedUser = await refresh();
    if (!loadedUser) {
      await supabase.auth.signOut();
      return { success: false, message: "الحساب أو المنظمة غير مفعلة حاليًا. تواصل مع مسؤول النظام." };
    }

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
