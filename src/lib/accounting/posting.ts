import { createAdminClient } from "@/lib/supabase/admin";
import { writeAuditLog } from "@/lib/utils/audit";
import { generateAccountingNumber } from "@/lib/accounting/numbering";
import { roundMoney, validateJournalLines, type JournalLineInput } from "@/lib/accounting/validation";

type AdminClient = ReturnType<typeof createAdminClient>;

type JournalInput = {
  orgId: string;
  userId: string;
  entryDate: string;
  description: string;
  lines: JournalLineInput[];
  sourceModule?: string;
  sourceId?: string | null;
  reversalOf?: string | null;
  notes?: string | null;
  status?: "draft" | "pending_approval" | "posted";
  entryNo?: string;
};

function db(admin: AdminClient) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return admin as any;
}

export async function initializeAccountingDefaults(admin: AdminClient, orgId: string, userId: string) {
  const result = await db(admin).rpc("initialize_accounting_defaults", {
    p_org_id: orgId,
    p_user_id: userId,
  });
  if (result.error) throw new Error(result.error.message);
  await writeAuditLog(admin, {
    org_id: orgId,
    actor_user_id: userId,
    action: "accounting.defaults_initialized",
    entity: "accounting_settings",
    new_values: { initialized: true },
  });
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

async function assertOpenPeriod(admin: AdminClient, orgId: string, entryDate: string) {
  const { data, error } = await db(admin)
    .from("accounting_periods")
    .select("id, name, status")
    .eq("organization_id", orgId)
    .lte("start_date", entryDate)
    .gte("end_date", entryDate)
    .in("status", ["closed", "locked"])
    .limit(1);

  if (error) throw new Error(error.message);
  if (Array.isArray(data) && data.length > 0) {
    throw new Error("لا يمكن الترحيل في فترة محاسبية مغلقة أو مقفلة.");
  }
}

async function assertActiveAccounts(admin: AdminClient, orgId: string, lines: JournalLineInput[]) {
  const accountIds = Array.from(new Set(lines.map((line) => String(line.account_id || "")).filter(Boolean)));
  const { data, error } = await db(admin)
    .from("accounting_accounts")
    .select("id, is_active, organization_id")
    .eq("organization_id", orgId)
    .in("id", accountIds);

  if (error) throw new Error(error.message);
  const accounts = new Map(((data || []) as Record<string, unknown>[]).map((account) => [String(account.id), account]));
  for (const accountId of accountIds) {
    const account = accounts.get(accountId);
    if (!account) throw new Error("يوجد حساب غير تابع للمنظمة الحالية.");
    if (account.is_active === false) throw new Error("لا يمكن استخدام حساب غير نشط في القيد.");
  }
}

async function notifyFinance(admin: AdminClient, orgId: string, title: string, body: string, link: string) {
  const { data } = await db(admin)
    .from("org_members")
    .select("user_id, role")
    .eq("org_id", orgId)
    .in("role", ["admin", "finance_manager", "accountant"]);

  const rows = ((data || []) as Record<string, unknown>[]).map((member) => ({
    org_id: orgId,
    user_id: String(member.user_id),
    title,
    body,
    type: "accounting",
    link,
    is_read: false,
  }));

  if (rows.length > 0) {
    await db(admin).from("notifications").insert(rows);
  }
}

export async function createJournalEntry(admin: AdminClient, input: JournalInput) {
  const status = input.status || "draft";
  const initialStatus = status === "posted" ? "draft" : status;
  const validation = validateJournalLines(input.lines);
  if (!validation.valid) throw new Error(validation.message);
  await assertOpenPeriod(admin, input.orgId, input.entryDate);
  await assertActiveAccounts(admin, input.orgId, input.lines);

  if (input.sourceModule && input.sourceId) {
    const existing = await db(admin)
      .from("accounting_source_postings")
      .select("journal_entry_id")
      .eq("organization_id", input.orgId)
      .eq("source_module", input.sourceModule)
      .eq("source_id", input.sourceId)
      .maybeSingle();
    if (existing.error) throw new Error(existing.error.message);
    if (existing.data?.journal_entry_id) {
      throw new Error("تم إنشاء قيد محاسبي لهذا المصدر مسبقا.");
    }
  }

  const settings = await getAccountingSettings(admin, input.orgId);
  const entryNo = input.entryNo || await generateAccountingNumber(
    admin,
    "accounting_journal_entries",
    input.orgId,
    String(settings?.journal_prefix || "JE"),
    new Date(input.entryDate)
  );

  const totals = {
    debit: roundMoney(validation.totalDebit),
    credit: roundMoney(validation.totalCredit),
  };

  const { data: entry, error } = await db(admin)
    .from("accounting_journal_entries")
    .insert({
      organization_id: input.orgId,
      entry_no: entryNo,
      entry_date: input.entryDate,
      description: input.description,
      source_module: input.sourceModule || "manual",
      source_id: input.sourceId || null,
      status: initialStatus,
      currency: "SAR",
      total_debit: totals.debit,
      total_credit: totals.credit,
      created_by: input.userId,
      approved_by: null,
      posted_by: null,
      approved_at: null,
      posted_at: null,
      reversal_of: input.reversalOf || null,
      notes: input.notes || null,
    })
    .select("*")
    .single();

  if (error) throw new Error(error.message);

  const entryId = String(entry.id);
  const lineRows = input.lines.map((line) => ({
    organization_id: input.orgId,
    journal_entry_id: entryId,
    account_id: line.account_id,
    debit: roundMoney(line.debit),
    credit: roundMoney(line.credit),
    description: line.description || null,
    cost_center_id: line.cost_center_id || null,
    employee_id: line.employee_id || null,
    department_id: line.department_id || null,
    location_id: line.location_id || null,
  }));

  const lineResult = await db(admin).from("accounting_journal_lines").insert(lineRows).select("*");
  if (lineResult.error) throw new Error(lineResult.error.message);

  let finalEntry = entry as Record<string, unknown>;
  if (status === "posted") {
    const now = new Date().toISOString();
    const updateResult = await db(admin)
      .from("accounting_journal_entries")
      .update({
        status: "posted",
        approved_by: input.userId,
        posted_by: input.userId,
        approved_at: now,
        posted_at: now,
      })
      .eq("organization_id", input.orgId)
      .eq("id", entryId)
      .select("*")
      .single();
    if (updateResult.error) throw new Error(updateResult.error.message);
    finalEntry = updateResult.data as Record<string, unknown>;
  }

  if (input.sourceModule && input.sourceId) {
    await db(admin).from("accounting_source_postings").insert({
      organization_id: input.orgId,
      source_module: input.sourceModule,
      source_id: input.sourceId,
      journal_entry_id: entryId,
      status,
    });
  }

  await writeAuditLog(admin, {
    org_id: input.orgId,
    actor_user_id: input.userId,
    action: status === "posted" ? "accounting.journal_posted" : "accounting.journal_created",
    entity: "accounting_journal_entries",
    entity_id: entryId,
    new_values: { entry_no: entryNo, status, total_debit: totals.debit, total_credit: totals.credit },
  });

  if (status === "pending_approval") {
    await notifyFinance(admin, input.orgId, "قيد محاسبي بانتظار الاعتماد", input.description, `/accounting/journal-entries/${entryId}`);
  }

  return { ...finalEntry, lines: lineResult.data || [] } as Record<string, unknown>;
}

export async function postJournalEntry(admin: AdminClient, orgId: string, entryId: string, userId: string) {
  const { data: entry, error } = await db(admin)
    .from("accounting_journal_entries")
    .select("*, lines:accounting_journal_lines(*)")
    .eq("organization_id", orgId)
    .eq("id", entryId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!entry) throw new Error("القيد غير موجود.");
  if (!["draft", "pending_approval"].includes(String(entry.status))) {
    throw new Error("يمكن ترحيل القيود المسودة أو بانتظار الاعتماد فقط.");
  }

  const lines = Array.isArray(entry.lines) ? entry.lines as JournalLineInput[] : [];
  const validation = validateJournalLines(lines);
  if (!validation.valid) throw new Error(validation.message);
  await assertOpenPeriod(admin, orgId, String(entry.entry_date));
  await assertActiveAccounts(admin, orgId, lines);

  if (entry.source_module && entry.source_id) {
    const existing = await db(admin)
      .from("accounting_source_postings")
      .select("journal_entry_id")
      .eq("organization_id", orgId)
      .eq("source_module", String(entry.source_module))
      .eq("source_id", String(entry.source_id))
      .maybeSingle();
    if (existing.error) throw new Error(existing.error.message);
    if (existing.data?.journal_entry_id && String(existing.data.journal_entry_id) !== entryId) {
      throw new Error("تم ترحيل هذا المصدر مسبقا.");
    }
  }

  const now = new Date().toISOString();
  const updateResult = await db(admin)
    .from("accounting_journal_entries")
    .update({
      status: "posted",
      total_debit: roundMoney(validation.totalDebit),
      total_credit: roundMoney(validation.totalCredit),
      approved_by: userId,
      posted_by: userId,
      approved_at: now,
      posted_at: now,
    })
    .eq("organization_id", orgId)
    .eq("id", entryId)
    .select("*")
    .single();

  if (updateResult.error) throw new Error(updateResult.error.message);

  if (entry.source_module && entry.source_id) {
    await db(admin).from("accounting_source_postings").upsert({
      organization_id: orgId,
      source_module: String(entry.source_module),
      source_id: String(entry.source_id),
      journal_entry_id: entryId,
      status: "posted",
    }, { onConflict: "organization_id,source_module,source_id" });
  }

  await writeAuditLog(admin, {
    org_id: orgId,
    actor_user_id: userId,
    action: "accounting.journal_posted",
    entity: "accounting_journal_entries",
    entity_id: entryId,
    old_values: { status: entry.status },
    new_values: { status: "posted", entry_no: entry.entry_no },
  });
  await notifyFinance(admin, orgId, "تم ترحيل قيد محاسبي", `تم ترحيل القيد ${entry.entry_no}.`, `/accounting/journal-entries/${entryId}`);

  return updateResult.data as Record<string, unknown>;
}

export async function reverseJournalEntry(admin: AdminClient, orgId: string, entryId: string, userId: string, reason?: string) {
  const { data: entry, error } = await db(admin)
    .from("accounting_journal_entries")
    .select("*, lines:accounting_journal_lines(*)")
    .eq("organization_id", orgId)
    .eq("id", entryId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!entry) throw new Error("القيد غير موجود.");
  if (entry.status !== "posted") throw new Error("يمكن عكس القيود المرحلة فقط.");

  const existingReversal = await db(admin)
    .from("accounting_journal_entries")
    .select("id")
    .eq("organization_id", orgId)
    .eq("reversal_of", entryId)
    .in("status", ["posted", "reversed"])
    .limit(1)
    .maybeSingle();
  if (existingReversal.error) throw new Error(existingReversal.error.message);
  if (existingReversal.data?.id) throw new Error("تم عكس هذا القيد مسبقا.");

  const lines = (Array.isArray(entry.lines) ? entry.lines : []) as Record<string, unknown>[];
  const reversal = await createJournalEntry(admin, {
    orgId,
    userId,
    entryDate: new Date().toISOString().slice(0, 10),
    description: `عكس القيد ${entry.entry_no}: ${reason || entry.description}`,
    sourceModule: "reversal",
    sourceId: null,
    reversalOf: entryId,
    status: "posted",
    notes: reason || null,
    lines: lines.map((line) => ({
      account_id: String(line.account_id),
      debit: Number(line.credit || 0),
      credit: Number(line.debit || 0),
      description: String(line.description || `عكس ${entry.entry_no}`),
      cost_center_id: line.cost_center_id ? String(line.cost_center_id) : null,
      employee_id: line.employee_id ? String(line.employee_id) : null,
      department_id: line.department_id ? String(line.department_id) : null,
      location_id: line.location_id ? String(line.location_id) : null,
    })),
  });

  const updateResult = await db(admin)
    .from("accounting_journal_entries")
    .update({
      status: "reversed",
      reversed_by: userId,
      reversed_at: new Date().toISOString(),
    })
    .eq("organization_id", orgId)
    .eq("id", entryId)
    .select("id")
    .single();
  if (updateResult.error) throw new Error(updateResult.error.message);

  await writeAuditLog(admin, {
    org_id: orgId,
    actor_user_id: userId,
    action: "accounting.journal_reversed",
    entity: "accounting_journal_entries",
    entity_id: entryId,
    new_values: { reversal_entry_id: reversal.id, reason: reason || null },
  });
  await notifyFinance(admin, orgId, "تم عكس قيد محاسبي", `تم عكس القيد ${entry.entry_no}.`, `/accounting/journal-entries/${entryId}`);

  return reversal;
}
