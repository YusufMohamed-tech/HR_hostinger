import { createAdminClient } from "@/lib/supabase/admin";
import type {
  AccountingLegalEntity,
  AccountingEntityContext,
} from "@/types/accounting";

export interface ResolvedAccountingContext extends AccountingEntityContext {
  userId: string;
  baseRole: "finance_manager" | "accountant" | "finance_viewer";
  allowedEntityIds: string[];
  allowedBranchIds: string[];
}

export async function resolveAccountingEntityContext(
  organizationId: string,
  userId: string,
  role: string,
  requestedEntityId?: string | null
): Promise<ResolvedAccountingContext | null> {
  const admin = createAdminClient();

  const { data: scopes } = await admin
    .from("accounting_user_scopes")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .eq("is_active", true);

  const activeScopes = (scopes || []).filter((s: Record<string, unknown>) => {
    if (s.effective_from && new Date(String(s.effective_from)) > new Date()) return false;
    if (s.effective_to && new Date(String(s.effective_to)) < new Date()) return false;
    return true;
  });

  const allowedEntityIds: string[] = [...new Set(activeScopes.map((s: Record<string, unknown>) => String(s.legal_entity_id)))];
  const allowedBranchIds: string[] = activeScopes
    .filter((s: Record<string, unknown>) => s.branch_id)
    .map((s: Record<string, unknown>) => String(s.branch_id));

  let targetEntityId: string | undefined = requestedEntityId || undefined;

  if (!targetEntityId || !allowedEntityIds.includes(targetEntityId)) {
    const { data: defaultEntity } = await admin
      .from("accounting_legal_entities")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("is_default", true)
      .eq("status", "active")
      .single();

    const defaultId = (defaultEntity as { id: string } | null)?.id;
    if (defaultId && allowedEntityIds.includes(defaultId)) {
      targetEntityId = defaultId;
    } else if (allowedEntityIds.length > 0) {
      targetEntityId = allowedEntityIds[0];
    } else {
      return null;
    }
  }

  const { data: entity } = await admin
    .from("accounting_legal_entities")
    .select("*")
    .eq("id", targetEntityId)
    .eq("organization_id", organizationId)
    .single();

  if (!entity) return null;
  const entityRow = entity as Record<string, unknown>;

  const { data: defaultBook } = await admin
    .from("accounting_books")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("legal_entity_id", targetEntityId)
    .eq("is_default", true)
    .eq("status", "active")
    .single();

  const bookRow = defaultBook as { id: string } | null;

  return {
    organizationId,
    legalEntityId: targetEntityId,
    bookId: bookRow?.id || undefined,
    functionalCurrency: String(entityRow.functional_currency_code || "SAR"),
    fiscalCalendarId: entityRow.fiscal_calendar_id ? String(entityRow.fiscal_calendar_id) : undefined,
    locale: (entityRow.default_language === "en" ? "en" : "ar") as "ar" | "en",
    timezone: String(entityRow.timezone || "Asia/Riyadh"),
    userId,
    baseRole: role as "finance_manager" | "accountant" | "finance_viewer",
    allowedEntityIds,
    allowedBranchIds,
  };
}

export async function ensureDefaultEntity(organizationId: string): Promise<string | null> {
  const admin = createAdminClient();

  const { data: existing } = await admin
    .from("accounting_legal_entities")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("is_default", true)
    .limit(1)
    .single();

  if (existing) return (existing as { id: string }).id;

  const { data, error } = await admin.rpc("accounting_backfill_default_entity", {
    p_org_id: organizationId,
  });

  if (error) return null;
  return data as string;
}

export async function getUserAllowedEntities(
  organizationId: string,
  userId: string
): Promise<AccountingLegalEntity[]> {
  const admin = createAdminClient();

  const { data: scopes } = await admin
    .from("accounting_user_scopes")
    .select("legal_entity_id")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .eq("is_active", true);

  if (!scopes || scopes.length === 0) {
    const { data: entities } = await admin
      .from("accounting_legal_entities")
      .select("*")
      .eq("organization_id", organizationId)
      .in("status", ["active", "draft"])
      .order("is_default", { ascending: false })
      .order("code");
    return (entities || []) as unknown as AccountingLegalEntity[];
  }

  const entityIds = [...new Set((scopes as Record<string, unknown>[]).map((s) => String(s.legal_entity_id)))];

  const { data: entities } = await admin
    .from("accounting_legal_entities")
    .select("*")
    .eq("organization_id", organizationId)
    .in("id", entityIds)
    .in("status", ["active", "draft"])
    .order("is_default", { ascending: false })
    .order("code");

  return (entities || []) as unknown as AccountingLegalEntity[];
}
