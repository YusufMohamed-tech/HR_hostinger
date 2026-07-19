import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { consumeRateLimit, rateLimitResponse, requestIp } from "@/lib/server/rate-limit";
import { requestIdFromHeaders } from "@/lib/request-id";

const schema = z.object({ full_name: z.string().trim().min(2).max(160), email: z.string().trim().email().max(320),
  password: z.string().min(12).max(128).regex(/[a-z]/).regex(/[A-Z]/).regex(/\d/) });

export async function POST(request: NextRequest) {
  const requestId = requestIdFromHeaders(request.headers);
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ message: "Use 12+ characters with upper/lowercase letters and a number.", requestId }, { status: 400 });
  try {
    const rate = await consumeRateLimit({ scope: "auth:candidate-register",
      identifier: `${requestIp(request)}:${parsed.data.email}`, limit: 3, windowSeconds: 3600, blockSeconds: 3600 });
    if (!rate.allowed) return rateLimitResponse(rate, requestId);
  } catch (error) {
    console.error("Registration protection unavailable", { requestId, error });
    return NextResponse.json({ message: "Registration is temporarily unavailable.", requestId }, { status: 503 });
  }
  const supabase = await createServerSupabaseClient();
  const result = await supabase.auth.signUp({ email: parsed.data.email, password: parsed.data.password,
    options: { data: { full_name: parsed.data.full_name } } });
  if (result.error) return NextResponse.json({ message: "Unable to create the account.", requestId }, { status: 400 });
  return NextResponse.json({ data: { accepted: true }, requestId }, { status: 201 });
}
