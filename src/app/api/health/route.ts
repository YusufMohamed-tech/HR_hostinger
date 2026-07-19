import { NextRequest, NextResponse } from "next/server";
import { requestIdFromHeaders } from "@/lib/request-id";

export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  const requestId = requestIdFromHeaders(request.headers);
  return NextResponse.json(
    {
      status: "ok",
      service: "tatwir-hrms",
      time: new Date().toISOString(),
      requestId,
    },
    {
      headers: {
        "cache-control": "no-store",
        "x-request-id": requestId,
      },
    }
  );
}
