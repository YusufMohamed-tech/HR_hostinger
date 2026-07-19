import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantContext } from "@/lib/server/tenant-context";

const updateSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("mark_one"), id: z.string().uuid(), is_read: z.boolean().default(true) }),
  z.object({ action: z.literal("mark_all") }),
]);

export async function GET(request: NextRequest) {
  const auth = await requireTenantContext({}, request);
  if ("error" in auth) return auth.error;

  const { data, error } = await auth.admin
    .from("notifications")
    .select("*")
    .eq("org_id", auth.orgId)
    .eq("user_id", auth.user.id)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    return NextResponse.json({ message: error.message, requestId: auth.requestId }, { status: 500 });
  }
  return NextResponse.json({ data: data || [], requestId: auth.requestId }, {
    headers: { "cache-control": "no-store", "x-request-id": auth.requestId },
  });
}

export async function PATCH(request: NextRequest) {
  const auth = await requireTenantContext({}, request);
  if ("error" in auth) return auth.error;
  const parsed = updateSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ message: parsed.error.issues[0]?.message || "Invalid notification update.", requestId: auth.requestId }, { status: 400 });
  }

  let query = auth.admin
    .from("notifications")
    .update({ is_read: parsed.data.action === "mark_all" ? true : parsed.data.is_read })
    .eq("org_id", auth.orgId)
    .eq("user_id", auth.user.id);
  if (parsed.data.action === "mark_one") query = query.eq("id", parsed.data.id);
  else query = query.eq("is_read", false);
  const { error } = await query;

  if (error) {
    return NextResponse.json({ message: error.message, requestId: auth.requestId }, { status: 500 });
  }
  return NextResponse.json({ data: { updated: true }, requestId: auth.requestId }, {
    headers: { "cache-control": "no-store", "x-request-id": auth.requestId },
  });
}
