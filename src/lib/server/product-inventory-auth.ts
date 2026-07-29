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

export const productInventoryManagerRoles = [
  "admin",
  "sales_manager",
  "onground_agent_manager",
] as const;

export const productInventoryHandoverRoles = [
  ...productInventoryManagerRoles,
  "inventory_receiver",
] as const;

export const productInventoryCommerceRoles = [
  ...productInventoryManagerRoles,
  "field_agent",
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

export function requireProductInventoryManagerAccess(request?: NextRequest) {
  return requireTenantContext(
    { feature: "sales", roles: productInventoryManagerRoles, requireEmployee: true },
    request
  );
}

export function requireProductInventoryHandoverAccess(request?: NextRequest) {
  return requireTenantContext(
    { feature: "sales", roles: productInventoryHandoverRoles, requireEmployee: true },
    request
  );
}

export function requireProductInventoryCommerceAccess(request?: NextRequest) {
  return requireTenantContext(
    { feature: "sales", roles: productInventoryCommerceRoles, requireEmployee: true },
    request
  );
}

export function requireProductInventoryAgentAccess(request?: NextRequest) {
  return requireTenantContext(
    { feature: "sales", roles: ["field_agent"], requireEmployee: true },
    request
  );
}
