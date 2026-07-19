import { NextRequest, NextResponse } from "next/server";
import { requireSalesAccess } from "@/lib/server/sales-auth";

type DbResult = { data: unknown; error: { message: string; code?: string } | null };
type QueryBuilder = {
  select: (columns: string) => QueryBuilder;
  eq: (column: string, value: unknown) => QueryBuilder;
  order: (column: string, options?: Record<string, unknown>) => QueryBuilder;
  then: PromiseLike<DbResult>["then"];
};

function database(admin: unknown) {
  return admin as {
    from: (table: string) => QueryBuilder;
    rpc: (name: string, args: Record<string, unknown>) => Promise<DbResult>;
  };
}

export async function GET(request: NextRequest) {
  const auth = await requireSalesAccess({ managerOnly: true }, request);
  if ("error" in auth) return auth.error;
  const result = await database(auth.admin).from("carrier_product_mappings")
    .select("*, product:sales_product_id(id, name, company_id, price, is_active)")
    .eq("organization_id", auth.orgId).order("updated_at", { ascending: false });
  if (result.error) return NextResponse.json({ message: result.error.message }, { status: 500 });
  return NextResponse.json({ data: result.data || [], requestId: auth.requestId });
}

export async function POST(request: NextRequest) {
  const auth = await requireSalesAccess({ managerOnly: true }, request);
  if ("error" in auth) return auth.error;
  const body = await request.json().catch(() => ({}));
  const productId = String(body.sales_product_id || "").trim();
  if (!productId) return NextResponse.json({ message: "sales_product_id is required." }, { status: 400 });
  const result = await database(auth.admin).rpc("save_carrier_product_mapping", {
    p_org_id: auth.orgId,
    p_actor_user_id: auth.user.id,
    p_request_id: auth.requestId,
    p_sales_product_id: productId,
    p_payload: {
      segment_brand: body.segment_brand,
      segment_group: body.segment_group,
      fpe_multiplier: body.fpe_multiplier ?? 1,
      ibr_source: body.ibr_source || "line_total",
      fixed_ibr_value: body.fixed_ibr_value ?? null,
      effective_from: body.effective_from || null,
      effective_to: body.effective_to || null,
      is_active: body.is_active !== false,
    },
  });
  if (result.error) {
    const code = result.error.code || "";
    const status = code === "42501" ? 403 : code === "P0002" ? 404
      : ["22023", "23514"].includes(code) ? 400 : 500;
    return NextResponse.json({ message: result.error.message, requestId: auth.requestId }, { status });
  }
  return NextResponse.json({ data: Array.isArray(result.data) ? result.data[0] : result.data, requestId: auth.requestId });
}

export async function DELETE(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  body.is_active = false;
  return POST(new NextRequest(request.url, {
    method: "POST",
    headers: request.headers,
    body: JSON.stringify(body),
  }));
}
