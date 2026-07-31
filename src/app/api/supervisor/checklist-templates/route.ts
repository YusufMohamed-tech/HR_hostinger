import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantContext } from "@/lib/server/tenant-context";

const createTemplateSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).nullable().optional(),
  items: z.array(z.object({
    id: z.string().uuid(),
    label: z.string().min(1).max(500),
    type: z.enum(["boolean", "rating", "text"]),
    required: z.boolean(),
    order: z.number().int().min(0),
  })).min(1),
  location_type: z.enum(["branch", "booth", "office", "area"]).nullable().optional(),
});

export async function GET(request: NextRequest) {
  const auth = await requireTenantContext({ feature: "hr", requireEmployee: true }, request);
  if ("error" in auth) return auth.error;

  const locationType = request.nextUrl.searchParams.get("location_type");

  let query = auth.admin
    .from("site_checklist_templates")
    .select("*")
    .eq("org_id", auth.orgId)
    .eq("is_active", true)
    .order("created_at", { ascending: false });

  if (locationType) {
    query = query.or(`location_type.eq.${locationType},location_type.is.null`);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json(
      { message: "Failed to fetch templates.", requestId: auth.requestId },
      { status: 500, headers: { "x-request-id": auth.requestId } }
    );
  }

  return NextResponse.json(
    { templates: data ?? [], requestId: auth.requestId },
    { headers: { "cache-control": "no-store", "x-request-id": auth.requestId } }
  );
}

export async function POST(request: NextRequest) {
  const auth = await requireTenantContext(
    { feature: "hr", roles: ["admin", "hr_admin"] },
    request
  );
  if ("error" in auth) return auth.error;

  const body = await request.json().catch(() => ({}));
  const parsed = createTemplateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { message: "Invalid template data.", errors: parsed.error.flatten(), requestId: auth.requestId },
      { status: 400, headers: { "x-request-id": auth.requestId } }
    );
  }

  const { data, error } = await auth.admin
    .from("site_checklist_templates")
    .insert({
      org_id: auth.orgId,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      items: parsed.data.items,
      location_type: parsed.data.location_type ?? null,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json(
      { message: "Failed to create template.", requestId: auth.requestId },
      { status: 500, headers: { "x-request-id": auth.requestId } }
    );
  }

  return NextResponse.json(
    { template: data, requestId: auth.requestId },
    { status: 201, headers: { "x-request-id": auth.requestId } }
  );
}
