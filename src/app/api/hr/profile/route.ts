import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantContext } from "@/lib/server/tenant-context";
import { recordOperationalAudit } from "@/lib/server/business-events";

const schema = z.object({
  full_name: z.string().trim().min(2).max(160),
  phone: z.string().trim().max(32).nullable().optional(),
});

export async function PATCH(request: NextRequest) {
  const auth = await requireTenantContext({}, request);
  if ("error" in auth) return auth.error;
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues[0]?.message || "Invalid profile details.", requestId: auth.requestId },
      { status: 400 }
    );
  }

  const { data, error } = await auth.admin
    .from("profiles")
    .update({
      full_name: parsed.data.full_name,
      phone: parsed.data.phone || null,
      updated_at: new Date().toISOString(),
    } as never)
    .eq("org_id", auth.orgId)
    .eq("user_id", auth.user.id)
    .select("user_id, full_name, phone")
    .maybeSingle();

  if (error || !data) {
    await recordOperationalAudit({
      orgId: auth.orgId,
      requestId: auth.requestId,
      actorUserId: auth.user.id,
      actorRole: auth.role,
      action: "profile.self_update",
      targetType: "profile",
      targetId: auth.user.id,
      outcome: "failed",
      statusCode: error ? 500 : 404,
      errorCode: error?.code || "not_found",
    });
    return NextResponse.json({ message: error?.message || "Profile was not found.", requestId: auth.requestId }, { status: error ? 500 : 404 });
  }

  await recordOperationalAudit({
    orgId: auth.orgId,
    requestId: auth.requestId,
    actorUserId: auth.user.id,
    actorRole: auth.role,
    action: "profile.self_update",
    targetType: "profile",
    targetId: auth.user.id,
    outcome: "success",
    statusCode: 200,
    metadata: { changed_fields: ["full_name", "phone"] },
  });
  return NextResponse.json({ profile: data, requestId: auth.requestId });
}
