import { NextRequest, NextResponse } from "next/server";
import { requireTenantContext } from "@/lib/server/tenant-context";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireTenantContext({ feature: "hr", requireEmployee: true }, request);
  if ("error" in auth) return auth.error;

  const { id } = await params;
  const isAdmin = ["admin", "hr_admin", "super_admin"].includes(auth.role);

  let query = auth.admin
    .from("site_evaluations")
    .select("*, locations(id, name, type, city), employees!site_evaluations_supervisor_id_fkey(id, full_name)")
    .eq("id", id)
    .eq("org_id", auth.orgId);

  if (!isAdmin) {
    query = query.eq("supervisor_id", auth.employeeId);
  }

  const { data, error } = await query.maybeSingle();

  if (error || !data) {
    return NextResponse.json(
      { message: "Evaluation not found.", requestId: auth.requestId },
      { status: 404, headers: { "x-request-id": auth.requestId } }
    );
  }

  const { data: attachments } = await auth.admin
    .from("site_evaluation_attachments")
    .select("*")
    .eq("evaluation_id", id)
    .order("created_at", { ascending: true });

  return NextResponse.json(
    { evaluation: { ...data, attachments: attachments ?? [] }, requestId: auth.requestId },
    { headers: { "cache-control": "no-store", "x-request-id": auth.requestId } }
  );
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireTenantContext(
    { feature: "hr", roles: ["supervisor", "admin", "hr_admin"], requireEmployee: true },
    request
  );
  if ("error" in auth) return auth.error;

  const { id } = await params;
  const body = await request.json().catch(() => ({}));

  const { data: existing } = await auth.admin
    .from("site_evaluations")
    .select("id, supervisor_id, status")
    .eq("id", id)
    .eq("org_id", auth.orgId)
    .maybeSingle();

  if (!existing) {
    return NextResponse.json(
      { message: "Evaluation not found.", requestId: auth.requestId },
      { status: 404, headers: { "x-request-id": auth.requestId } }
    );
  }

  if (existing.supervisor_id !== auth.employeeId && !["admin", "hr_admin", "super_admin"].includes(auth.role)) {
    return NextResponse.json(
      { message: "Forbidden.", requestId: auth.requestId },
      { status: 403, headers: { "x-request-id": auth.requestId } }
    );
  }

  if (existing.status !== "draft" && existing.supervisor_id === auth.employeeId) {
    return NextResponse.json(
      { message: "Cannot edit a submitted evaluation.", requestId: auth.requestId },
      { status: 400, headers: { "x-request-id": auth.requestId } }
    );
  }

  const updateFields: Record<string, unknown> = {};
  if (body.responses !== undefined) updateFields.responses = body.responses;
  if (body.overall_score !== undefined) updateFields.overall_score = body.overall_score;
  if (body.comment !== undefined) updateFields.comment = body.comment;
  if (body.status === "submitted" && existing.status === "draft") {
    updateFields.status = "submitted";
    updateFields.submitted_at = new Date().toISOString();
  }

  const { data, error } = await auth.admin
    .from("site_evaluations")
    .update(updateFields)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json(
      { message: "Failed to update evaluation.", requestId: auth.requestId },
      { status: 500, headers: { "x-request-id": auth.requestId } }
    );
  }

  return NextResponse.json(
    { evaluation: data, requestId: auth.requestId },
    { headers: { "x-request-id": auth.requestId } }
  );
}
