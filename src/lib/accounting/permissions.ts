import type { NextRequest } from "next/server";
import { requireTenantContext } from "@/lib/server/tenant-context";

export type AccountingAction = "view" | "manage" | "post" | "settings" | "payroll" | "sales" | "reports";

export type AccountingAuthContext = {
  user: { id: string; email?: string | null };
  orgId: string;
  role: string;
  isSuperadmin: false;
  canView: boolean;
  canManage: boolean;
  canPost: boolean;
  canManageSettings: boolean;
  canViewReports: boolean;
  requestId: string;
};

const viewRoles = new Set(["finance_manager", "accountant", "finance_viewer"]);
const manageRoles = new Set(["finance_manager", "accountant"]);
const postRoles = new Set(["finance_manager"]);

export function getAccountingCapabilities(role: string) {
  return {
    canView: viewRoles.has(role),
    canManage: manageRoles.has(role),
    canPost: postRoles.has(role),
    canManageSettings: postRoles.has(role),
    canViewPayrollStatus: ["admin", "hr_admin", "finance_manager", "accountant", "finance_viewer"].includes(role),
    canViewSalesStatus: ["sales_manager", "finance_manager", "accountant", "finance_viewer"].includes(role),
    canViewReports: viewRoles.has(role),
  };
}

function allowedRoles(action: AccountingAction) {
  if (action === "post" || action === "settings") return ["finance_manager"] as const;
  if (action === "manage") return ["finance_manager", "accountant"] as const;
  if (action === "payroll") return ["admin", "hr_admin", "finance_manager", "accountant", "finance_viewer"] as const;
  if (action === "sales") return ["sales_manager", "finance_manager", "accountant", "finance_viewer"] as const;
  return ["finance_manager", "accountant", "finance_viewer"] as const;
}

export async function requireAccountingAccess(action: AccountingAction = "view", request?: NextRequest) {
  const tenant = await requireTenantContext({
    roles: allowedRoles(action),
    feature: "accounting",
  }, request);
  if ("error" in tenant) return tenant;

  const capabilities = getAccountingCapabilities(tenant.role);
  const allowed =
    action === "view" ? capabilities.canView :
    action === "manage" ? capabilities.canManage :
    action === "post" ? capabilities.canPost :
    action === "settings" ? capabilities.canManageSettings :
    action === "payroll" ? capabilities.canViewPayrollStatus :
    action === "sales" ? capabilities.canViewSalesStatus :
    action === "reports" ? capabilities.canViewReports :
    false;

  if (!allowed) return { error: new Response(JSON.stringify({ message: "ليست لديك صلاحية للوصول إلى المالية والمحاسبة." }), {
    status: 403,
    headers: { "content-type": "application/json", "x-request-id": tenant.requestId },
  }) };

  return {
    user: { id: tenant.user.id, email: tenant.user.email },
    orgId: tenant.orgId,
    role: tenant.role,
    isSuperadmin: false,
    ...capabilities,
    requestId: tenant.requestId,
  } satisfies AccountingAuthContext;
}
