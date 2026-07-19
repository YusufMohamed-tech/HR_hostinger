import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantContext } from "@/lib/server/tenant-context";
import type { OrgRole } from "@/types/database";

const reviewerRoles: OrgRole[] = ["admin", "hr_admin"];
const staffRoles = new Set<OrgRole>([
  ...reviewerRoles,
  "finance_manager",
  "accountant",
  "finance_viewer",
]);

const submitSchema = z.object({
  command_id: z.string().uuid(),
  requested_amount: z.number().positive().multipleOf(0.01),
  reason: z.string().trim().max(2000).optional(),
  employee_signature_data: z.string().startsWith("data:image/").max(1_500_000),
  installment_count: z.number().int().min(1).max(60),
  first_deduction_month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-01$/),
});

const reviewSchema = z.object({
  id: z.string().uuid(),
  command_id: z.string().uuid(),
  expected_version: z.number().int().nonnegative(),
  status: z.enum(["approved", "partial_approved", "rejected"]),
  approved_amount: z.number().positive().multipleOf(0.01).optional(),
  hr_notes: z.string().trim().max(2000).optional(),
}).superRefine((value, context) => {
  if (value.status !== "rejected" && value.approved_amount === undefined) {
    context.addIssue({ code: "custom", path: ["approved_amount"], message: "Approved amount is required." });
  }
});

function commandErrorStatus(code?: string) {
  if (code === "42501") return 403;
  if (code === "P0002") return 404;
  if (["23505", "40001", "55000"].includes(code || "")) return 409;
  if (["22023", "23514"].includes(code || "")) return 400;
  return 500;
}

export async function GET(request: NextRequest) {
  const auth = await requireTenantContext({ feature: "hr" }, request);
  if ("error" in auth) return auth.error;

  let query = auth.admin
    .from("advance_requests")
    .select("*, employee:employee_id(full_name, employee_code, user_id), installments:advance_installments(id, sequence_no, due_month, amount, status, payroll_run_id)")
    .eq("organization_id", auth.orgId)
    .order("created_at", { ascending: false });

  if (!staffRoles.has(auth.role)) {
    if (!auth.employeeId) return NextResponse.json({ data: [], requestId: auth.requestId });
    query = query.eq("employee_id", auth.employeeId);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ message: error.message, requestId: auth.requestId }, { status: 500 });
  return NextResponse.json({ data, requestId: auth.requestId });
}

export async function POST(request: NextRequest) {
  const auth = await requireTenantContext({ feature: "hr", requireEmployee: true }, request);
  if ("error" in auth) return auth.error;
  const parsed = submitSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues[0]?.message || "Invalid advance request.", requestId: auth.requestId },
      { status: 400 }
    );
  }

  const { data, error } = await auth.admin.rpc("submit_advance_request", {
    p_org_id: auth.orgId,
    p_employee_id: auth.employeeId,
    p_actor_user_id: auth.user.id,
    p_command_id: parsed.data.command_id,
    p_request_id: auth.requestId,
    p_requested_amount: parsed.data.requested_amount,
    p_reason: parsed.data.reason || null,
    p_signature_data: parsed.data.employee_signature_data,
    p_installment_count: parsed.data.installment_count,
    p_first_deduction_month: parsed.data.first_deduction_month,
  });
  if (error) {
    return NextResponse.json(
      { message: error.message, requestId: auth.requestId },
      { status: commandErrorStatus(error.code) }
    );
  }
  const rows = data as unknown as Record<string, unknown>[] | null;
  return NextResponse.json({ data: rows?.[0] || null, requestId: auth.requestId }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const auth = await requireTenantContext({ roles: reviewerRoles, feature: "hr" }, request);
  if ("error" in auth) return auth.error;
  const parsed = reviewSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues[0]?.message || "Invalid advance review.", requestId: auth.requestId },
      { status: 400 }
    );
  }

  const { data, error } = await auth.admin.rpc("review_advance_request", {
    p_org_id: auth.orgId,
    p_advance_request_id: parsed.data.id,
    p_actor_user_id: auth.user.id,
    p_command_id: parsed.data.command_id,
    p_request_id: auth.requestId,
    p_expected_version: parsed.data.expected_version,
    p_decision: parsed.data.status,
    p_approved_amount: parsed.data.status === "rejected" ? null : parsed.data.approved_amount,
    p_hr_notes: parsed.data.hr_notes || null,
  });
  if (error) {
    return NextResponse.json(
      { message: error.message, requestId: auth.requestId },
      { status: commandErrorStatus(error.code) }
    );
  }
  const rows = data as unknown as Record<string, unknown>[] | null;
  return NextResponse.json({ data: rows?.[0] || null, requestId: auth.requestId });
}
