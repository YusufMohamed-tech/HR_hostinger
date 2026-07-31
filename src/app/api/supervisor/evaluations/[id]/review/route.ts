import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantContext } from "@/lib/server/tenant-context";
import { createBusinessEvent, enqueueOutboxEvent } from "@/lib/server/business-events";

const reviewSchema = z.object({
  status: z.enum(["reviewed", "flagged"]),
  reviewer_notes: z.string().max(2000).nullable().optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireTenantContext(
    { feature: "hr", roles: ["admin", "hr_admin", "super_admin"], requireEmployee: true },
    request
  );
  if ("error" in auth) return auth.error;

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const parsed = reviewSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { message: "Invalid review data.", requestId: auth.requestId },
      { status: 400, headers: { "x-request-id": auth.requestId } }
    );
  }

  const { data: existing } = await auth.admin
    .from("site_evaluations")
    .select("id, status, supervisor_id")
    .eq("id", id)
    .eq("org_id", auth.orgId)
    .maybeSingle();

  if (!existing) {
    return NextResponse.json(
      { message: "Evaluation not found.", requestId: auth.requestId },
      { status: 404, headers: { "x-request-id": auth.requestId } }
    );
  }

  if (existing.status !== "submitted") {
    return NextResponse.json(
      { message: "Only submitted evaluations can be reviewed.", requestId: auth.requestId },
      { status: 400, headers: { "x-request-id": auth.requestId } }
    );
  }

  const { data, error } = await auth.admin
    .from("site_evaluations")
    .update({
      status: parsed.data.status,
      reviewed_by: auth.employeeId,
      reviewed_at: new Date().toISOString(),
      reviewer_notes: parsed.data.reviewer_notes ?? null,
    })
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json(
      { message: "Failed to review evaluation.", requestId: auth.requestId },
      { status: 500, headers: { "x-request-id": auth.requestId } }
    );
  }

  try {
    const { event } = await createBusinessEvent({
      orgId: auth.orgId,
      sourceType: `site_evaluation.${parsed.data.status}`,
      businessKey: `evaluation:${id}:${parsed.data.status}`,
      payload: {
        evaluation_id: id,
        reviewer_id: auth.employeeId,
        supervisor_id: String(existing.supervisor_id),
        status: parsed.data.status,
      },
      actorUserId: auth.user.id,
      requestId: auth.requestId,
    });
    await enqueueOutboxEvent({
      orgId: auth.orgId,
      businessEventId: event.id,
      topic: `site_evaluation.${parsed.data.status}`,
      payload: {
        evaluation_id: id,
        reviewer_id: auth.employeeId,
        supervisor_id: String(existing.supervisor_id),
        reviewer_user_id: auth.user.id,
        status: parsed.data.status,
      },
    });
  } catch {
    // non-critical
  }

  return NextResponse.json(
    { evaluation: data, requestId: auth.requestId },
    { headers: { "x-request-id": auth.requestId } }
  );
}
