import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantContext } from "@/lib/server/tenant-context";

type RouteContext = { params: Promise<{ id: string }> };

const schema = z.object({
  command_id: z.string().uuid(),
  expected_version: z.number().int().nonnegative(),
  payment_date: z.string().date().optional(),
  account_id: z.string().uuid().nullable().optional(),
  method: z.string().trim().max(100).optional(),
  reference_no: z.string().trim().max(200).optional(),
});

function commandErrorStatus(code?: string) {
  if (code === "42501") return 403;
  if (code === "P0002") return 404;
  if (["23505", "40001", "55000"].includes(code || "")) return 409;
  if (["22023", "23514"].includes(code || "")) return 400;
  return 500;
}

export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requireTenantContext(
    { roles: ["finance_manager"], features: ["hr", "accounting"] },
    request
  );
  if ("error" in auth) return auth.error;
  const { id } = await context.params;
  const parsedId = z.string().uuid().safeParse(id);
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsedId.success || !parsed.success) {
    return NextResponse.json(
      { message: parsed.success ? "Invalid advance request id." : parsed.error.issues[0]?.message, requestId: auth.requestId },
      { status: 400 }
    );
  }

  const { data, error } = await auth.admin.rpc("disburse_advance_request", {
    p_org_id: auth.orgId,
    p_advance_request_id: id,
    p_actor_user_id: auth.user.id,
    p_command_id: parsed.data.command_id,
    p_request_id: auth.requestId,
    p_expected_version: parsed.data.expected_version,
    p_payment_date: parsed.data.payment_date || null,
    p_account_id: parsed.data.account_id || null,
    p_method: parsed.data.method || null,
    p_reference_no: parsed.data.reference_no || null,
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
