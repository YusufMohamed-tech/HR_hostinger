import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { processOutboxBatch } from "@/lib/server/outbox-worker";
import { requestIdFromHeaders } from "@/lib/request-id";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(request: NextRequest) {
  const expected = process.env.OUTBOX_WORKER_SECRET?.trim() ?? "";
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
  if (expected.length < 32 || supplied.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}

function unauthorized() {
  return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) return unauthorized();
  const requestId = requestIdFromHeaders(request.headers);
  const body = await request.json().catch(() => ({}));
  const requestedBatch = Number(body.batchSize ?? 25);
  const batchSize = Number.isFinite(requestedBatch)
    ? Math.min(Math.max(Math.trunc(requestedBatch), 1), 100)
    : 25;
  try {
    const result = await processOutboxBatch(`api:${requestId}`, batchSize);
    return NextResponse.json(
      { ...result, requestId },
      { headers: { "cache-control": "no-store", "x-request-id": requestId } }
    );
  } catch (error) {
    console.error("Outbox worker failed", { requestId, error });
    return NextResponse.json(
      { message: "Outbox worker failed.", requestId },
      { status: 500, headers: { "cache-control": "no-store", "x-request-id": requestId } },
    );
  }
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) return unauthorized();
  const requestId = requestIdFromHeaders(request.headers);
  try {
    const admin = createAdminClient();
    const statuses = ["pending", "processing", "failed", "dead_letter"] as const;
    const counts = await Promise.all(statuses.map(async (status) => {
      const { count, error } = await admin
        .from("event_outbox")
        .select("id", { head: true, count: "exact" })
        .eq("status", status);
      if (error) throw new Error(`Unable to inspect ${status} outbox events: ${error.message}`);
      return [status, count ?? 0] as const;
    }));
    const queue = Object.fromEntries(counts);
    const healthy = queue.dead_letter === 0;

    return NextResponse.json(
      { status: healthy ? "ok" : "degraded", queue, requestId },
      {
        status: healthy ? 200 : 503,
        headers: { "cache-control": "no-store", "x-request-id": requestId },
      }
    );
  } catch (error) {
    console.error("Outbox health check failed", { requestId, error });
    return NextResponse.json(
      { status: "failed", message: "Unable to inspect the outbox queue.", requestId },
      { status: 500, headers: { "cache-control": "no-store", "x-request-id": requestId } },
    );
  }
}
