import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { processOutboxBatch } from "@/lib/server/outbox-worker";
import { requestIdFromHeaders } from "@/lib/request-id";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim() ?? "";
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
  if (!secret) {
    const outboxSecret = process.env.OUTBOX_WORKER_SECRET?.trim() ?? "";
    if (outboxSecret.length < 32 || supplied.length !== outboxSecret.length) return false;
    return timingSafeEqual(Buffer.from(supplied), Buffer.from(outboxSecret));
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
    const result = await processOutboxBatch(`cron:${requestId}`, 50);
    return NextResponse.json(
      { ...result, requestId },
      { headers: { "cache-control": "no-store", "x-request-id": requestId } }
    );
  } catch (error) {
    console.error("Cron outbox worker failed", { requestId, error });
    return NextResponse.json(
      { message: "Outbox processing failed.", requestId },
      { status: 500, headers: { "cache-control": "no-store", "x-request-id": requestId } }
    );
  }
}
