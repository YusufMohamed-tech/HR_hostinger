import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantContext } from "@/lib/server/tenant-context";

type RpcClient = {
  rpc: (name: string, args: Record<string, unknown>) => Promise<{
    data: unknown;
    error: { message: string; code?: string } | null;
  }>;
};

const inventorySchema = z.object({
  mode: z.literal("inventory"),
  inventory_id: z.string().uuid(),
  command_id: z.string().uuid(),
  asset_name: z.string().trim().min(2).max(160),
  asset_type: z.string().trim().min(1).max(120).default("Company Asset"),
  serial_number: z.string().trim().min(1).max(160),
  office_location_id: z.string().uuid().optional(),
  purchase_date: z.string().date().optional(),
  purchase_price: z.coerce.number().min(0).max(999_999_999_999).default(0),
  paid_immediately: z.coerce.boolean().default(false),
  useful_life_months: z.coerce.number().int().min(1).max(600).default(60),
  salvage_value: z.coerce.number().min(0).max(999_999_999_999).default(0),
  notes: z.string().trim().max(2000).optional(),
}).refine((value) => value.salvage_value <= value.purchase_price, {
  message: "Salvage value cannot exceed purchase price.",
});

const assignmentSchema = z.object({
  mode: z.literal("assignment").optional().default("assignment"),
  assignment_id: z.string().uuid(),
  command_id: z.string().uuid(),
  employee_id: z.string().uuid(),
  inventory_id: z.string().uuid(),
  notes: z.string().trim().max(2000).optional(),
});

const transitionSchema = z.object({
  id: z.string().uuid(),
  command_id: z.string().uuid(),
  expected_version: z.coerce.number().int().positive(),
  status: z.enum(["returned", "damaged", "lost"]),
});

const acknowledgementSchema = z.object({
  id: z.string().uuid(),
  command_id: z.string().uuid(),
  expected_version: z.coerce.number().int().positive(),
  signature_data: z.string().trim().min(2).max(160),
  consent: z.literal(true),
});

function statusFor(code?: string) {
  if (code === "P0002") return 404;
  if (code === "40001" || code === "23505") return 409;
  if (code === "42501") return 403;
  if (code === "22023" || code === "23514" || code === "22P02") return 422;
  return 500;
}

function firstRow(data: unknown) {
  return Array.isArray(data) ? data[0] ?? null : data;
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function POST(request: NextRequest) {
  const auth = await requireTenantContext({ roles: ["admin", "hr_admin"], feature: "assets" }, request);
  if ("error" in auth) return auth.error;
  const body = await request.json().catch(() => ({}));
  const mode = String((body as Record<string, unknown>).mode || "assignment");
  const admin = auth.admin as unknown as RpcClient;

  if (mode === "inventory") {
    const parsed = inventorySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ message: parsed.error.issues[0]?.message || "Asset inventory data is invalid.", requestId: auth.requestId }, { status: 400 });
    }
    const result = await admin.rpc("create_asset_inventory", {
      p_org_id: auth.orgId,
      p_actor_user_id: auth.user.id,
      p_request_id: auth.requestId,
      p_command_id: parsed.data.command_id,
      p_inventory_id: parsed.data.inventory_id,
      p_payload: {
        asset_name: parsed.data.asset_name,
        asset_type: parsed.data.asset_type,
        serial_number: parsed.data.serial_number,
        office_location_id: parsed.data.office_location_id || null,
        purchase_date: parsed.data.purchase_date || null,
        purchase_price: parsed.data.purchase_price,
        paid_immediately: parsed.data.paid_immediately,
        useful_life_months: parsed.data.useful_life_months,
        salvage_value: parsed.data.salvage_value,
        notes: parsed.data.notes || null,
      },
    });
    if (result.error) {
      return NextResponse.json({ message: result.error.message, requestId: auth.requestId }, { status: statusFor(result.error.code) });
    }
    return NextResponse.json({ data: firstRow(result.data), requestId: auth.requestId }, { status: 201 });
  }

  const parsed = assignmentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ message: "Asset assignment data is invalid.", requestId: auth.requestId }, { status: 400 });
  }
  const result = await admin.rpc("assign_asset_inventory", {
    p_org_id: auth.orgId,
    p_actor_user_id: auth.user.id,
    p_request_id: auth.requestId,
    p_command_id: parsed.data.command_id,
    p_assignment_id: parsed.data.assignment_id,
    p_inventory_id: parsed.data.inventory_id,
    p_employee_id: parsed.data.employee_id,
    p_notes: parsed.data.notes || null,
  });
  if (result.error) {
    return NextResponse.json({ message: result.error.message, requestId: auth.requestId }, { status: statusFor(result.error.code) });
  }
  return NextResponse.json({ data: firstRow(result.data), requestId: auth.requestId }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const auth = await requireTenantContext({ feature: "assets" }, request);
  if ("error" in auth) return auth.error;
  const body = await request.json().catch(() => ({}));
  const admin = auth.admin as unknown as RpcClient;

  if ((body as Record<string, unknown>).status) {
    if (!(["admin", "hr_admin"] as string[]).includes(auth.role)) {
      return NextResponse.json({ message: "Asset status changes are restricted to HR.", requestId: auth.requestId }, { status: 403 });
    }
    const parsed = transitionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ message: "Asset transition data is invalid.", requestId: auth.requestId }, { status: 400 });
    }
    const result = await admin.rpc("transition_asset_assignment", {
      p_org_id: auth.orgId,
      p_actor_user_id: auth.user.id,
      p_request_id: auth.requestId,
      p_command_id: parsed.data.command_id,
      p_assignment_id: parsed.data.id,
      p_expected_version: parsed.data.expected_version,
      p_target_status: parsed.data.status,
    });
    if (result.error) {
      return NextResponse.json({ message: result.error.message, requestId: auth.requestId }, { status: statusFor(result.error.code) });
    }
    return NextResponse.json({ data: firstRow(result.data), requestId: auth.requestId });
  }

  const parsed = acknowledgementSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ message: "Signed consent and the current asset version are required.", requestId: auth.requestId }, { status: 400 });
  }
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const result = await admin.rpc("acknowledge_asset_assignment", {
    p_org_id: auth.orgId,
    p_actor_user_id: auth.user.id,
    p_request_id: auth.requestId,
    p_command_id: parsed.data.command_id,
    p_assignment_id: parsed.data.id,
    p_expected_version: parsed.data.expected_version,
    p_signature_name: parsed.data.signature_data,
    p_evidence: {
      consent: true,
      terms_version: "asset-custody-v1",
      user_agent: (request.headers.get("user-agent") || "unknown").slice(0, 500),
      ip_hash: await sha256(`${auth.orgId}:${forwarded}`),
      request_id: auth.requestId,
    },
  });
  if (result.error) {
    return NextResponse.json({ message: result.error.message, requestId: auth.requestId }, { status: statusFor(result.error.code) });
  }
  return NextResponse.json({ data: firstRow(result.data), requestId: auth.requestId });
}
