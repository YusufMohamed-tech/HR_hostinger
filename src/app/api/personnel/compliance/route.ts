import { NextRequest, NextResponse } from "next/server";
import { enqueueComplianceAlerts } from "@/lib/server/compliance-jobs";
import { requireTenantContext } from "@/lib/server/tenant-context";

export async function POST(request: NextRequest) {
  const auth = await requireTenantContext({ roles: ["admin", "hr_admin"], feature: "personnel" }, request);
  if ("error" in auth) return auth.error;
  try {
    const result = await enqueueComplianceAlerts({ requestId: auth.requestId });
    return NextResponse.json(
      { data: result, requestId: auth.requestId },
      { headers: { "cache-control": "no-store", "x-request-id": auth.requestId } },
    );
  } catch (error) {
    console.error("Authenticated compliance trigger failed", { requestId: auth.requestId, error });
    return NextResponse.json(
      { message: "Unable to enqueue compliance reminders.", requestId: auth.requestId },
      { status: 500, headers: { "cache-control": "no-store", "x-request-id": auth.requestId } },
    );
  }
}
