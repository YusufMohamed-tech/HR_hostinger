import type { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;

const documentType = {
  accounting_journal_entries: "journal",
  accounting_invoices: "invoice",
  accounting_expenses: "expense",
  accounting_payments: "payment",
};

export async function generateAccountingNumber(
  admin: AdminClient,
  table: keyof typeof documentType,
  organizationId: string,
  prefix: string,
  date = new Date()
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await (admin as any).rpc("next_accounting_document_number", {
    p_org_id: organizationId,
    p_document_type: documentType[table],
    p_prefix: prefix,
    p_document_date: date.toISOString().slice(0, 10),
  });
  if (result.error) throw new Error(result.error.message);
  if (typeof result.data !== "string" || !result.data) throw new Error("Accounting number allocation failed.");
  return result.data;
}
