import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantContext } from "@/lib/server/tenant-context";

type RpcClient = {
  rpc: (name: string, args: Record<string, unknown>) => Promise<{
    data: unknown;
    error: { message: string; code?: string } | null;
  }>;
};

const schema = z.object({
  action: z.enum(["save_department", "delete_department", "set_department_members", "save_location", "delete_location", "promote_employee"]),
  command_id: z.string().uuid(),
  target_id: z.string().uuid(),
  expected_version: z.number().int().positive().nullable().optional(),
  payload: z.record(z.string(), z.unknown()).optional().default({}),
});

function statusFor(code?: string) {
  if (code === "P0002") return 404;
  if (["40001", "23505"].includes(code || "")) return 409;
  if (code === "42501") return 403;
  if (["22023", "23514", "22P02", "22007"].includes(code || "")) return 422;
  return 500;
}

export async function POST(request: NextRequest) {
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ message: parsed.error.issues[0]?.message || "Structure command is invalid." }, { status: 400 });
  }
  const locationCommand = parsed.data.action === "save_location" || parsed.data.action === "delete_location";
  const auth = await requireTenantContext({ feature: "hr", capability: locationCommand ? "manage_locations" : "manage_people" }, request);
  if ("error" in auth) return auth.error;
  const result = await (auth.admin as unknown as RpcClient).rpc("execute_hr_structure_command", {
    p_org_id: auth.orgId,
    p_actor_user_id: auth.user.id,
    p_request_id: auth.requestId,
    p_command_id: parsed.data.command_id,
    p_command_type: parsed.data.action,
    p_target_id: parsed.data.target_id,
    p_expected_version: parsed.data.expected_version ?? null,
    p_payload: parsed.data.payload,
  });
  if (result.error) {
    return NextResponse.json({ message: result.error.message, requestId: auth.requestId }, { status: statusFor(result.error.code) });
  }
  return NextResponse.json({ data: result.data, requestId: auth.requestId }, {
    status: parsed.data.expected_version == null ? 201 : 200,
  });
}
