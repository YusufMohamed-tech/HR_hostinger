import { NextResponse } from "next/server";
import { requireTenantContext } from "@/lib/server/tenant-context";

const fieldAgentManagerRoles = new Set(["admin", "sales_manager", "onground_agent_manager"]);
const fieldAgentAllRoles = new Set(["field_agent", "admin", "sales_manager", "onground_agent_manager"]);

export async function requireFieldAgentAccess(options?: { managerOnly?: boolean }) {
  const auth = await requireTenantContext({ feature: "sales" });
  if ("error" in auth) return auth;

  const allowed = options?.managerOnly
    ? fieldAgentManagerRoles.has(auth.role)
    : fieldAgentAllRoles.has(auth.role);

  if (!allowed) {
    return {
      error: NextResponse.json(
        { message: "Field agent access is not available for this role." },
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
    isManager: fieldAgentManagerRoles.has(auth.role),
  };
}

export async function requireFieldAgentManager() {
  return requireFieldAgentAccess({ managerOnly: true });
}

export { fieldAgentAllRoles, fieldAgentManagerRoles };
