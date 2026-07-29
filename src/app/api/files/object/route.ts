import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  contentTypeForObject,
  downloadObject,
  verifyObjectAccess,
} from "@/lib/server/file-storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const bucket = request.nextUrl.searchParams.get("bucket") || "";
  const path = request.nextUrl.searchParams.get("path") || "";
  const expires = request.nextUrl.searchParams.get("expires") || "";
  const signature = request.nextUrl.searchParams.get("signature") || "";
  const downloadName = request.nextUrl.searchParams.get("download") || "";
  try {
    if (!verifyObjectAccess({ bucket, path, expires, signature, downloadName })) {
      return NextResponse.json({ message: "File link is invalid or expired." }, { status: 403 });
    }
    const bytes = await downloadObject(createAdminClient(), bucket, path);
    const headers = new Headers({
      "cache-control": "private, no-store, max-age=0",
      "content-type": contentTypeForObject(path),
      "x-content-type-options": "nosniff",
    });
    if (downloadName) {
      headers.set("content-disposition", `attachment; filename*=UTF-8''${encodeURIComponent(downloadName)}`);
    }
    return new NextResponse(Buffer.from(bytes), { headers });
  } catch (error) {
    return NextResponse.json({
      message: error instanceof Error ? error.message : "File download failed.",
    }, { status: 404 });
  }
}
