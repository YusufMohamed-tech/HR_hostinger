import { NextRequest, NextResponse } from "next/server";
import { requireTenantContext } from "@/lib/server/tenant-context";

const managerRoles = new Set(["admin", "hr_admin", "sales_manager"]);
const salesRoles = new Set(["sales", "sales_manager", "admin", "hr_admin"]);

export async function requireSalesAccess(options?: { managerOnly?: boolean }, request?: NextRequest) {
  const auth = await requireTenantContext({ feature: "sales" }, request);
  if ("error" in auth) return auth;

  const allowed = options?.managerOnly ? managerRoles.has(auth.role) : salesRoles.has(auth.role);
  if (!allowed) {
    return { error: NextResponse.json({ message: "Sales access is not available for this role." }, { status: 403 }) };
  }

  return {
    user: auth.user,
    orgId: auth.orgId,
    role: auth.role,
    isManager: managerRoles.has(auth.role),
    timezone: auth.timezone,
    requestId: auth.requestId,
    admin: auth.admin,
  };
}

export { managerRoles, salesRoles };
