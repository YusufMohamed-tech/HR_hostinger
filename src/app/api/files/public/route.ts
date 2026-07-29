import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  contentTypeForObject,
  downloadObject,
} from "@/lib/server/file-storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const bucket = request.nextUrl.searchParams.get("bucket") || "";
  const path = request.nextUrl.searchParams.get("path") || "";
  if (bucket !== "merchant-place-photos") {
    return NextResponse.json({ message: "Public file is not available." }, { status: 404 });
  }
  try {
    const bytes = await downloadObject(createAdminClient(), bucket, path);
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "cache-control": "public, max-age=3600, stale-while-revalidate=86400",
        "content-type": contentTypeForObject(path),
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ message: "Public file was not found." }, { status: 404 });
  }
}
