import { createHmac } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantContext } from "@/lib/server/tenant-context";

type RpcClient = { rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string; code?: string } | null }> };
const schema = z.object({ command_id: z.string().uuid(), expected_version: z.number().int().positive(), typed_name: z.string().trim().min(2).max(160) });

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireTenantContext({ requireEmployee: true }, request);
  if ("error" in auth) return auth.error;
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ message: "Invalid balance id.", requestId: auth.requestId }, { status: 400 });
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ message: parsed.error.issues[0]?.message || "Acknowledgement is invalid.", requestId: auth.requestId }, { status: 400 });
  const secret = process.env.AUDIT_EVIDENCE_SECRET?.trim() || (process.env.NODE_ENV === "production" ? "" : "development-only-evidence-secret");
  if (secret.length < 32) return NextResponse.json({ message: "Electronic evidence hashing is not configured.", requestId: auth.requestId }, { status: 503 });
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const evidence = { consent: true, terms_version: "financial-balance-ack-v1",
    signed_at: new Date().toISOString(), user_agent: (request.headers.get("user-agent") || "unknown").slice(0, 500),
    ip_hash: createHmac("sha256", secret).update(forwarded).digest("hex") };
  const result = await (auth.admin as unknown as RpcClient).rpc("acknowledge_financial_balance", {
    p_org_id: auth.orgId, p_actor_user_id: auth.user.id, p_request_id: auth.requestId,
    p_command_id: parsed.data.command_id, p_balance_id: id, p_expected_version: parsed.data.expected_version,
    p_typed_name: parsed.data.typed_name, p_evidence: evidence,
  });
  if (result.error) {
    const status = result.error.code === "P0002" ? 404 : result.error.code === "40001" || result.error.code === "23505" ? 409
      : result.error.code === "42501" ? 403 : result.error.code === "23514" ? 422 : 500;
    return NextResponse.json({ message: result.error.message, requestId: auth.requestId }, { status });
  }
  const data = Array.isArray(result.data) ? result.data[0] ?? null : result.data;
  return NextResponse.json({ data, requestId: auth.requestId });
}
