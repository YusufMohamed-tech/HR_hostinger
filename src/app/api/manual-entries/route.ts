import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantContext } from "@/lib/server/tenant-context";

const createSchema = z.object({
  employee_id: z.string().uuid(),
  entry_type: z.enum(["deduction", "absence"]),
  amount: z.number().finite().positive().optional(),
  days: z.number().int().positive().optional(),
  reason: z.string().trim().min(3).max(1000),
  entry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-01$/).optional(),
}).refine(
  (data) => data.entry_type === "deduction" ? (data.amount != null && data.amount > 0) : (data.days != null && data.days > 0),
  { message: "Deductions require amount; absences require days." }
);

export async function POST(request: NextRequest) {
  const auth = await requireTenantContext({ feature: "personnel", capability: "manage_people" }, request);
  if ("error" in auth) return auth.error;

  const body = await request.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ message: parsed.error.issues[0]?.message || "Invalid input.", requestId: auth.requestId }, { status: 400 });
  }

  const { employee_id, entry_type, amount, days, reason, entry_date, month } = parsed.data;
  const targetMonth = month || `${entry_date.slice(0, 7)}-01`;

  const { data, error } = await auth.admin
    .from("employee_manual_entries")
    .insert({
      org_id: auth.orgId,
      employee_id,
      entry_type,
      amount: entry_type === "deduction" ? amount : (days! * (await getDailyRate(auth.admin, auth.orgId, employee_id))),
      days: entry_type === "absence" ? days : null,
      reason,
      entry_date,
      month: targetMonth,
      status: "pending",
      accounting_status: "pending",
      created_by: auth.user.id,
    })
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ message: error.message, requestId: auth.requestId }, { status: 500 });
  }

  const entryRecord = data as Record<string, unknown>;
  const entryId = String(entryRecord.id);

  // Auto-post to accounting if enabled
  try {
    const { autoPostManualEntry } = await import("@/lib/accounting/auto-posting");
    const employeeResult = await auth.admin
      .from("employees")
      .select("full_name")
      .eq("id", employee_id)
      .eq("org_id", auth.orgId)
      .single();
    const employeeName = String((employeeResult.data as Record<string, unknown> | null)?.full_name || "موظف");

    const postResult = await autoPostManualEntry(auth.admin, auth.orgId, auth.user.id, {
      id: entryId,
      employee_id,
      employee_name: employeeName,
      entry_type,
      amount: Number(entryRecord.amount || 0),
      reason,
      entry_date,
    });

    if (postResult.journalEntryId) {
      await auth.admin
        .from("employee_manual_entries")
        .update({ accounting_journal_entry_id: postResult.journalEntryId, accounting_status: "posted" })
        .eq("id", entryId);
    } else if (!postResult.success) {
      await auth.admin
        .from("employee_manual_entries")
        .update({ accounting_status: "failed" })
        .eq("id", entryId);
    } else {
      await auth.admin
        .from("employee_manual_entries")
        .update({ accounting_status: "skipped" })
        .eq("id", entryId);
    }
  } catch {
    await auth.admin
      .from("employee_manual_entries")
      .update({ accounting_status: "failed" })
      .eq("id", entryId);
  }

  return NextResponse.json({ entry: data, requestId: auth.requestId }, { status: 201 });
}

export async function GET(request: NextRequest) {
  const auth = await requireTenantContext({ feature: "personnel", capability: "manage_people" }, request);
  if ("error" in auth) return auth.error;

  const url = new URL(request.url);
  const employeeId = url.searchParams.get("employee_id");
  const month = url.searchParams.get("month");
  const status = url.searchParams.get("status");

  let query = auth.admin
    .from("employee_manual_entries")
    .select("*, employees!inner(full_name, employee_code)")
    .eq("org_id", auth.orgId)
    .order("created_at", { ascending: false });

  if (employeeId) query = query.eq("employee_id", employeeId);
  if (month) query = query.eq("month", month);
  if (status) query = query.eq("status", status);

  const { data, error } = await query.limit(200);
  if (error) {
    return NextResponse.json({ message: error.message, requestId: auth.requestId }, { status: 500 });
  }

  return NextResponse.json({ entries: data, requestId: auth.requestId });
}

async function getDailyRate(admin: ReturnType<typeof import("@/lib/supabase/admin").createAdminClient>, orgId: string, employeeId: string): Promise<number> {
  const { data } = await admin
    .from("employees")
    .select("base_salary")
    .eq("id", employeeId)
    .eq("org_id", orgId)
    .single();
  const salary = Number(data?.base_salary || 0);
  return Math.round((salary / 30) * 100) / 100;
}
