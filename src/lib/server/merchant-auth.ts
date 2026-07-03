import { NextResponse } from "next/server";
import { requireTenantContext } from "@/lib/server/tenant-context";

const managerRoles = new Set(["admin", "hr_admin", "sales_manager"]);
const agentRoles = new Set(["field_agent"]);
const merchantRoles = new Set(["merchant"]);
const allRoles = new Set([...managerRoles, ...agentRoles, ...merchantRoles]);

export async function requireMerchantAccess() {
  const auth = await requireTenantContext({ feature: "sales" });
  if ("error" in auth) return auth;

  if (!allRoles.has(auth.role)) {
    return {
      error: NextResponse.json(
        { message: "Merchant access is not available for this role." },
        { status: 403 }
      ),
    };
  }

  return {
    user: auth.user,
    orgId: auth.orgId,
    employeeId: auth.employeeId,
    role: auth.role,
    admin: auth.admin,
    isManager: managerRoles.has(auth.role),
    isAgent: agentRoles.has(auth.role),
    isMerchant: merchantRoles.has(auth.role),
  };
}

export { managerRoles, agentRoles, merchantRoles };
