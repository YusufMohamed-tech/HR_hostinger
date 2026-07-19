import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantContext } from "@/lib/server/tenant-context";

const createSchema = z.object({
  application_id: z.string().uuid(),
  expected_version: z.number().int().positive(),
  command_id: z.string().uuid(),
  scheduled_at: z.string().datetime({ offset: true }),
  type: z.enum(["in_person", "video", "phone"]),
  location: z.string().trim().max(1000).optional(),
  notes: z.string().trim().max(2000).optional(),
});

type RpcClient = {
  rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>;
};

export async function GET(request: NextRequest) {
  const auth = await requireTenantContext({ feature: "recruitment", capability: "manage_recruitment" }, request);
  if ("error" in auth) return auth.error;
  const appId = new URL(request.url).searchParams.get("application_id");
  if (!appId) return NextResponse.json({ message: "application_id is required", requestId: auth.requestId }, { status: 400 });
  const application = await auth.admin.from("job_applications").select("job:job_posting_id(created_by)")
    .eq("org_id", auth.orgId).eq("id", appId).maybeSingle();
  if (!application.data) return NextResponse.json({ message: "Application not found", requestId: auth.requestId }, { status: 404 });
  const posting = application.data.job as unknown as { created_by?: string | null } | null;
  if (auth.role === "hr_recruitment" && posting?.created_by !== auth.user.id) {
    return NextResponse.json({ message: "Forbidden", requestId: auth.requestId }, { status: 403 });
  }
  const result = await auth.admin.from("interviews").select("*").eq("org_id", auth.orgId)
    .eq("job_application_id", appId).order("created_at", { ascending: false });
  if (result.error) return NextResponse.json({ message: result.error.message, requestId: auth.requestId }, { status: 500 });
  return NextResponse.json({ data: result.data || [], requestId: auth.requestId });
}

export async function POST(request: NextRequest) {
  const auth = await requireTenantContext({ feature: "recruitment", capability: "manage_recruitment" }, request);
  if ("error" in auth) return auth.error;
  const parsed = createSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ message: "Interview data is invalid.", requestId: auth.requestId }, { status: 400 });
  const result = await (auth.admin as unknown as RpcClient).rpc("schedule_recruitment_interview", {
    p_org_id: auth.orgId,
    p_actor_user_id: auth.user.id,
    p_request_id: auth.requestId,
    p_command_id: parsed.data.command_id,
    p_application_id: parsed.data.application_id,
    p_expected_version: parsed.data.expected_version,
    p_payload: {
      scheduled_at: parsed.data.scheduled_at,
      type: parsed.data.type,
      location: parsed.data.location || null,
      notes: parsed.data.notes || null,
    },
  });
  if (result.error) {
    const status = result.error.code === "40001" || result.error.code === "23505" ? 409
      : result.error.code === "42501" ? 403 : result.error.code === "P0002" ? 404
        : result.error.code === "22023" || result.error.code === "23514" ? 422 : 500;
    return NextResponse.json({ message: result.error.message, requestId: auth.requestId }, { status });
  }
  const data = Array.isArray(result.data) ? result.data[0] : result.data;
  return NextResponse.json({ data, requestId: auth.requestId }, { status: 201 });
}
