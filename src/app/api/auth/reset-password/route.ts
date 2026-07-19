import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { consumeRateLimit, rateLimitResponse, requestIp } from "@/lib/server/rate-limit";
import { requestIdFromHeaders } from "@/lib/request-id";

const passwordSchema = z.string().min(12).max(128).regex(/[a-z]/).regex(/[A-Z]/).regex(/\d/);
export async function POST(request: NextRequest) {
  const requestId = requestIdFromHeaders(request.headers);
  const parsed = z.object({ password: passwordSchema }).safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ message: "Use 12+ characters with upper/lowercase letters and a number.", requestId }, { status: 400 });
  const supabase = await createServerSupabaseClient();
  const user = await supabase.auth.getUser();
  if (user.error || !user.data.user) return NextResponse.json({ message: "Recovery session is invalid or expired.", requestId }, { status: 401 });
  try {
    const rate = await consumeRateLimit({ scope: "auth:reset-password", identifier: `${requestIp(request)}:${user.data.user.id}`,
      limit: 5, windowSeconds: 3600, blockSeconds: 3600 });
    if (!rate.allowed) return rateLimitResponse(rate, requestId);
  } catch (error) {
    console.error("Password reset protection unavailable", { requestId, error });
    return NextResponse.json({ message: "Password reset is temporarily unavailable.", requestId }, { status: 503 });
  }
  const result = await supabase.auth.updateUser({ password: parsed.data.password });
  if (result.error) return NextResponse.json({ message: "Unable to update the password.", requestId }, { status: 400 });
  await supabase.auth.signOut({ scope: "others" });
  return NextResponse.json({ data: { updated: true }, requestId });
}
