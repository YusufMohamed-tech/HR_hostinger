import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { consumeRateLimit, rateLimitResponse, requestIp } from "@/lib/server/rate-limit";
import { requestIdFromHeaders } from "@/lib/request-id";

const schema = z.object({ email: z.string().trim().email().max(320), password: z.string().min(1).max(1000) });

export async function POST(request: NextRequest) {
  const requestId = requestIdFromHeaders(request.headers);
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ message: "Invalid credentials.", requestId }, { status: 400 });
  try {
    const rate = await consumeRateLimit({ scope: "auth:password-login",
      identifier: `${requestIp(request)}:${parsed.data.email}`, limit: 5, windowSeconds: 900, blockSeconds: 900 });
    if (!rate.allowed) return rateLimitResponse(rate, requestId);
  } catch (error) {
    console.error("Login protection unavailable", { requestId, error });
    return NextResponse.json({ message: "Login is temporarily unavailable.", requestId }, { status: 503 });
  }
  const supabase = await createServerSupabaseClient();
  const result = await supabase.auth.signInWithPassword(parsed.data);
  if (result.error || !result.data.user) {
    return NextResponse.json({ message: "Invalid credentials.", requestId },
      { status: 401, headers: { "cache-control": "no-store", "x-request-id": requestId } });
  }
  return NextResponse.json({ data: { userId: result.data.user.id }, requestId },
    { headers: { "cache-control": "no-store", "x-request-id": requestId } });
}
