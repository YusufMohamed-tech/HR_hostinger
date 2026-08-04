import { NextRequest, NextResponse } from "next/server";
import { requireTenantContext } from "@/lib/server/tenant-context";

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireTenantContext({ feature: "personnel", capability: "manage_people" }, request);
  if ("error" in auth) return auth.error;

  const { id } = await params;

  const { data: entry, error: fetchError } = await auth.admin
    .from("employee_manual_entries")
    .select("id, status, accounting_journal_entry_id")
    .eq("id", id)
    .eq("org_id", auth.orgId)
    .single();

  if (fetchError || !entry) {
    return NextResponse.json({ message: "Entry not found.", requestId: auth.requestId }, { status: 404 });
  }

  if (entry.status !== "pending") {
    return NextResponse.json({ message: "Only pending entries can be cancelled.", requestId: auth.requestId }, { status: 400 });
  }

  const { error: updateError } = await auth.admin
    .from("employee_manual_entries")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("org_id", auth.orgId);

  if (updateError) {
    return NextResponse.json({ message: updateError.message, requestId: auth.requestId }, { status: 500 });
  }

  // Reverse accounting entry if one was posted
  if (entry.accounting_journal_entry_id) {
    try {
      const { autoReverseManualEntry } = await import("@/lib/accounting/auto-posting");
      const commandId = crypto.randomUUID();
      await autoReverseManualEntry(auth.admin, auth.orgId, auth.user.id, id, "Manual entry cancelled by HR.", { commandId, requestId: auth.requestId });
      await auth.admin
        .from("employee_manual_entries")
        .update({ accounting_status: "reversed" })
        .eq("id", id);
    } catch {
      await auth.admin
        .from("employee_manual_entries")
        .update({ accounting_status: "failed" })
        .eq("id", id);
    }
  }

  return NextResponse.json({ success: true, requestId: auth.requestId });
}
