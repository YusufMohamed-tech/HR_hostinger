import { NextRequest, NextResponse } from "next/server";
import { requireTenantContext } from "@/lib/server/tenant-context";
import { formatCurrency } from "@/lib/utils/currency";

const reviewStatuses = new Set(["approved", "partial_approved", "rejected"]);
const reviewerRoles = ["admin", "hr_admin"];

export async function GET() {
  const auth = await requireTenantContext({ feature: "hr" });
  if ("error" in auth) return auth.error;

  let query = auth.admin
    .from("advance_requests")
    .select("*, employee:employee_id(full_name, employee_code, user_id)")
    .eq("organization_id", auth.orgId)
    .order("created_at", { ascending: false });

  if (!reviewerRoles.includes(auth.role)) {
    if (!auth.employeeId) return NextResponse.json({ data: [] });
    query = query.eq("employee_id", auth.employeeId);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ message: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

export async function POST(request: NextRequest) {
  const auth = await requireTenantContext({ feature: "hr", requireEmployee: true });
  if ("error" in auth) return auth.error;

  const body = await request.json().catch(() => ({}));
  const requestedAmount = Number((body as Record<string, unknown>).requested_amount || 0);
  const reason = String((body as Record<string, unknown>).reason || "").trim();
  const signature = String((body as Record<string, unknown>).employee_signature_data || "").trim();

  if (requestedAmount <= 0) {
    return NextResponse.json({ message: "Advance amount is required." }, { status: 400 });
  }

  if (!signature.startsWith("data:image/")) {
    return NextResponse.json({ message: "Employee signature is required before submitting the request." }, { status: 400 });
  }

  const { data: employee, error: employeeError } = await auth.admin
    .from("employees")
    .select("id, full_name")
    .eq("org_id", auth.orgId)
    .eq("id", auth.employeeId)
    .maybeSingle();

  if (employeeError) return NextResponse.json({ message: employeeError.message }, { status: 500 });
  const employeeRecord = employee as Record<string, unknown> | null;
  if (!employeeRecord) return NextResponse.json({ message: "Employee profile is required." }, { status: 403 });

  const { data, error } = await auth.admin
    .from("advance_requests")
    .insert({
      organization_id: auth.orgId,
      employee_id: auth.employeeId,
      requested_amount: requestedAmount,
      reason: reason || null,
      employee_signature_data: signature,
      employee_signed_at: new Date().toISOString(),
      status: "pending",
    } as never)
    .select("*, employee:employee_id(full_name, employee_code, user_id)")
    .single();

  if (error) return NextResponse.json({ message: error.message }, { status: 500 });

  const { data: hrMembers } = await auth.admin
    .from("org_members")
    .select("user_id")
    .eq("org_id", auth.orgId)
    .in("role", reviewerRoles);

  const employeeName = String(employeeRecord.full_name || "Employee");
  const rows = ((hrMembers ?? []) as Record<string, unknown>[]).map((member) => ({
    org_id: auth.orgId,
    user_id: String(member.user_id),
    title: "New advance request",
    body: `${employeeName} submitted an advance request for ${formatCurrency(requestedAmount)}.`,
    type: "system",
    link: "/balances",
    is_read: false,
  }));

  if (rows.length > 0) await auth.admin.from("notifications").insert(rows as never);

  return NextResponse.json({ data });
}

export async function PATCH(request: NextRequest) {
  const auth = await requireTenantContext({ roles: reviewerRoles, feature: "hr" });
  if ("error" in auth) return auth.error;

  const body = await request.json().catch(() => ({}));
  const id = String((body as Record<string, unknown>).id || "").trim();
  const status = String((body as Record<string, unknown>).status || "").trim();
  const approvedAmount = Number((body as Record<string, unknown>).approved_amount || 0);
  const hrNotes = String((body as Record<string, unknown>).hr_notes || "").trim();

  if (!id) return NextResponse.json({ message: "Request id is required." }, { status: 400 });
  if (!reviewStatuses.has(status)) return NextResponse.json({ message: "Unsupported review status." }, { status: 400 });
  if (status !== "rejected" && approvedAmount <= 0) {
    return NextResponse.json({ message: "Approved amount is required." }, { status: 400 });
  }

  const { data: requestRow, error: requestError } = await auth.admin
    .from("advance_requests")
    .select("*, employee:employee_id(full_name, user_id)")
    .eq("organization_id", auth.orgId)
    .eq("id", id)
    .maybeSingle();

  if (requestError) return NextResponse.json({ message: requestError.message }, { status: 500 });
  if (!requestRow) return NextResponse.json({ message: "Advance request was not found." }, { status: 404 });

  const row = requestRow as Record<string, unknown>;
  const employee = (row.employee ?? null) as Record<string, unknown> | null;
  const requestedAmount = Number(row.requested_amount || 0);
  if (status === "partial_approved" && approvedAmount >= requestedAmount) {
    return NextResponse.json({ message: "Partial approval amount must be lower than requested amount." }, { status: 400 });
  }

  const finalAmount = status === "rejected" ? null : approvedAmount;
  const { data, error } = await auth.admin
    .from("advance_requests")
    .update({
      status,
      approved_amount: finalAmount,
      hr_notes: hrNotes || null,
      reviewed_by: auth.user.id,
      reviewed_at: new Date().toISOString(),
    } as never)
    .eq("organization_id", auth.orgId)
    .eq("id", id)
    .select("*, employee:employee_id(full_name, employee_code, user_id)")
    .single();

  if (error) return NextResponse.json({ message: error.message }, { status: 500 });

  if (status !== "rejected" && finalAmount) {
    await auth.admin.from("financial_balances").insert({
      org_id: auth.orgId,
      employee_id: String(row.employee_id),
      balance_type: "advance_payment",
      amount: finalAmount,
      status: "unpaid",
      description: `Approved advance request ${id}`,
    } as never);

    // Phase 3: Auto-post advance disbursement to GL (non-blocking)
    try {
      const { autoPostAdvanceDisbursement } = await import("@/lib/accounting/auto-posting");
      const employeeName = String(employee?.full_name || "موظف");
      await autoPostAdvanceDisbursement(auth.admin, auth.orgId, auth.user.id, {
        id,
        employee_id: String(row.employee_id),
        employee_name: employeeName,
        approved_amount: finalAmount,
      });
    } catch {
      // Auto-posting failure must not block advance approval
    }
  }

  const employeeUserId = String(employee?.user_id || "");
  if (employeeUserId) {
    const decisionLabel = status === "rejected"
      ? "Advance request rejected"
      : status === "partial_approved"
        ? "Advance request partially approved"
        : "Advance request approved";

    await auth.admin.from("notifications").insert({
      org_id: auth.orgId,
      user_id: employeeUserId,
      title: decisionLabel,
      body: status === "rejected"
        ? (hrNotes || "Your request has been reviewed.")
        : `Approved amount: ${formatCurrency(Number(finalAmount || 0))}`,
      type: "system",
      link: "/balances",
      is_read: false,
    } as never);
  }

  return NextResponse.json({ data });
}
