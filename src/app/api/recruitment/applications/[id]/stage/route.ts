import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantContext } from "@/lib/server/tenant-context";

const requestSchema = z.object({
  stage: z.enum(["screening", "shortlisted", "interview", "technical_test", "offer", "rejected"]),
  note: z.string().trim().max(2000).optional(),
  expected_version: z.number().int().positive(),
  command_id: z.string().uuid(),
});

type RpcClient = {
  rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>;
};

function errorStatus(code?: string) {
  if (code === "40001" || code === "23505") return 409;
  if (code === "42501") return 403;
  if (code === "P0002") return 404;
  if (code === "22023" || code === "23514") return 422;
  return 500;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireTenantContext({ feature: "recruitment", capability: "manage_recruitment" }, request);
  if ("error" in auth) return auth.error;
  const { id } = await params;
  const parsed = requestSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ message: "A valid stage, version, and command id are required.", requestId: auth.requestId }, { status: 400 });
  }
  const result = await (auth.admin as unknown as RpcClient).rpc("transition_recruitment_application", {
    p_org_id: auth.orgId,
    p_actor_user_id: auth.user.id,
    p_request_id: auth.requestId,
    p_command_id: parsed.data.command_id,
    p_application_id: id,
    p_expected_version: parsed.data.expected_version,
    p_target_stage: parsed.data.stage,
    p_note: parsed.data.note || null,
  });
  if (result.error) {
    return NextResponse.json({ message: result.error.message, requestId: auth.requestId }, { status: errorStatus(result.error.code) });
  }
  const data = Array.isArray(result.data) ? result.data[0] : result.data;
  return NextResponse.json({ data, requestId: auth.requestId }, { headers: { "x-request-id": auth.requestId } });
}
