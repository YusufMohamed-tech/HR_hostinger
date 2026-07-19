import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantContext } from "@/lib/server/tenant-context";

const alertSchema = z.object({
  action: z.enum(["check_in", "check_out"]).default("check_in"),
});

function statusForDatabaseCode(code?: string) {
  if (code === "42501") return 403;
  if (code === "22023") return 400;
  return 500;
}

export async function POST(request: NextRequest) {
  const auth = await requireTenantContext({ feature: "hr", requireEmployee: true }, request);
  if ("error" in auth) return auth.error;

  const parsed = alertSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { message: "Invalid attendance action.", requestId: auth.requestId },
      { status: 400, headers: { "x-request-id": auth.requestId } }
    );
  }

  const { data, error } = await auth.admin.rpc("raise_missing_attendance_location_alert", {
    p_org_id: auth.orgId,
    p_actor_user_id: auth.user.id,
    p_request_id: auth.requestId,
    p_action: parsed.data.action,
  });
  if (error) {
    return NextResponse.json(
      { message: error.message, requestId: auth.requestId },
      { status: statusForDatabaseCode(error.code), headers: { "x-request-id": auth.requestId } }
    );
  }

  const result = data && typeof data === "object" && !Array.isArray(data)
    ? data as Record<string, unknown>
    : {};

  return NextResponse.json(
    { data: result, requestId: auth.requestId },
    { status: result.notified === true ? 202 : 200, headers: { "cache-control": "no-store", "x-request-id": auth.requestId } }
  );
}
