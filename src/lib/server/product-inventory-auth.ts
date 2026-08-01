import { NextRequest } from "next/server";
import { requireTenantContext } from "@/lib/server/tenant-context";

export const productInventoryReceivingRoles = [
  "admin",
  "finance_manager",
] as const;

export const productInventoryFinanceRoles = [
  "finance_manager",
  "accountant",
  "finance_viewer",
] as const;

export const productInventoryManagerRoles = [
  "admin",
  "finance_manager",
] as const;

export const productInventoryHandoverRoles = [
  ...productInventoryManagerRoles,
] as const;

export const productInventoryCommerceRoles = [
  ...productInventoryManagerRoles,
  "field_agent",
] as const;

export const productInventoryCustodianRoles = [
  "admin",
  "finance_manager",
  "employee",
  "supervisor",
] as const;

export const productInventoryReturnRoles = [
  "admin",
  "finance_manager",
  "sales_manager",
  "employee",
  "supervisor",
] as const;

// Product distribution to traders is operationally visible to the on-ground
// manager, but warehouse receiving, cost, pricing, and Finance-to-agent
// custody remain Finance-owned. New trader-product endpoints must use these
// capabilities instead of reusing the Finance inventory helpers.
export const productTraderOperationalManagerRoles = [
  "admin",
  "finance_manager",
  "onground_agent_manager",
] as const;

export const productTraderParticipantRoles = [
  ...productTraderOperationalManagerRoles,
  "field_agent",
  "merchant",
] as const;

export function requireProductInventoryAccess(request?: NextRequest) {
  return requireTenantContext(
    { anyFeatures: ["sales", "accounting"], roles: productInventoryReceivingRoles },
    request
  );
}

export function requireProductInventoryFinanceAccess(request?: NextRequest) {
  return requireTenantContext(
    { feature: "accounting", roles: productInventoryFinanceRoles },
    request
  );
}

export function requireProductInventoryManagerAccess(request?: NextRequest) {
  return requireTenantContext(
    { anyFeatures: ["sales", "accounting"], roles: productInventoryManagerRoles },
    request
  );
}

export function requireProductInventoryHandoverAccess(request?: NextRequest) {
  return requireTenantContext(
    { anyFeatures: ["sales", "accounting"], roles: productInventoryHandoverRoles },
    request
  );
}

export function requireProductInventoryCommerceAccess(request?: NextRequest) {
  return requireTenantContext(
    { anyFeatures: ["sales", "accounting"], roles: productInventoryCommerceRoles },
    request
  );
}

export function requireProductInventoryAgentAccess(request?: NextRequest) {
  return requireTenantContext(
    { feature: "sales", roles: ["field_agent"], requireEmployee: true },
    request
  );
}

export function requireProductInventoryCustodianAccess(request?: NextRequest) {
  return requireTenantContext(
    {
      anyFeatures: ["sales", "accounting"],
      roles: productInventoryCustodianRoles,
      requireEmployee: true,
    },
    request
  );
}

export function requireProductInventoryReturnAccess(request?: NextRequest) {
  return requireTenantContext(
    {
      anyFeatures: ["sales", "accounting"],
      roles: productInventoryReturnRoles,
    },
    request
  );
}

export function requireProductTraderOperationalManagerAccess(request?: NextRequest) {
  return requireTenantContext(
    { feature: "sales", roles: productTraderOperationalManagerRoles },
    request
  );
}

export function requireProductTraderParticipantAccess(request?: NextRequest) {
  return requireTenantContext(
    { feature: "sales", roles: productTraderParticipantRoles },
    request
  );
}
