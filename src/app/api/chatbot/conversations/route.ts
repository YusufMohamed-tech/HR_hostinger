import { NextRequest } from "next/server";
import { requireTenantContext } from "@/lib/server/tenant-context";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type UntypedClient = { from: (table: string) => any };

export async function GET(req: NextRequest) {
  const tenant = await requireTenantContext({}, req);
  if ("error" in tenant) return tenant.error;

  const db = tenant.admin as unknown as UntypedClient;
  const { data, error } = await db
    .from("chatbot_conversations")
    .select("id, title, created_at, updated_at, is_archived")
    .eq("organization_id", tenant.orgId)
    .eq("user_id", tenant.user.id)
    .eq("is_archived", false)
    .order("updated_at", { ascending: false })
    .limit(20);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ conversations: data });
}

export async function POST(req: NextRequest) {
  const tenant = await requireTenantContext({}, req);
  if ("error" in tenant) return tenant.error;

  const { title } = await req.json();

  const db = tenant.admin as unknown as UntypedClient;
  const { data, error } = await db
    .from("chatbot_conversations")
    .insert({
      organization_id: tenant.orgId,
      user_id: tenant.user.id,
      title: title || null,
    })
    .select("id, title, created_at")
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ conversation: data }, { status: 201 });
}
