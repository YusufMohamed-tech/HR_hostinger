import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export type AccountingAction = "view" | "manage" | "post" | "settings" | "payroll" | "sales" | "reports";

export type AccountingAuthContext = {
  user: { id: string; email?: string | null };
  orgId: string;
  role: string;
  isSuperadmin: boolean;
  canView: boolean;
  canManage: boolean;
  canPost: boolean;
  canManageSettings: boolean;
  canViewReports: boolean;
};

const viewRoles = new Set(["finance_manager", "accountant", "finance_viewer"]);
const manageRoles = new Set(["finance_manager", "accountant"]);
const postRoles = new Set(["finance_manager"]);

export function getAccountingCapabilities(role: string, isSuperadmin = false) {
  return {
    canView: isSuperadmin || viewRoles.has(role),
    canManage: manageRoles.has(role),
    canPost: postRoles.has(role),
    canManageSettings: postRoles.has(role),
    canViewPayrollStatus: role === "admin" || role === "hr_admin" || viewRoles.has(role) || isSuperadmin,
    canViewSalesStatus: role === "sales_manager" || viewRoles.has(role) || isSuperadmin,
    canViewReports: viewRoles.has(role) || isSuperadmin,
  };
}

export async function requireAccountingAccess(action: AccountingAction = "view") {
  const supabase = await createServerSupabaseClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  const user = userData?.user;

  if (userError || !user) {
    return { error: NextResponse.json({ message: "غير مصرح بالدخول." }, { status: 401 }) };
  }

  const [{ data: platformAdmin }, { data: membership, error: membershipError }] = await Promise.all([
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
  ]);

  const platform = platformAdmin as Record<string, unknown> | null;
  const isSuperadmin = platform?.role === "superadmin" && platform?.status === "active";
  const member = membership as Record<string, unknown> | null;
  const orgId = String(member?.org_id || "");
  const role = String(member?.role || "");
  const capabilities = getAccountingCapabilities(role, isSuperadmin);

  if (membershipError || (!isSuperadmin && (!orgId || !role))) {
    return { error: NextResponse.json({ message: "لا توجد صلاحية منظمة." }, { status: 403 }) };
  }

  const allowed =
    action === "view" ? capabilities.canView :
    action === "manage" ? capabilities.canManage :
    action === "post" ? capabilities.canPost :
    action === "settings" ? capabilities.canManageSettings :
    action === "payroll" ? capabilities.canViewPayrollStatus :
    action === "sales" ? capabilities.canViewSalesStatus :
    action === "reports" ? capabilities.canViewReports :
    false;

  if (!allowed) {
    return { error: NextResponse.json({ message: "ليست لديك صلاحية للوصول إلى المالية والمحاسبة." }, { status: 403 }) };
  }

  if (isSuperadmin && action !== "view" && action !== "payroll" && action !== "sales" && action !== "reports") {
    return { error: NextResponse.json({ message: "المشرف العام لديه وصول قراءة فقط لسجلات المحاسبة التشغيلية." }, { status: 403 }) };
  }

  return {
    user: { id: user.id, email: user.email },
    orgId,
    role,
    isSuperadmin,
    ...capabilities,
  } satisfies AccountingAuthContext;
}
