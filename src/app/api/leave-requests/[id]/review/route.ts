import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantContext } from "@/lib/server/tenant-context";

const reviewSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  note: z.string().trim().max(2000).optional().nullable(),
  commandId: z.string().uuid().optional(),
}).superRefine((value, context) => {
  if (value.decision === "rejected" && !value.note) {
    context.addIssue({ code: "custom", path: ["note"], message: "A rejection note is required." });
  }
});

function statusForDatabaseCode(code?: string) {
  if (code === "23505") return 409;
  if (code === "42501") return 403;
  if (code === "P0002") return 404;
  if (code === "P0001") return 422;
  if (code === "22023" || code === "23P01") return 400;
  return 500;
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireTenantContext({ feature: "hr" }, request);
  if ("error" in auth) return auth.error;
  const { id } = await context.params;
  const parsed = reviewSchema.safeParse(await request.json().catch(() => ({})));
  if (!z.string().uuid().safeParse(id).success || !parsed.success) {
    const message = parsed.success
      ? "Valid leave review input is required."
      : parsed.error.issues[0]?.message || "Valid leave review input is required.";
    return NextResponse.json(
      { message, requestId: auth.requestId },
      { status: 400, headers: { "x-request-id": auth.requestId } }
    );
  }

  const { data, error } = await auth.admin.rpc("execute_leave_review_command", {
    p_org_id: auth.orgId,
    p_actor_user_id: auth.user.id,
    p_leave_request_id: id,
    p_command_id: parsed.data.commandId ?? crypto.randomUUID(),
    p_decision: parsed.data.decision,
    p_note: parsed.data.note ?? null,
  });

  if (error) {
    return NextResponse.json(
      { message: error.message, requestId: auth.requestId },
      { status: statusForDatabaseCode(error.code), headers: { "x-request-id": auth.requestId } }
    );
  }
  return NextResponse.json(
    { request: data ?? null, requestId: auth.requestId },
    { headers: { "cache-control": "no-store", "x-request-id": auth.requestId } }
  );
}
