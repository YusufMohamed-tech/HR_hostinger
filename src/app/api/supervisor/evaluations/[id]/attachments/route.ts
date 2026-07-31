import { NextRequest, NextResponse } from "next/server";
import { requireTenantContext } from "@/lib/server/tenant-context";
import { storeObject } from "@/lib/server/file-storage";
import crypto from "node:crypto";

const ALLOWED_TYPES = new Set([
  "image/jpeg", "image/png", "image/webp", "image/gif",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireTenantContext(
    { feature: "hr", roles: ["supervisor", "admin", "hr_admin"], requireEmployee: true },
    request
  );
  if ("error" in auth) return auth.error;

  const { id } = await params;

  const { data: evaluation } = await auth.admin
    .from("site_evaluations")
    .select("id, supervisor_id, org_id")
    .eq("id", id)
    .eq("org_id", auth.orgId)
    .maybeSingle();

  if (!evaluation) {
    return NextResponse.json(
      { message: "Evaluation not found.", requestId: auth.requestId },
      { status: 404, headers: { "x-request-id": auth.requestId } }
    );
  }

  if (evaluation.supervisor_id !== auth.employeeId && !["admin", "hr_admin", "super_admin"].includes(auth.role)) {
    return NextResponse.json(
      { message: "Forbidden.", requestId: auth.requestId },
      { status: 403, headers: { "x-request-id": auth.requestId } }
    );
  }

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file") as File | null;

  if (!file || !(file instanceof File)) {
    return NextResponse.json(
      { message: "File is required.", requestId: auth.requestId },
      { status: 400, headers: { "x-request-id": auth.requestId } }
    );
  }

  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json(
      { message: "File type not allowed.", requestId: auth.requestId },
      { status: 400, headers: { "x-request-id": auth.requestId } }
    );
  }

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json(
      { message: "File size exceeds 10 MB limit.", requestId: auth.requestId },
      { status: 400, headers: { "x-request-id": auth.requestId } }
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const extension = file.name.split(".").pop() || "bin";
  const objectPath = `evaluations/${auth.orgId}/${id}/${crypto.randomUUID()}.${extension}`;

  try {
    const stored = await storeObject(auth.admin, {
      bucket: "site-evaluations",
      path: objectPath,
      bytes,
      contentType: file.type,
      upsert: false,
    });

    const { data, error } = await auth.admin
      .from("site_evaluation_attachments")
      .insert({
        org_id: auth.orgId,
        evaluation_id: id,
        file_key: stored.path,
        file_name: file.name,
        file_type: file.type,
        file_size: file.size,
        uploaded_by: auth.employeeId,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json(
        { message: "Failed to save attachment record.", requestId: auth.requestId },
        { status: 500, headers: { "x-request-id": auth.requestId } }
      );
    }

    return NextResponse.json(
      { attachment: data, requestId: auth.requestId },
      { status: 201, headers: { "x-request-id": auth.requestId } }
    );
  } catch (err) {
    return NextResponse.json(
      { message: err instanceof Error ? err.message : "File upload failed.", requestId: auth.requestId },
      { status: 500, headers: { "x-request-id": auth.requestId } }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireTenantContext(
    { feature: "hr", roles: ["supervisor", "admin", "hr_admin"], requireEmployee: true },
    request
  );
  if ("error" in auth) return auth.error;

  const { id } = await params;
  const attachmentId = request.nextUrl.searchParams.get("attachment_id");

  if (!attachmentId) {
    return NextResponse.json(
      { message: "attachment_id is required.", requestId: auth.requestId },
      { status: 400, headers: { "x-request-id": auth.requestId } }
    );
  }

  const { data: attachment } = await auth.admin
    .from("site_evaluation_attachments")
    .select("id, uploaded_by, evaluation_id")
    .eq("id", attachmentId)
    .eq("evaluation_id", id)
    .eq("org_id", auth.orgId)
    .maybeSingle();

  if (!attachment) {
    return NextResponse.json(
      { message: "Attachment not found.", requestId: auth.requestId },
      { status: 404, headers: { "x-request-id": auth.requestId } }
    );
  }

  if (attachment.uploaded_by !== auth.employeeId && !["admin", "hr_admin", "super_admin"].includes(auth.role)) {
    return NextResponse.json(
      { message: "Forbidden.", requestId: auth.requestId },
      { status: 403, headers: { "x-request-id": auth.requestId } }
    );
  }

  await auth.admin
    .from("site_evaluation_attachments")
    .delete()
    .eq("id", attachmentId);

  return NextResponse.json(
    { message: "Attachment deleted.", requestId: auth.requestId },
    { headers: { "x-request-id": auth.requestId } }
  );
}
