import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantContext } from "@/lib/server/tenant-context";

const schema = z.object({
  employee_id: z.string().uuid(),
  command_id: z.string().uuid(),
  leave_type: z.enum(["vacation", "sick", "emergency"]),
  amount: z.number().finite().refine((value) => value !== 0, "Amount cannot be zero."),
  reason: z.string().trim().min(3).max(1000),
});

export async function POST(request: NextRequest) {
  const auth = await requireTenantContext({ feature: "hr", capability: "manage_leave" }, request);
  if ("error" in auth) return auth.error;
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ message: parsed.error.issues[0]?.message || "Invalid balance adjustment." }, { status: 400 });
  const { data, error } = await auth.admin.rpc("adjust_employee_leave_balance", {
    p_org_id: auth.orgId,
    p_employee_id: parsed.data.employee_id,
    p_actor_user_id: auth.user.id,
    p_command_id: parsed.data.command_id,
    p_leave_type: parsed.data.leave_type,
    p_amount: parsed.data.amount,
    p_reason: parsed.data.reason,
  });
  if (error) {
    const status = error.code === "42501" ? 403
      : error.code === "P0002" ? 404
        : error.code === "23505" ? 409
          : error.code === "23514" || error.code === "22023" ? 400 : 500;
    return NextResponse.json({ message: error.message, requestId: auth.requestId }, { status });
  }
  return NextResponse.json({ balance: data?.[0] || null, requestId: auth.requestId });
}

