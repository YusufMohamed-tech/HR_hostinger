import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantContext } from "@/lib/server/tenant-context";

type RpcClient = {
  rpc: (name: string, args: Record<string, unknown>) => Promise<{
    data: unknown;
    error: { message: string; code?: string } | null;
  }>;
};

const base = z.object({
  command_id: z.string().uuid(),
  target_id: z.string().uuid(),
});

const commandSchema = z.discriminatedUnion("action", [
  base.extend({
    action: z.literal("save_shift"),
    expected_version: z.number().int().positive().nullable().optional(),
    name: z.string().trim().min(1).max(160),
    shift_type: z.enum(["morning", "night", "flexible"]),
    start_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/),
    end_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/),
    location_id: z.string().uuid().nullable().optional(),
  }),
  base.extend({
    action: z.literal("delete_shift"),
    expected_version: z.number().int().positive(),
  }),
  base.extend({
    action: z.literal("assign_shift"),
    employee_id: z.string().uuid(),
    shift_id: z.string().uuid(),
    start_date: z.string().date().optional(),
    end_date: z.string().date().optional(),
  }).refine((value) => !value.end_date || !value.start_date || value.end_date >= value.start_date, {
    message: "Assignment end date cannot precede its start date.",
  }),
  base.extend({
    action: z.literal("remove_assignment"),
    expected_version: z.number().int().positive(),
  }),
]);

function statusFor(code?: string) {
  if (code === "P0002") return 404;
  if (code === "40001" || code === "23505" || code === "23P01") return 409;
  if (code === "42501") return 403;
  if (code === "22023" || code === "23514" || code === "22P02" || code === "22007") return 422;
  return 500;
}

export async function POST(request: NextRequest) {
  const auth = await requireTenantContext({ capability: "manage_attendance", feature: "hr" }, request);
  if ("error" in auth) return auth.error;
  const parsed = commandSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({
      message: parsed.error.issues[0]?.message || "Schedule command is invalid.",
      requestId: auth.requestId,
    }, { status: 400 });
  }

  const { action, command_id, target_id } = parsed.data;
  const expectedVersion = "expected_version" in parsed.data ? parsed.data.expected_version ?? null : null;
  let payload: Record<string, unknown> = {};
  if (action === "save_shift") {
    payload = {
      name: parsed.data.name,
      shift_type: parsed.data.shift_type,
      start_time: parsed.data.start_time,
      end_time: parsed.data.end_time,
      location_id: parsed.data.location_id || null,
    };
  } else if (action === "assign_shift") {
    payload = {
      employee_id: parsed.data.employee_id,
      shift_id: parsed.data.shift_id,
      start_date: parsed.data.start_date || null,
      end_date: parsed.data.end_date || null,
    };
  }

  const result = await (auth.admin as unknown as RpcClient).rpc("execute_schedule_command", {
    p_org_id: auth.orgId,
    p_actor_user_id: auth.user.id,
    p_request_id: auth.requestId,
    p_command_id: command_id,
    p_command_type: action,
    p_target_id: target_id,
    p_expected_version: expectedVersion,
    p_payload: payload,
  });
  if (result.error) {
    return NextResponse.json({ message: result.error.message, requestId: auth.requestId }, {
      status: statusFor(result.error.code),
    });
  }
  return NextResponse.json({ data: result.data, requestId: auth.requestId }, {
    status: action === "save_shift" && expectedVersion === null || action === "assign_shift" ? 201 : 200,
  });
}
