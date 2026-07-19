import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requestIdFromHeaders } from "@/lib/request-id";

const requestSchema = z.object({
  response: z.enum(["accepted", "declined"]),
  command_id: z.string().uuid(),
});

type RpcClient = {
  rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>;
};

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = requestIdFromHeaders(request.headers);
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "غير مصرح", requestId }, { status: 401 });
  const parsed = requestSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "استجابة العرض غير صالحة", requestId }, { status: 400 });
  const { id } = await params;
  const result = await (createAdminClient() as unknown as RpcClient).rpc("respond_to_recruitment_offer", {
    p_candidate_user_id: user.id,
    p_request_id: requestId,
    p_command_id: parsed.data.command_id,
    p_application_id: id,
    p_response: parsed.data.response,
  });
  if (result.error) {
    const status = result.error.code === "P0002" ? 404 : result.error.code === "23514" ? 409 : 500;
    return NextResponse.json({ error: result.error.message, requestId }, { status });
  }
  const data = Array.isArray(result.data) ? result.data[0] : result.data;
  return NextResponse.json({ data, requestId }, { headers: { "x-request-id": requestId } });
}
