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

export interface EntityContextError {
  error: string;
  status: number;
  message_ar: string;
  message_en: string;
}

export async function resolveAccountingEntityContext(
  organizationId: string,
  userId: string,
  role: string,
  requestedEntityId?: string | null
): Promise<ResolvedAccountingContext | EntityContextError> {
  const admin = createAdminClient();

  const { data: scopes } = await admin
    .from("accounting_user_scopes")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .eq("is_active", true);

  const isFullAccess = role === "finance_manager" || role === "admin" || role === "owner";

  const activeScopes = (scopes || []).filter((s: Record<string, unknown>) => {
    if (s.effective_from && new Date(String(s.effective_from)) > new Date()) return false;
    if (s.effective_to && new Date(String(s.effective_to)) < new Date()) return false;
    return true;
  });

  let allowedEntityIds: string[];
  const allowedBranchIds: string[] = activeScopes
    .filter((s: Record<string, unknown>) => s.branch_id)
    .map((s: Record<string, unknown>) => String(s.branch_id));

  if (isFullAccess) {
    const { data: allEntities } = await admin
      .from("accounting_legal_entities")
      .select("id")
      .eq("organization_id", organizationId)
      .in("status", ["active", "draft"]);
    allowedEntityIds = (allEntities || []).map((e: Record<string, unknown>) => String(e.id));
  } else {
    allowedEntityIds = [...new Set(activeScopes.map((s: Record<string, unknown>) => String(s.legal_entity_id)))];
  }

  if (allowedEntityIds.length === 0) {
    return {
      error: "no_entity_scope",
      status: 403,
      message_ar: "لا يوجد نطاق شركة مخصص لهذا المستخدم. يرجى التواصل مع المدير المالي.",
      message_en: "No entity scope assigned to this user. Contact the finance manager.",
    };
  }

  let targetEntityId: string | undefined = requestedEntityId || undefined;

  if (targetEntityId && !allowedEntityIds.includes(targetEntityId)) {
    return {
      error: "entity_scope_denied",
      status: 403,
      message_ar: "ليس لديك صلاحية الوصول إلى هذه الشركة.",
      message_en: "You do not have access to this entity.",
    };
  }

  if (!targetEntityId) {
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
    } else {
      targetEntityId = allowedEntityIds[0];
    }
  }

  const { data: entity } = await admin
    .from("accounting_legal_entities")
    .select("*")
    .eq("id", targetEntityId)
    .eq("organization_id", organizationId)
    .single();

  if (!entity) {
    return {
      error: "entity_not_found",
      status: 404,
      message_ar: "الشركة غير موجودة أو غير نشطة.",
      message_en: "Entity not found or inactive.",
    };
  }
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
  userId: string,
  role?: string
): Promise<AccountingLegalEntity[]> {
  const admin = createAdminClient();

  const isFullAccess = role === "finance_manager" || role === "admin" || role === "owner";

  if (isFullAccess) {
    const { data: entities } = await admin
      .from("accounting_legal_entities")
      .select("*")
      .eq("organization_id", organizationId)
      .in("status", ["active", "draft"])
      .order("is_default", { ascending: false })
      .order("code");
    return (entities || []) as unknown as AccountingLegalEntity[];
  }

  const { data: scopes } = await admin
    .from("accounting_user_scopes")
    .select("legal_entity_id")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .eq("is_active", true);

  if (!scopes || scopes.length === 0) {
    return [];
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

export function isEntityContextError(result: ResolvedAccountingContext | EntityContextError): result is EntityContextError {
  return "error" in result;
}
