import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantContext } from "@/lib/server/tenant-context";
import { createBusinessEvent, enqueueOutboxEvent } from "@/lib/server/business-events";

const createEvaluationSchema = z.object({
  location_id: z.string().uuid(),
  attendance_record_id: z.string().uuid().nullable().optional(),
  template_id: z.string().uuid().nullable().optional(),
  responses: z.array(z.object({
    item_id: z.string().uuid(),
    label: z.string(),
    value: z.union([z.boolean(), z.number(), z.string()]),
    notes: z.string().max(2000).optional(),
  })),
  overall_score: z.number().min(0).max(5).nullable().optional(),
  comment: z.string().max(5000).nullable().optional(),
  evaluation_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function GET(request: NextRequest) {
  const auth = await requireTenantContext({ feature: "hr", requireEmployee: true }, request);
  if ("error" in auth) return auth.error;

  const params = request.nextUrl.searchParams;
  const page = Math.max(1, parseInt(params.get("page") ?? "1"));
  const limit = Math.min(50, Math.max(1, parseInt(params.get("limit") ?? "20")));
  const offset = (page - 1) * limit;
  const locationId = params.get("location_id");
  const status = params.get("status");
  const dateFrom = params.get("date_from");
  const dateTo = params.get("date_to");

  const isAdmin = ["admin", "hr_admin", "super_admin"].includes(auth.role);

  let query = auth.admin
    .from("site_evaluations")
    .select("*, locations(id, name, type), employees!site_evaluations_supervisor_id_fkey(id, full_name)", { count: "exact" })
    .eq("org_id", auth.orgId)
    .order("evaluation_date", { ascending: false })
    .range(offset, offset + limit - 1);

  if (!isAdmin) {
    query = query.eq("supervisor_id", auth.employeeId);
  }

  if (locationId) query = query.eq("location_id", locationId);
  if (status) query = query.eq("status", status);
  if (dateFrom) query = query.gte("evaluation_date", dateFrom);
  if (dateTo) query = query.lte("evaluation_date", dateTo);

  const { data, error, count } = await query;

  if (error) {
    return NextResponse.json(
      { message: "Failed to fetch evaluations.", requestId: auth.requestId },
      { status: 500, headers: { "x-request-id": auth.requestId } }
    );
  }

  return NextResponse.json(
    { evaluations: data ?? [], total: count ?? 0, page, limit, requestId: auth.requestId },
    { headers: { "cache-control": "no-store", "x-request-id": auth.requestId } }
  );
}

export async function POST(request: NextRequest) {
  const auth = await requireTenantContext(
    { feature: "hr", roles: ["supervisor", "admin", "hr_admin"], requireEmployee: true },
    request
  );
  if ("error" in auth) return auth.error;

  const body = await request.json().catch(() => ({}));
  const parsed = createEvaluationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { message: "Invalid evaluation data.", errors: parsed.error.flatten(), requestId: auth.requestId },
      { status: 400, headers: { "x-request-id": auth.requestId } }
    );
  }

  const { data: locationAssignment } = await auth.admin
    .from("employee_locations")
    .select("id")
    .eq("employee_id", auth.employeeId)
    .eq("location_id", parsed.data.location_id)
    .or("assigned_to.is.null,assigned_to.gte." + parsed.data.evaluation_date)
    .maybeSingle();

  if (!locationAssignment) {
    return NextResponse.json(
      { message: "You are not assigned to this location.", requestId: auth.requestId },
      { status: 403, headers: { "x-request-id": auth.requestId } }
    );
  }

  if (parsed.data.template_id) {
    const { data: template } = await auth.admin
      .from("site_checklist_templates")
      .select("items")
      .eq("id", parsed.data.template_id)
      .eq("org_id", auth.orgId)
      .eq("is_active", true)
      .maybeSingle();

    if (template) {
      const requiredIds = (template.items as Array<{ id: string; required: boolean }>)
        .filter((item) => item.required)
        .map((item) => item.id);
      const answeredIds = new Set(parsed.data.responses.map((r) => r.item_id));
      const missing = requiredIds.filter((id) => !answeredIds.has(id));
      if (missing.length > 0) {
        return NextResponse.json(
          { message: "Missing required checklist items.", missing, requestId: auth.requestId },
          { status: 400, headers: { "x-request-id": auth.requestId } }
        );
      }
    }
  }

  const { data, error } = await auth.admin
    .from("site_evaluations")
    .insert({
      org_id: auth.orgId,
      supervisor_id: auth.employeeId,
      location_id: parsed.data.location_id,
      attendance_record_id: parsed.data.attendance_record_id ?? null,
      template_id: parsed.data.template_id ?? null,
      responses: parsed.data.responses,
      overall_score: parsed.data.overall_score ?? null,
      comment: parsed.data.comment ?? null,
      evaluation_date: parsed.data.evaluation_date,
      status: "submitted",
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json(
      { message: "Failed to create evaluation.", requestId: auth.requestId },
      { status: 500, headers: { "x-request-id": auth.requestId } }
    );
  }

  const evaluationId = String(data.id ?? "");
  try {
    const { event } = await createBusinessEvent({
      orgId: auth.orgId,
      sourceType: "site_evaluation.submitted",
      businessKey: `evaluation:${evaluationId}`,
      payload: {
        evaluation_id: evaluationId,
        supervisor_id: auth.employeeId,
        location_id: parsed.data.location_id,
        evaluation_date: parsed.data.evaluation_date,
        overall_score: parsed.data.overall_score ?? null,
      },
      actorUserId: auth.user.id,
      requestId: auth.requestId,
    });
    await enqueueOutboxEvent({
      orgId: auth.orgId,
      businessEventId: event.id,
      topic: "site_evaluation.submitted",
      payload: {
        evaluation_id: evaluationId,
        supervisor_id: auth.employeeId,
        supervisor_user_id: auth.user.id,
        location_id: parsed.data.location_id,
        evaluation_date: parsed.data.evaluation_date,
        overall_score: parsed.data.overall_score ?? null,
      },
    });
  } catch {
    // non-critical: evaluation is saved even if notification fails
  }

  return NextResponse.json(
    { evaluation: data, requestId: auth.requestId },
    { status: 201, headers: { "x-request-id": auth.requestId } }
  );
}
