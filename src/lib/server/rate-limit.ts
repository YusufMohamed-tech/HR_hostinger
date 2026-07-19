import "server-only";

import { createHmac } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

type RpcClient = { rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }> };
export type RateLimitResult = { allowed: boolean; remaining: number; retryAfterSeconds: number; limit: number };

function hashingSecret() {
  const secret = process.env.RATE_LIMIT_HASH_SECRET?.trim()
    || (process.env.NODE_ENV === "production" ? "" : "development-only-rate-limit-secret");
  if (secret.length < 32) throw new Error("RATE_LIMIT_HASH_SECRET must contain at least 32 characters.");
  return secret;
}

export function requestIp(request: NextRequest) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")?.trim() || "unknown";
}

export function hashRateLimitIdentifier(value: string) {
  return createHmac("sha256", hashingSecret()).update(value.trim().toLowerCase()).digest("hex");
}

export async function consumeRateLimit(values: {
  scope: string; identifier: string; limit: number; windowSeconds: number; blockSeconds: number;
  admin?: ReturnType<typeof createAdminClient>;
}) {
  const admin = values.admin || createAdminClient();
  const result = await (admin as unknown as RpcClient).rpc("consume_api_rate_limit", {
    p_scope: values.scope,
    p_identifier_hash: hashRateLimitIdentifier(values.identifier),
    p_limit: values.limit,
    p_window_seconds: values.windowSeconds,
    p_block_seconds: values.blockSeconds,
    p_now: new Date().toISOString(),
  });
  if (result.error) throw new Error(`Rate-limit service failed: ${result.error.message}`);
  return result.data as RateLimitResult;
}

export function rateLimitResponse(result: RateLimitResult, requestId = crypto.randomUUID()) {
  return NextResponse.json(
    { message: "Too many requests. Please try again later.", requestId },
    { status: 429, headers: { "retry-after": String(result.retryAfterSeconds),
      "x-ratelimit-limit": String(result.limit), "x-ratelimit-remaining": String(result.remaining),
      "x-request-id": requestId, "cache-control": "no-store" } },
  );
}
