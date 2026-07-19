import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { consumeRateLimit, rateLimitResponse, requestIp } from "@/lib/server/rate-limit";
import { requestIdFromHeaders } from "@/lib/request-id";

export async function POST(request: NextRequest) {
  const requestId = requestIdFromHeaders(request.headers);
  const parsed = z.object({ email: z.string().trim().email().max(320) }).safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ message: "Enter a valid email address.", requestId }, { status: 400 });
  try {
    const rate = await consumeRateLimit({ scope: "auth:recovery", identifier: `${requestIp(request)}:${parsed.data.email}`,
      limit: 3, windowSeconds: 3600, blockSeconds: 3600 });
    if (!rate.allowed) return rateLimitResponse(rate, requestId);
  } catch (error) {
    console.error("Recovery protection unavailable", { requestId, error });
    return NextResponse.json({ message: "Recovery is temporarily unavailable.", requestId }, { status: 503 });
  }
  const supabase = await createServerSupabaseClient();
  const origin = new URL(request.url).origin;
  await supabase.auth.resetPasswordForEmail(parsed.data.email,
    { redirectTo: `${origin}/auth/callback?next=${encodeURIComponent("/reset-password")}` });
  return NextResponse.json({ data: { accepted: true }, requestId });
}
