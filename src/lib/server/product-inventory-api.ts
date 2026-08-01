import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { createAdminClient } from "@/lib/supabase/admin";

export function productInventoryDb(admin: ReturnType<typeof createAdminClient>) {
  // Supabase's generated map has not yet been regenerated for the Phase 1 tables.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return admin as any;
}

export function productInventoryPage(
  request: NextRequest,
  options: { defaultPageSize?: number; maxPageSize?: number } = {}
) {
  const defaultPageSize = options.defaultPageSize ?? 50;
  const maxPageSize = options.maxPageSize ?? 200;
  const requestedPage = Number(request.nextUrl.searchParams.get("page") || 1);
  const requestedPageSize = Number(
    request.nextUrl.searchParams.get("page_size") || defaultPageSize
  );
  const page = Number.isFinite(requestedPage)
    ? Math.max(1, Math.trunc(requestedPage))
    : 1;
  const pageSize = Number.isFinite(requestedPageSize)
    ? Math.min(Math.max(1, Math.trunc(requestedPageSize)), maxPageSize)
    : defaultPageSize;
  return {
    page,
    pageSize,
    from: (page - 1) * pageSize,
    to: page * pageSize - 1,
  };
}

export function productInventoryPagination(
  page: number,
  pageSize: number,
  total: number
) {
  return {
    page,
    page_size: pageSize,
    total,
    total_pages: Math.max(1, Math.ceil(total / pageSize)),
  };
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

export async function executeProductCommercialTermsCommand(
  admin: ReturnType<typeof createAdminClient>,
  values: {
    orgId: string;
    actorUserId: string;
    requestId: string;
    commandId: string;
    receiptId: string;
    expectedVersion: number;
    terms: Array<Record<string, unknown>>;
  }
) {
  const { data, error } = await productInventoryDb(admin).rpc(
    "execute_product_inventory_set_commercial_terms",
    {
      p_org_id: values.orgId,
      p_actor_user_id: values.actorUserId,
      p_request_id: values.requestId,
      p_command_id: values.commandId,
      p_receipt_id: values.receiptId,
      p_expected_version: values.expectedVersion,
      p_terms: values.terms,
    }
  );
  if (error) throw Object.assign(new Error(error.message), { code: error.code });
  const result = data as { receipt?: Record<string, unknown>; terms?: Array<Record<string, unknown>> } | null;
  if (!result?.receipt) throw new Error("The commercial terms command returned no receipt.");
  return result;
}

export async function applyCommercialTermsFromImportedRows(
  admin: ReturnType<typeof createAdminClient>,
  values: {
    orgId: string;
    actorUserId: string;
    requestId: string;
    commandId: string;
    receiptId: string;
    expectedVersion: number;
    source: "workbook_proposal" | "photo_proposal";
    rows: Array<{
      product_id: string;
      unit_cost: number | null;
      planned_sale_price: number | null;
      minimum_sale_price?: number | null;
      maximum_sale_price?: number | null;
      currency: string;
      condition: string;
      commission_type?: "none" | "flat" | "percentage";
      commission_value?: number | null;
      commission_base?: "net_amount" | "gross_amount";
    }>;
  }
) {
  const { data: lines, error } = await productInventoryDb(admin)
    .from("product_receipt_lines")
    .select("id, product_id, unit_cost, planned_unit_sale_price, currency, condition")
    .eq("organization_id", values.orgId)
    .eq("receipt_id", values.receiptId)
    .order("line_no");
  if (error) throw Object.assign(new Error(error.message), { code: error.code });
  const key = (row: {
    product_id: string;
    unit_cost: number | null;
    planned_sale_price: number | null;
    currency: string;
    condition: string;
  }) => [
    row.product_id,
    Number(row.unit_cost).toFixed(2),
    Number(row.planned_sale_price).toFixed(2),
    row.currency,
    row.condition,
  ].join("|");
  const grouped = new Map<string, typeof values.rows>();
  for (const row of values.rows) {
    const groupKey = key(row);
    grouped.set(groupKey, [...(grouped.get(groupKey) ?? []), row]);
  }
  const terms = (lines ?? []).map((line: Record<string, unknown>) => {
    const candidates = grouped.get(key({
      product_id: String(line.product_id),
      unit_cost: Number(line.unit_cost),
      planned_sale_price: Number(line.planned_unit_sale_price),
      currency: String(line.currency),
      condition: String(line.condition),
    })) ?? [];
    const proposal = candidates[0];
    if (!proposal || proposal.planned_sale_price === null) {
      throw Object.assign(new Error("تعذر مطابقة صفوف الاستيراد مع مجموعات التسعير."), { code: "23514" });
    }
    const signature = (row: typeof proposal) => [
      row.minimum_sale_price ?? row.planned_sale_price,
      row.maximum_sale_price ?? row.planned_sale_price,
      row.commission_type ?? "none",
      row.commission_value ?? 0,
      row.commission_base ?? "net_amount",
    ].join("|");
    if (candidates.some((candidate) => signature(candidate) !== signature(proposal))) {
      throw Object.assign(new Error("يجب توحيد السعر والعمولة للصفوف التي ستندمج في مجموعة واحدة."), { code: "23514" });
    }
    return {
      receipt_line_id: String(line.id),
      sale_price: proposal.planned_sale_price,
      minimum_sale_price: proposal.minimum_sale_price ?? proposal.planned_sale_price,
      maximum_sale_price: proposal.maximum_sale_price ?? proposal.planned_sale_price,
      currency: proposal.currency,
      commission_type: proposal.commission_type ?? "none",
      commission_value: proposal.commission_value ?? 0,
      commission_base: proposal.commission_base ?? "net_amount",
      source: values.source,
    };
  });
  return executeProductCommercialTermsCommand(admin, { ...values, terms });
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
