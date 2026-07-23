import { createAdminClient } from "@/lib/supabase/admin";
import { randomUUID } from "node:crypto";
import type {
  AccountingLegalEntity,
  AccountingBranch,
  AccountingBook,
  AccountingUserScope,
  AccountingCurrency,
  AccountingExchangeRate,
  AccountingFiscalCalendar,
} from "@/types/accounting";

interface CommandParams {
  orgId: string;
  actorUserId: string;
  entityType: string;
  entityId?: string | null;
  expectedVersion?: number;
  operation: string;
  payload: Record<string, unknown>;
}

async function executeEntityCommand(params: CommandParams) {
  const admin = createAdminClient();
  const requestId = randomUUID();
  const commandId = randomUUID();

  const { data, error } = await admin.rpc("execute_accounting_entity_command", {
    p_org_id: params.orgId,
    p_actor_user_id: params.actorUserId,
    p_request_id: requestId,
    p_command_id: commandId,
    p_entity_type: params.entityType,
    p_entity_id: params.entityId || null,
    p_expected_version: params.expectedVersion ?? 0,
    p_operation: params.operation,
    p_payload: params.payload,
  });

  if (error) throw error;
  return data;
}

// Legal Entities
export async function getLegalEntities(orgId: string): Promise<AccountingLegalEntity[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("accounting_legal_entities")
    .select("*")
    .eq("organization_id", orgId)
    .order("is_default", { ascending: false })
    .order("code");
  if (error) throw error;
  return (data || []) as unknown as AccountingLegalEntity[];
}

export async function getLegalEntity(orgId: string, id: string): Promise<AccountingLegalEntity | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("accounting_legal_entities")
    .select("*")
    .eq("organization_id", orgId)
    .eq("id", id)
    .single();
  if (error) return null;
  return data as unknown as AccountingLegalEntity;
}

export async function saveLegalEntity(params: CommandParams) {
  return executeEntityCommand({ ...params, entityType: "legal_entity" });
}

export async function changeLegalEntityStatus(
  orgId: string,
  actorUserId: string,
  entityId: string,
  status: string,
  expectedVersion: number
) {
  return executeEntityCommand({
    orgId,
    actorUserId,
    entityType: "legal_entity",
    entityId,
    expectedVersion,
    operation: "status_change",
    payload: { status },
  });
}

// Branches
export async function getBranches(orgId: string, legalEntityId?: string): Promise<AccountingBranch[]> {
  const admin = createAdminClient();
  let query = admin
    .from("accounting_branches")
    .select("*")
    .eq("organization_id", orgId)
    .order("code");
  if (legalEntityId) {
    query = query.eq("legal_entity_id", legalEntityId);
  }
  const { data, error } = await query;
  if (error) throw error;
  return (data || []) as unknown as AccountingBranch[];
}

export async function saveBranch(params: CommandParams) {
  return executeEntityCommand({ ...params, entityType: "branch" });
}

export async function deactivateBranch(
  orgId: string,
  actorUserId: string,
  branchId: string,
  expectedVersion: number
) {
  return executeEntityCommand({
    orgId,
    actorUserId,
    entityType: "branch",
    entityId: branchId,
    expectedVersion,
    operation: "deactivate",
    payload: {},
  });
}

// Books
export async function getBooks(orgId: string, legalEntityId?: string): Promise<AccountingBook[]> {
  const admin = createAdminClient();
  let query = admin
    .from("accounting_books")
    .select("*")
    .eq("organization_id", orgId)
    .order("is_default", { ascending: false })
    .order("code");
  if (legalEntityId) {
    query = query.eq("legal_entity_id", legalEntityId);
  }
  const { data, error } = await query;
  if (error) throw error;
  return (data || []) as unknown as AccountingBook[];
}

export async function saveBook(params: CommandParams) {
  return executeEntityCommand({ ...params, entityType: "book" });
}

// User Scopes
export async function getUserScopes(orgId: string, legalEntityId?: string): Promise<AccountingUserScope[]> {
  const admin = createAdminClient();
  let query = admin
    .from("accounting_user_scopes")
    .select("*")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false });
  if (legalEntityId) {
    query = query.eq("legal_entity_id", legalEntityId);
  }
  const { data, error } = await query;
  if (error) throw error;
  return (data || []) as unknown as AccountingUserScope[];
}

export async function saveUserScope(params: CommandParams) {
  return executeEntityCommand({ ...params, entityType: "scope" });
}

export async function revokeUserScope(
  orgId: string,
  actorUserId: string,
  scopeId: string
) {
  return executeEntityCommand({
    orgId,
    actorUserId,
    entityType: "scope",
    entityId: scopeId,
    operation: "revoke",
    payload: {},
  });
}

// Currencies
export async function getCurrencies(orgId: string): Promise<AccountingCurrency[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("accounting_currencies")
    .select("*")
    .eq("organization_id", orgId)
    .order("code");
  if (error) throw error;
  return (data || []) as unknown as AccountingCurrency[];
}

export async function saveCurrency(params: CommandParams) {
  return executeEntityCommand({ ...params, entityType: "currency" });
}

// Exchange Rates
export async function getExchangeRates(
  orgId: string,
  filters?: { from?: string; to?: string; date?: string; type?: string }
): Promise<AccountingExchangeRate[]> {
  const admin = createAdminClient();
  let query = admin
    .from("accounting_exchange_rates")
    .select("*")
    .eq("organization_id", orgId)
    .order("rate_date", { ascending: false })
    .limit(100);
  if (filters?.from) query = query.eq("from_currency_code", filters.from);
  if (filters?.to) query = query.eq("to_currency_code", filters.to);
  if (filters?.date) query = query.eq("rate_date", filters.date);
  if (filters?.type) query = query.eq("rate_type", filters.type);
  const { data, error } = await query;
  if (error) throw error;
  return (data || []) as unknown as AccountingExchangeRate[];
}

export async function saveExchangeRate(params: CommandParams) {
  return executeEntityCommand({ ...params, entityType: "rate" });
}

export async function approveExchangeRate(
  orgId: string,
  actorUserId: string,
  rateId: string
) {
  return executeEntityCommand({
    orgId,
    actorUserId,
    entityType: "rate",
    entityId: rateId,
    operation: "approve",
    payload: {},
  });
}

// Fiscal Calendars
export async function getFiscalCalendars(orgId: string): Promise<AccountingFiscalCalendar[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("accounting_fiscal_calendars")
    .select("*")
    .eq("organization_id", orgId)
    .order("code");
  if (error) throw error;
  return (data || []) as unknown as AccountingFiscalCalendar[];
}

export async function saveFiscalCalendar(params: CommandParams) {
  return executeEntityCommand({ ...params, entityType: "calendar" });
}
