import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { processFileRetentionBatch } from "@/lib/server/file-retention";
import { requestIdFromHeaders } from "@/lib/request-id";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(request: NextRequest) {
  const expected = process.env.FILE_RETENTION_WORKER_SECRET?.trim() ?? "";
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
  if (expected.length < 32 || supplied.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  const requestId = requestIdFromHeaders(request.headers);
  const body = await request.json().catch(() => ({}));
  const requestedBatch = Number(body.batchSize ?? 25);
  const batchSize = Number.isFinite(requestedBatch)
    ? Math.min(Math.max(Math.trunc(requestedBatch), 1), 100)
    : 25;
  try {
    const result = await processFileRetentionBatch(`api:${requestId}`, batchSize);
    return NextResponse.json(
      { ...result, requestId },
      { headers: { "cache-control": "no-store", "x-request-id": requestId } },
    );
  } catch (error) {
    console.error("File-retention worker failed", { requestId, error });
    return NextResponse.json(
      { message: "File-retention worker failed.", requestId },
      { status: 500, headers: { "cache-control": "no-store", "x-request-id": requestId } },
    );
  }
}
