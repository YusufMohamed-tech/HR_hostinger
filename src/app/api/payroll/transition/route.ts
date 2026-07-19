import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantContext } from "@/lib/server/tenant-context";

const schema = z.object({
  payroll_run_id: z.string().uuid(),
  command_id: z.string().uuid(),
  expected_version: z.number().int().nonnegative(),
  target_status: z.enum(["approved", "void"]),
  reason: z.string().trim().min(3).max(1000).optional(),
}).superRefine((value, context) => {
  if (value.target_status === "void" && !value.reason) {
    context.addIssue({ code: "custom", path: ["reason"], message: "A void reason is required." });
  }
});

export async function POST(request: NextRequest) {
  const auth = await requireTenantContext({ feature: "payroll", capability: "manage_payroll" }, request);
  if ("error" in auth) return auth.error;
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ message: parsed.error.issues[0]?.message || "Invalid payroll transition.", requestId: auth.requestId }, { status: 400 });
  const { data, error } = await auth.admin.rpc("transition_payroll_run", {
    p_org_id: auth.orgId,
    p_payroll_run_id: parsed.data.payroll_run_id,
    p_actor_user_id: auth.user.id,
    p_command_id: parsed.data.command_id,
    p_request_id: auth.requestId,
    p_expected_version: parsed.data.expected_version,
    p_target_status: parsed.data.target_status,
    p_reason: parsed.data.reason || null,
  });
  if (error) {
    const status = error.code === "42501" ? 403 : error.code === "P0002" ? 404
      : ["23505", "40001", "55000"].includes(error.code || "") ? 409
        : ["22023", "23514"].includes(error.code || "") ? 400 : 500;
    return NextResponse.json({ message: error.message, requestId: auth.requestId }, { status });
  }
  return NextResponse.json({ run: data?.[0] || null, requestId: auth.requestId });
}
