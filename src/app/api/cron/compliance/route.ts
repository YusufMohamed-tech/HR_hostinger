import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { enqueueComplianceAlerts } from "@/lib/server/compliance-jobs";
import { requestIdFromHeaders } from "@/lib/request-id";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim() ?? "";
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
  if (!secret) {
    const complianceSecret = process.env.COMPLIANCE_WORKER_SECRET?.trim() ?? "";
    if (complianceSecret.length < 32 || supplied.length !== complianceSecret.length) return false;
    return timingSafeEqual(Buffer.from(supplied), Buffer.from(complianceSecret));
  }
  if (secret.length < 8 || supplied.length !== secret.length) return false;
  return timingSafeEqual(Buffer.from(supplied), Buffer.from(secret));
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const requestId = requestIdFromHeaders(request.headers);
  try {
    const result = await enqueueComplianceAlerts({ requestId });
    return NextResponse.json(
      { ...result, requestId },
      { headers: { "cache-control": "no-store", "x-request-id": requestId } }
    );
  } catch (error) {
    console.error("Cron compliance worker failed", { requestId, error });
    return NextResponse.json(
      { message: "Compliance processing failed.", requestId },
      { status: 500, headers: { "cache-control": "no-store", "x-request-id": requestId } }
    );
  }
}
