import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requestIdFromHeaders } from "@/lib/request-id";
import { verifyHostingerStorageMigration } from "@/lib/server/file-storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

function authorized(request: NextRequest) {
  const expected = process.env.FILE_RETENTION_WORKER_SECRET?.trim() ?? "";
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/iu, "").trim() ?? "";
  if (expected.length < 32 || supplied.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  const requestId = requestIdFromHeaders(request.headers);
  try {
    const result = await verifyHostingerStorageMigration();
    return NextResponse.json(
      { status: "ok", ...result, requestId },
      { headers: { "cache-control": "no-store", "x-request-id": requestId } },
    );
  } catch (error) {
    console.error("Hostinger storage verification failed", { requestId, error });
    return NextResponse.json(
      { status: "failed", message: "Hostinger storage verification failed.", requestId },
      {
        status: 500,
        headers: { "cache-control": "no-store", "x-request-id": requestId },
      },
    );
  }
}
