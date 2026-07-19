"use client";

import React, { createContext, useContext, useEffect, useState, ReactNode, useCallback, useMemo, useRef } from "react";
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
  const currentUserRef = useRef<User | null>(null);
  const supabase = useMemo(() => createClient(), []);

  useEffect(() => {
    currentUserRef.current = currentUser;
  }, [currentUser]);

  const refresh = useCallback(async (options?: { showLoading?: boolean }) => {
    const showLoading = options?.showLoading ?? !currentUserRef.current;
    if (showLoading) setLoading(true);
    const { data: userData, error: userError } = await supabase.auth.getUser();
    const user = userData?.user;

    if (userError || !user) {
      setCurrentUser(null);
      setLoading(false);
      return null;
    }

    const [platformResult, membershipResult, profileResult, employeeResult] = await Promise.all([
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

    const { data: platformAdmin, error: platformAdminError } = platformResult;
    const { data: membership, error: membershipError } = membershipResult;
    const { data: profile, error: profileError } = profileResult;
    const { data: employee, error: employeeError } = employeeResult;

    if (membershipError || profileError || employeeError) {
      console.error("Unable to resolve user workspace context", {
        membershipCode: membershipError?.code,
        profileCode: profileError?.code,
        employeeCode: employeeError?.code,
      });
      setCurrentUser(null);
      setLoading(false);
      return null;
    }

    const membershipRecord = membership as unknown as Record<string, unknown> | null;
    const rawRole = typeof membershipRecord?.role === "string"
      ? membershipRecord.role as OrgMembershipRole
      : null;
    const platformAdminRecord = platformAdmin as unknown as Record<string, unknown> | null;
    const isPlatformSuperadmin = platformAdminRecord?.role === "superadmin" && platformAdminRecord.status === "active";
    const membershipRole = roleFromOrgRole(rawRole);
    const role = isPlatformSuperadmin
      ? "Superadmin"
      : rawRole === "super_admin"
        ? null
        : membershipRole;
    const isSystemSuperadmin = isPlatformSuperadmin;
    const systemRole = isSystemSuperadmin ? "Superadmin" : null;
    const workspaceRole: WorkspaceRole | null = systemRole ? null : role as WorkspaceRole;
    const membershipOrgId = String(membershipRecord?.org_id || "");

    if (platformAdminRecord?.status === "suspended" || !role) {
      setCurrentUser(null);
      setLoading(false);
      return null;
    }

    if (!isSystemSuperadmin) {
      const accountStatus = String((profile as unknown as Record<string, unknown>)?.account_status || "").toLowerCase();
      const orgId = String(membershipRecord?.org_id || "");
      const { data: organization, error: organizationError } = orgId
        ? await supabase.from("organizations").select("status, deleted_at").eq("id", orgId).maybeSingle()
        : { data: null, error: null };
      const organizationRecord = organization as unknown as Record<string, unknown> | null;
      const organizationStatus = String(organizationRecord?.status || "").toLowerCase();

      if (
        !profile
        || organizationError
        || !organizationRecord
        || organizationRecord.deleted_at
        || accountStatus !== "active"
        || organizationStatus !== "active"
      ) {
        setCurrentUser(null);
        setLoading(false);
        return null;
      }
    }

    if (platformAdminError) {
      console.error("Platform role lookup failed", { code: platformAdminError.code });
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
      orgId: membershipOrgId,
      employeeId: isSystemSuperadmin
        ? undefined
        : (employee as unknown as Record<string, unknown>)?.id ? String((employee as unknown as Record<string, unknown>)?.id) : undefined,
    };

    setCurrentUser(nextUser);
    setLoading(false);
    return nextUser;
  }, [supabase]);

  useEffect(() => {
    refresh({ showLoading: true });
    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === "TOKEN_REFRESHED") return;
      if (event === "SIGNED_OUT") {
        setCurrentUser(null);
        setLoading(false);
        return;
      }
      refresh({ showLoading: false });
    });
    return () => {
      listener.subscription.unsubscribe();
    };
  }, [refresh, supabase]);

  const login = async (input: { email: string; password: string }): Promise<{ success: boolean; message: string }> => {
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      return { success: false, message: String(payload?.message || "البريد الإلكتروني أو كلمة المرور غير صحيحة.") };
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
