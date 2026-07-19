import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantContext } from "@/lib/server/tenant-context";

const adminRoles = ["admin", "hr_admin"];
const policyValues = z.object({
  command_id: z.string().uuid(), expected_version: z.coerce.number().int().positive(),
  name: z.string().trim().min(2).max(160), late_grace_minutes: z.coerce.number().int().nonnegative(),
  deduction_per_late_hour: z.coerce.number().nonnegative(), allowed_absent_days: z.coerce.number().int().nonnegative(),
  deduction_per_absent_day: z.coerce.number().nonnegative(), deduction_per_excess_approved_day: z.coerce.number().nonnegative(),
});
const deleteValues = z.object({ command_id: z.string().uuid(), expected_version: z.coerce.number().int().positive() });
function statusFor(code?: string) {
  if (code === "P0002") return 404;
  if (["23503", "23505", "40001"].includes(code || "")) return 409;
  if (["22023", "23514"].includes(code || "")) return 400;
  if (code === "42501") return 403;
  return 500;
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireTenantContext({ roles: adminRoles, feature: "hr" });
  if ("error" in auth) return auth.error;

  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ message: "Invalid policy id." }, { status: 400 });
  const parsed = policyValues.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ message: parsed.error.issues[0]?.message || "Invalid policy." }, { status: 400 });
  const { command_id, expected_version, ...payload } = parsed.data;
  const { data, error } = await auth.admin.rpc("execute_deduction_policy_command", {
    p_org_id: auth.orgId, p_actor_user_id: auth.user.id, p_request_id: auth.requestId,
    p_command_id: command_id, p_action: "save", p_target_id: id,
    p_expected_version: expected_version, p_payload: payload,
  });

  if (error) {
    if (error.code === "23505")
      return NextResponse.json({ message: "A group with this name already exists." }, { status: 409 });
    return NextResponse.json({ message: error.message }, { status: statusFor(error.code) });
  }
  return NextResponse.json({ data: (data as Record<string, unknown>)?.policy || null });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireTenantContext({ roles: ["admin"], feature: "hr" });
  if ("error" in auth) return auth.error;

  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ message: "Invalid policy id." }, { status: 400 });
  const parsed = deleteValues.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ message: parsed.error.issues[0]?.message || "Invalid delete command." }, { status: 400 });
  const { error } = await auth.admin.rpc("execute_deduction_policy_command", {
    p_org_id: auth.orgId, p_actor_user_id: auth.user.id, p_request_id: auth.requestId,
    p_command_id: parsed.data.command_id, p_action: "delete", p_target_id: id,
    p_expected_version: parsed.data.expected_version, p_payload: {},
  });
  if (error) return NextResponse.json({ message: error.message }, { status: statusFor(error.code) });
  return NextResponse.json({ success: true });
}
