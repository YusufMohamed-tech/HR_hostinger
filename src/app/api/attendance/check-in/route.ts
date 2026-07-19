import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantContext } from "@/lib/server/tenant-context";

const evidenceSchema = z.object({
  requestId: z.string().uuid(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracyMeters: z.number().min(0).max(5000).optional().nullable(),
  deviceLabel: z.string().max(500).optional().nullable(),
  deviceSignal: z.string().max(500).optional().nullable(),
  photoPath: z.string().max(1500).optional().nullable(),
});

function statusForDatabaseCode(code?: string) {
  if (code === "23505") return 409;
  if (code === "42501") return 403;
  if (code === "22023") return 400;
  if (code === "P0001") return 422;
  return 500;
}

export async function POST(request: NextRequest) {
  const auth = await requireTenantContext({ feature: "hr", requireEmployee: true }, request);
  if ("error" in auth) return auth.error;

  const parsed = evidenceSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { message: "Valid attendance location evidence is required.", requestId: auth.requestId },
      { status: 400, headers: { "x-request-id": auth.requestId } }
    );
  }

  const { data, error } = await auth.admin.rpc("attendance_check_in", {
    p_org_id: auth.orgId,
    p_user_id: auth.user.id,
    p_request_id: parsed.data.requestId,
    p_latitude: parsed.data.latitude,
    p_longitude: parsed.data.longitude,
    p_accuracy_meters: parsed.data.accuracyMeters ?? null,
    p_device_label: parsed.data.deviceLabel ?? null,
    p_device_signal: parsed.data.deviceSignal ?? null,
    p_photo_path: parsed.data.photoPath ?? null,
  });

  if (error) {
    return NextResponse.json(
      { message: error.message, requestId: auth.requestId },
      { status: statusForDatabaseCode(error.code), headers: { "x-request-id": auth.requestId } }
    );
  }

  return NextResponse.json(
    { record: data?.[0] ?? null, requestId: auth.requestId },
    { headers: { "cache-control": "no-store", "x-request-id": auth.requestId } }
  );
}
