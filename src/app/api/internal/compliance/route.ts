import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { enqueueComplianceAlerts } from "@/lib/server/compliance-jobs";
import { requestIdFromHeaders } from "@/lib/request-id";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(request: NextRequest) {
  const expected = process.env.COMPLIANCE_WORKER_SECRET?.trim() ?? "";
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
  if (expected.length < 32 || supplied.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }
  const requestId = requestIdFromHeaders(request.headers);
  try {
    const result = await enqueueComplianceAlerts({ requestId });
    return NextResponse.json(
      { ...result, requestId },
      { headers: { "cache-control": "no-store", "x-request-id": requestId } },
    );
  } catch (error) {
    console.error("Compliance worker failed", { requestId, error });
    return NextResponse.json(
      { message: "Compliance job failed.", requestId },
      { status: 500, headers: { "cache-control": "no-store", "x-request-id": requestId } },
    );
  }
}
