import { NextRequest } from "next/server";
import { requireTenantContext } from "@/lib/server/tenant-context";

export const productInventoryReceivingRoles = [
  "admin",
  "sales_manager",
  "onground_agent_manager",
  "inventory_receiver",
] as const;

export const productInventoryFinanceRoles = [
  "finance_manager",
  "accountant",
  "finance_viewer",
] as const;

export function requireProductInventoryAccess(request?: NextRequest) {
  return requireTenantContext(
    { feature: "sales", roles: productInventoryReceivingRoles, requireEmployee: true },
    request
  );
}

export function requireProductInventoryFinanceAccess(request?: NextRequest) {
  return requireTenantContext(
    { feature: "accounting", roles: productInventoryFinanceRoles, requireEmployee: true },
    request
  );
}
