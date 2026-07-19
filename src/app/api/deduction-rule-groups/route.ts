import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantContext } from "@/lib/server/tenant-context";

const adminRoles = ["admin", "hr_admin"];
const policySchema = z.object({
  command_id: z.string().uuid(),
  target_id: z.string().uuid(),
  name: z.string().trim().min(2).max(160),
  late_grace_minutes: z.coerce.number().int().nonnegative(),
  deduction_per_late_hour: z.coerce.number().nonnegative(),
  allowed_absent_days: z.coerce.number().int().nonnegative(),
  deduction_per_absent_day: z.coerce.number().nonnegative(),
  deduction_per_excess_approved_day: z.coerce.number().nonnegative(),
});

export async function GET() {
  const auth = await requireTenantContext({ feature: "hr" });
  if ("error" in auth) return auth.error;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (auth.admin as any)
    .from("deduction_rule_groups")
    .select("*")
    .eq("org_id", auth.orgId)
    .order("name");

  if (error) return NextResponse.json({ message: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

export async function POST(request: NextRequest) {
  const auth = await requireTenantContext({ roles: adminRoles, feature: "hr" });
  if ("error" in auth) return auth.error;

  const parsed = policySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ message: parsed.error.issues[0]?.message || "Invalid policy." }, { status: 400 });
  const { command_id, target_id, ...payload } = parsed.data;
  const { data, error } = await auth.admin.rpc("execute_deduction_policy_command", {
    p_org_id: auth.orgId, p_actor_user_id: auth.user.id, p_request_id: auth.requestId,
    p_command_id: command_id, p_action: "save", p_target_id: target_id,
    p_expected_version: null, p_payload: payload,
  });

  if (error) {
    if (error.code === "23505")
      return NextResponse.json({ message: "A group with this name already exists." }, { status: 409 });
    return NextResponse.json({ message: error.message }, { status: ["40001", "23505"].includes(error.code || "") ? 409 : 500 });
  }

  return NextResponse.json({ data: (data as Record<string, unknown>)?.policy || null }, { status: 201 });
}
