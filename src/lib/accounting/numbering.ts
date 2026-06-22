import type { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;

const tableColumn: Record<string, string> = {
  accounting_journal_entries: "entry_no",
  accounting_invoices: "invoice_no",
  accounting_expenses: "expense_no",
  accounting_payments: "payment_no",
};

export async function generateAccountingNumber(
  admin: AdminClient,
  table: keyof typeof tableColumn,
  organizationId: string,
  prefix: string,
  date = new Date()
) {
  const column = tableColumn[table];
  const cleanPrefix = (prefix || "DOC").replace(/[^A-Za-z0-9-]/g, "").toUpperCase() || "DOC";
  const stamp = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}`;
  const base = `${cleanPrefix}-${stamp}`;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await (admin as any)
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .like(column, `${base}-%`);

  const next = (result.count || 0) + 1;
  return `${base}-${String(next).padStart(4, "0")}`;
}
