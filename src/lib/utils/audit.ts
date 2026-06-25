import type { SupabaseClient } from "@supabase/supabase-js";

type AuditAction = "created" | "updated" | "deleted" | string;

interface AuditEntry {
  org_id: string;
  actor_user_id?: string | null;
  action: AuditAction;
  entity: string;
  entity_id?: string | null;
  old_values?: Record<string, unknown> | null;
  new_values?: Record<string, unknown> | null;
}

/**
 * Insert an immutable audit log entry.
 * Call this from service functions after any CRUD operation.
 * Uses `any` for the Supabase generic to avoid strict table-type coupling.
 */
export async function writeAuditLog(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  entry: AuditEntry
) {
  if (!entry.org_id || !entry.action || !entry.entity) {
    const message = "[audit] org_id, action, and entity are required.";
    console.error(message);
    return { data: null, error: { message } };
  }

  const { data, error } = await supabase.from("audit_logs").insert({
    org_id: entry.org_id,
    actor_user_id: entry.actor_user_id ?? null,
    action: entry.action,
    entity: entry.entity,
    entity_id: entry.entity_id ?? null,
    old_values: entry.old_values ?? null,
    new_values: entry.new_values ?? null,
  }).select("id").single();

  if (error) {
    console.error("[audit] Failed to write audit log:", error.message);
    return { data: null, error: { message: error.message } };
  }

  return { data: data as { id: string } | null, error: null };
}
