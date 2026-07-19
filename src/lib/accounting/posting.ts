import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { validateJournalLines, type JournalLineInput } from "@/lib/accounting/validation";

type AdminClient = ReturnType<typeof createAdminClient>;

type JournalInput = {
  orgId: string;
  userId: string;
  entryDate: string;
  description: string;
  lines: JournalLineInput[];
  sourceModule?: string;
  sourceId?: string | null;
  notes?: string | null;
  status?: "draft" | "pending_approval" | "posted";
  commandId?: string;
  requestId?: string;
  expectedVersion?: number;
};

type CommandOptions = {
  commandId?: string;
  requestId?: string;
  expectedVersion?: number;
};

function db(admin: AdminClient) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return admin as any;
}

function commandContext(options?: CommandOptions) {
  return {
    commandId: options?.commandId || randomUUID(),
    requestId: options?.requestId || randomUUID(),
  };
}

async function journalWithLines(admin: AdminClient, orgId: string, entryId: string) {
  const { data, error } = await db(admin)
    .from("accounting_journal_entries")
    .select("*, lines:accounting_journal_lines(*)")
    .eq("organization_id", orgId)
    .eq("id", entryId)
    .single();
  if (error) throw new Error(error.message);
  return data as Record<string, unknown>;
}

function firstRpcRow(data: unknown, operation: string) {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") throw new Error(`${operation} did not return a journal entry.`);
  return row as Record<string, unknown>;
}

export async function initializeAccountingDefaults(admin: AdminClient, orgId: string, userId: string) {
  const result = await db(admin).rpc("initialize_accounting_defaults", {
    p_org_id: orgId,
    p_user_id: userId,
  });
  if (result.error) throw new Error(result.error.message);
}

export async function getAccountingSettings(admin: AdminClient, orgId: string) {
  const { data, error } = await db(admin)
    .from("accounting_settings")
    .select("*")
    .eq("organization_id", orgId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as Record<string, unknown> | null;
}

export async function createJournalEntry(admin: AdminClient, input: JournalInput) {
  const validation = validateJournalLines(input.lines);
  if (!validation.valid) throw new Error(validation.message);
  const context = commandContext(input);
  const { data, error } = await db(admin).rpc("accounting_save_journal", {
    p_org_id: input.orgId,
    p_actor_user_id: input.userId,
    p_command_id: context.commandId,
    p_request_id: context.requestId,
    p_entry_id: null,
    p_expected_version: 0,
    p_payload: {
      entryDate: input.entryDate,
      description: input.description,
      notes: input.notes || null,
      sourceModule: input.sourceModule || "manual",
      sourceId: input.sourceId || null,
      status: input.status || "draft",
      lines: input.lines,
    },
  });
  if (error) throw new Error(error.message);
  const entry = firstRpcRow(data, "Accounting journal creation");
  return journalWithLines(admin, input.orgId, String(entry.id));
}

export async function updateDraftJournalEntry(admin: AdminClient, input: JournalInput & { entryId: string }) {
  const validation = validateJournalLines(input.lines);
  if (!validation.valid) throw new Error(validation.message);
  const currentResult = await db(admin)
    .from("accounting_journal_entries")
    .select("id, version, status, source_module, source_id")
    .eq("organization_id", input.orgId)
    .eq("id", input.entryId)
    .maybeSingle();
  if (currentResult.error) throw new Error(currentResult.error.message);
  const current = currentResult.data as Record<string, unknown> | null;
  if (!current) throw new Error("القيد غير موجود.");
  const context = commandContext(input);
  const targetStatus = input.status || "draft";
  const { data, error } = await db(admin).rpc("accounting_save_journal", {
    p_org_id: input.orgId,
    p_actor_user_id: input.userId,
    p_command_id: context.commandId,
    p_request_id: context.requestId,
    p_entry_id: input.entryId,
    p_expected_version: input.expectedVersion ?? Number(current.version || 0),
    p_payload: {
      entryDate: input.entryDate,
      description: input.description,
      notes: input.notes || null,
      sourceModule: String(current.source_module || "manual"),
      sourceId: current.source_id || null,
      status: targetStatus,
      lines: input.lines,
    },
  });
  if (error) throw new Error(error.message);
  const entry = firstRpcRow(data, "Accounting journal update");
  return journalWithLines(admin, input.orgId, String(entry.id));
}

export async function postJournalEntry(
  admin: AdminClient,
  orgId: string,
  entryId: string,
  userId: string,
  options?: CommandOptions
) {
  const currentResult = await db(admin)
    .from("accounting_journal_entries")
    .select("id, entry_no, version")
    .eq("organization_id", orgId)
    .eq("id", entryId)
    .maybeSingle();
  if (currentResult.error) throw new Error(currentResult.error.message);
  const current = currentResult.data as Record<string, unknown> | null;
  if (!current) throw new Error("القيد غير موجود.");
  const context = commandContext(options);
  const { data, error } = await db(admin).rpc("accounting_post_journal", {
    p_org_id: orgId,
    p_entry_id: entryId,
    p_actor_user_id: userId,
    p_command_id: context.commandId,
    p_request_id: context.requestId,
    p_expected_version: options?.expectedVersion ?? Number(current.version || 0),
  });
  if (error) throw new Error(error.message);
  firstRpcRow(data, "Accounting journal posting");
  return journalWithLines(admin, orgId, entryId);
}

export async function reverseJournalEntry(
  admin: AdminClient,
  orgId: string,
  entryId: string,
  userId: string,
  reason?: string,
  options?: CommandOptions
) {
  const currentResult = await db(admin)
    .from("accounting_journal_entries")
    .select("id, entry_no, version")
    .eq("organization_id", orgId)
    .eq("id", entryId)
    .maybeSingle();
  if (currentResult.error) throw new Error(currentResult.error.message);
  const current = currentResult.data as Record<string, unknown> | null;
  if (!current) throw new Error("القيد غير موجود.");
  const context = commandContext(options);
  const { data, error } = await db(admin).rpc("accounting_reverse_journal", {
    p_org_id: orgId,
    p_entry_id: entryId,
    p_actor_user_id: userId,
    p_command_id: context.commandId,
    p_request_id: context.requestId,
    p_expected_version: options?.expectedVersion ?? Number(current.version || 0),
    p_reason: reason || null,
  });
  if (error) throw new Error(error.message);
  const reversal = firstRpcRow(data, "Accounting journal reversal");
  return journalWithLines(admin, orgId, String(reversal.id));
}
