import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantContext } from "@/lib/server/tenant-context";

type RouteContext = { params: Promise<{ id: string }> };
const schema = z.object({ command_id: z.string().uuid(), reason: z.string().trim().min(3).max(1000) });

export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requireTenantContext({ feature: "hr" }, request);
  if ("error" in auth) return auth.error;
  const { id } = await context.params;
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!z.string().uuid().safeParse(id).success || !parsed.success) {
    return NextResponse.json({ message: parsed.success ? "Invalid leave request id." : parsed.error.issues[0]?.message }, { status: 400 });
  }
  const { data, error } = await auth.admin.rpc("cancel_leave_request", {
    p_org_id: auth.orgId,
    p_leave_request_id: id,
    p_actor_user_id: auth.user.id,
    p_command_id: parsed.data.command_id,
    p_reason: parsed.data.reason,
  });
  if (error) {
    const status = error.code === "42501" ? 403
      : error.code === "P0002" ? 404
        : error.code === "23505" ? 409
          : error.code === "23514" || error.code === "22023" ? 400 : 500;
    return NextResponse.json({ message: error.message, requestId: auth.requestId }, { status });
  }
  return NextResponse.json({ request: data?.[0] || null, requestId: auth.requestId });
}

