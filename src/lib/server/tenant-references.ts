import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

const TENANT_REFERENCE_TABLES = {
  departments: "org_id",
  locations: "org_id",
  employees: "org_id",
  shifts: "org_id",
  leave_requests: "org_id",
  payslips: "org_id",
  employee_assets: "org_id",
  job_postings: "org_id",
  job_applications: "org_id",
  accounting_accounts: "organization_id",
  accounting_journal_entries: "organization_id",
  accounting_invoices: "organization_id",
  sim_cards: "organization_id",
  sim_sales: "organization_id",
  field_agents: "organization_id",
  merchants: "organization_id",
} as const;

export type TenantReferenceTable = keyof typeof TENANT_REFERENCE_TABLES;

export class TenantReferenceNotFoundError extends Error {
  readonly status = 404;

  constructor(table: TenantReferenceTable) {
    super(`${table} reference was not found in the current organization.`);
    this.name = "TenantReferenceNotFoundError";
  }
}

export async function requireTenantReference(
  orgId: string,
  table: TenantReferenceTable,
  id: string
) {
  const normalizedId = id.trim();
  if (!normalizedId) throw new TenantReferenceNotFoundError(table);

  const admin = createAdminClient();
  const tenantColumn = TENANT_REFERENCE_TABLES[table];
  const { data, error } = await admin
    .from(table as string)
    .select(`id, ${tenantColumn}`)
    .eq("id", normalizedId)
    .eq(tenantColumn, orgId)
    .maybeSingle();

  if (error) throw new Error(`Unable to validate ${table} reference: ${error.message}`);
  if (!data) throw new TenantReferenceNotFoundError(table);
  return data;
}

export async function requireTenantReferences(
  orgId: string,
  table: TenantReferenceTable,
  ids: readonly string[]
) {
  const uniqueIds = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
  if (uniqueIds.length !== ids.length) throw new TenantReferenceNotFoundError(table);
  if (uniqueIds.length === 0) return [];

  const admin = createAdminClient();
  const tenantColumn = TENANT_REFERENCE_TABLES[table];
  const { data, error } = await admin
    .from(table as string)
    .select(`id, ${tenantColumn}`)
    .eq(tenantColumn, orgId)
    .in("id", uniqueIds);

  if (error) throw new Error(`Unable to validate ${table} references: ${error.message}`);
  if (!data || data.length !== uniqueIds.length) throw new TenantReferenceNotFoundError(table);
  return data;
}
