import type { NextRequest } from "next/server";
import { requireTenantContext } from "@/lib/server/tenant-context";

export type AccountingAction = "view" | "manage" | "post" | "settings" | "payroll" | "sales" | "reports";

export type AccountingCapability =
  | "accounting:read"
  | "reports:export"
  | "journals:prepare"
  | "journals:post"
  | "master_data:edit_contacts"
  | "master_data:manage_coa"
  | "control_accounts:assign"
  | "party_netting:prepare"
  | "party_netting:approve"
  | "bank_statement:edit"
  | "bank_statement:recall_approved"
  | "bank_statement:archive"
  | "permissions:manage";

export type PartyPermission =
  | "customers:view" | "customers:create" | "customers:edit" | "customers:delete"
  | "vendors:view" | "vendors:create" | "vendors:edit" | "vendors:delete";

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
  capabilities: AccountingCapability[];
  requestId: string;
};

const viewRoles = new Set(["finance_manager", "accountant", "finance_viewer"]);
const manageRoles = new Set(["finance_manager", "accountant"]);
const postRoles = new Set(["finance_manager"]);

export function resolveCapabilities(role: string): AccountingCapability[] {
  switch (role) {
    case "finance_manager":
      return [
        "accounting:read", "reports:export", "journals:prepare", "journals:post",
        "master_data:edit_contacts", "master_data:manage_coa", "control_accounts:assign",
        "party_netting:prepare", "party_netting:approve",
        "bank_statement:edit", "bank_statement:recall_approved", "bank_statement:archive",
        "permissions:manage",
      ];
    case "accountant":
      return [
        "accounting:read", "reports:export", "journals:prepare",
        "master_data:edit_contacts", "party_netting:prepare", "bank_statement:edit",
      ];
    case "finance_viewer":
      return ["accounting:read", "reports:export"];
    default:
      return [];
  }
}

export function hasCapability(auth: AccountingAuthContext, cap: AccountingCapability): boolean {
  return auth.capabilities.includes(cap);
}

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
    capabilities: resolveCapabilities(tenant.role),
    requestId: tenant.requestId,
  } satisfies AccountingAuthContext;
}

const defaultPartyPermissions: Record<string, PartyPermission[]> = {
  finance_manager: ["customers:view", "customers:create", "customers:edit", "customers:delete", "vendors:view", "vendors:create", "vendors:edit", "vendors:delete"],
  accountant: ["customers:view", "customers:create", "customers:edit", "customers:delete", "vendors:view", "vendors:create", "vendors:edit", "vendors:delete"],
  finance_viewer: ["customers:view", "vendors:view"],
  sales: ["customers:view", "vendors:view"],
  sales_manager: ["customers:view", "customers:create", "customers:edit", "vendors:view"],
};

export function hasPartyPermission(role: string, permission: PartyPermission): boolean {
  const perms = defaultPartyPermissions[role];
  return perms ? perms.includes(permission) : false;
}
