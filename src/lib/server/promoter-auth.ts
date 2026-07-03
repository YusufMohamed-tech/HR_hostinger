import { NextResponse } from "next/server";
import { requireTenantContext } from "@/lib/server/tenant-context";

const promoterManagerRoles = new Set(["admin", "hr_admin", "sales_manager"]);
const promoterCaptureRoles = new Set(["promoter", "admin", "hr_admin", "sales_manager"]);
const promoterViewRoles = new Set(["promoter", "sales", "sales_manager", "admin", "hr_admin"]);

export async function requirePromoterAccess(options?: { managerOnly?: boolean; captureOnly?: boolean }) {
  const auth = await requireTenantContext({ feature: "sales" });
  if ("error" in auth) return auth;

  const allowed = options?.managerOnly
    ? promoterManagerRoles.has(auth.role)
    : options?.captureOnly
      ? promoterCaptureRoles.has(auth.role)
      : promoterViewRoles.has(auth.role);

  if (!allowed) {
    return { error: NextResponse.json({ message: "Promoter access is not available for this role." }, { status: 403 }) };
  }

  return {
    user: auth.user,
    orgId: auth.orgId,
    employeeId: auth.employeeId,
    role: auth.role,
    admin: auth.admin,
    isManager: promoterManagerRoles.has(auth.role),
    canCapture: promoterCaptureRoles.has(auth.role),
  };
}

export async function requirePromoterAdmin() {
  return requirePromoterAccess({ managerOnly: true });
}

export { promoterCaptureRoles, promoterManagerRoles, promoterViewRoles };
