import { NextResponse } from "next/server";
import type { createAdminClient } from "@/lib/supabase/admin";

export function productInventoryDb(admin: ReturnType<typeof createAdminClient>) {
  // Supabase's generated map has not yet been regenerated for the Phase 1 tables.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return admin as any;
}

export function productInventoryError(error: unknown, fallback = "تعذر تنفيذ عملية مخزون المنتجات.") {
  const code = error && typeof error === "object" && "code" in error
    ? String((error as { code?: unknown }).code || "")
    : "";
  const status = code === "42501"
    ? 403
    : code === "P0002"
      ? 404
      : ["23505", "40001", "55000"].includes(code)
        ? 409
        : ["22023", "23514", "22P02"].includes(code)
          ? 400
          : 500;
  const message = error instanceof Error
    ? error.message
    : error && typeof error === "object" && "message" in error
      ? String((error as { message?: unknown }).message || fallback)
      : fallback;
  return NextResponse.json({ message }, { status });
}

export async function executeReceiptCommand(
  admin: ReturnType<typeof createAdminClient>,
  values: {
    orgId: string;
    actorUserId: string;
    requestId: string;
    commandId: string;
    action: "receipt_draft_save" | "receipt_confirm" | "receipt_cancel";
    payload: Record<string, unknown>;
  }
) {
  const { data, error } = await productInventoryDb(admin).rpc(
    "execute_product_receipt_command",
    {
      p_org_id: values.orgId,
      p_actor_user_id: values.actorUserId,
      p_request_id: values.requestId,
      p_command_id: values.commandId,
      p_action: values.action,
      p_payload: values.payload,
    }
  );
  if (error) throw Object.assign(new Error(error.message), { code: error.code });
  const result = data as { receipt?: Record<string, unknown> } | null;
  if (!result?.receipt) throw new Error("The product receipt command returned no receipt.");
  return result.receipt;
}

export async function executeProductCommerceCommand(
  admin: ReturnType<typeof createAdminClient>,
  values: {
    orgId: string;
    actorUserId: string;
    requestId: string;
    commandId: string;
    action:
      | "handover_issue"
      | "handover_accept"
      | "agent_return"
      | "price_override_request"
      | "price_override_review"
      | "sale"
      | "sale_void"
      | "collection_post";
    payload: Record<string, unknown>;
  }
) {
  const { data, error } = await productInventoryDb(admin).rpc(
    "execute_product_commerce_command",
    {
      p_org_id: values.orgId,
      p_actor_user_id: values.actorUserId,
      p_request_id: values.requestId,
      p_command_id: values.commandId,
      p_action: values.action,
      p_payload: values.payload,
    }
  );
  if (error) throw Object.assign(new Error(error.message), { code: error.code });
  if (!data || typeof data !== "object") {
    throw new Error("The product commerce command returned no result.");
  }
  return data as Record<string, unknown>;
}

export async function executeProductInventoryLossCommand(
  admin: ReturnType<typeof createAdminClient>,
  values: {
    orgId: string;
    actorUserId: string;
    requestId: string;
    commandId: string;
    payload: Record<string, unknown>;
  }
) {
  const { data, error } = await productInventoryDb(admin).rpc(
    "execute_product_inventory_loss_command",
    {
      p_org_id: values.orgId,
      p_actor_user_id: values.actorUserId,
      p_request_id: values.requestId,
      p_command_id: values.commandId,
      p_payload: values.payload,
    }
  );
  if (error) throw Object.assign(new Error(error.message), { code: error.code });
  if (!data || typeof data !== "object") {
    throw new Error("The product inventory loss command returned no result.");
  }
  return data as Record<string, unknown>;
}
