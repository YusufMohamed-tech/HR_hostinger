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
  const { error } = await supabase.from("audit_logs").insert({
    org_id: entry.org_id,
    actor_user_id: entry.actor_user_id ?? null,
    action: entry.action,
    entity: entry.entity,
    entity_id: entry.entity_id ?? null,
    old_values: entry.old_values ?? null,
    new_values: entry.new_values ?? null,
  });

  if (error) {
    console.error("[audit] Failed to write audit log:", error.message);
  }
}
