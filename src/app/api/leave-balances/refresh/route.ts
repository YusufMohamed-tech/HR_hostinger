import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantContext } from "@/lib/server/tenant-context";

const schema = z.object({ employee_id: z.string().uuid(), command_id: z.string().uuid() });

export async function POST(request: NextRequest) {
  const auth = await requireTenantContext({ feature: "hr", capability: "manage_leave" }, request);
  if ("error" in auth) return auth.error;
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ message: "Valid employee and command ids are required." }, { status: 400 });
  const { data, error } = await auth.admin.rpc("refresh_employee_leave_balance", {
    p_org_id: auth.orgId,
    p_employee_id: parsed.data.employee_id,
    p_actor_user_id: auth.user.id,
    p_command_id: parsed.data.command_id,
  });
  if (error) {
    const status = error.code === "42501" ? 403 : error.code === "P0002" ? 404 : error.code === "23505" ? 409 : 500;
    return NextResponse.json({ message: error.message, requestId: auth.requestId }, { status });
  }
  return NextResponse.json({ balance: data?.[0] || null, requestId: auth.requestId });
}

