import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireSalesAccess } from "@/lib/server/sales-auth";

type RpcResult = { data: unknown; error: { message: string; code?: string } | null };
type RpcClient = { rpc: (name: string, args: Record<string, unknown>) => Promise<RpcResult> };

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function toNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function rpcStatus(code?: string) {
  if (code === "42501") return 403;
  if (code === "P0002") return 404;
  if (["23505", "40001", "55000"].includes(code || "")) return 409;
  if (["22023", "23514"].includes(code || "")) return 400;
  return 500;
}

function isActiveAssignment(assignment: Record<string, unknown>) {
  if (assignment.is_active === false) return false;
  const today = todayIso();
  const start = String(assignment.start_date || today);
  const end = assignment.end_date ? String(assignment.end_date) : "";
  return start <= today && (!end || end >= today);
}

async function getAssignedCompanyIds(admin: ReturnType<typeof createAdminClient>, auth: { orgId: string; user: { id: string }; role: string }) {
  if (["admin", "hr_admin"].includes(auth.role)) {
    const result = await admin.from("sales_companies").select("id").eq("organization_id", auth.orgId).eq("is_active", true);
    if (result.error) throw result.error;
    return ((result.data ?? []) as Record<string, unknown>[]).map((company) => String(company.id));
  }

  const result = await admin
    .from("sales_company_assignments")
    .select("company_id, assignment_role, start_date, end_date, is_active")
    .eq("organization_id", auth.orgId)
    .eq("user_id", auth.user.id)
    .eq("is_active", true);
  if (result.error) throw result.error;
  return ((result.data ?? []) as Record<string, unknown>[])
    .filter(isActiveAssignment)
    .map((assignment) => String(assignment.company_id))
    .filter(Boolean);
}

export async function GET(request: NextRequest) {
  const auth = await requireSalesAccess(undefined, request);
  if ("error" in auth) return auth.error;

  const admin = createAdminClient();
  const today = todayIso();
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const assignedCompanyIds = await getAssignedCompanyIds(admin, auth);
  const requestedCompanyId = String(request.nextUrl.searchParams.get("company_id") || "").trim();
  const selectedCompanyId = assignedCompanyIds.includes(requestedCompanyId)
    ? requestedCompanyId
    : assignedCompanyIds[0] || "";

  if (!selectedCompanyId) {
    return NextResponse.json({
      data: { companies: [], selectedCompanyId: "", products: [], todayLogs: [], todayLog: null, yesterdayItems: [], soldFrequency: {} },
    });
  }

  const [companiesResult, productsResult, todayResult, historyResult, yesterdayResult] = await Promise.all([
    admin
      .from("sales_companies")
      .select("*")
      .eq("organization_id", auth.orgId)
      .in("id", assignedCompanyIds)
      .order("name", { ascending: true }),
    admin
      .from("sales_products")
      .select("*")
      .eq("organization_id", auth.orgId)
      .eq("company_id", selectedCompanyId)
      .eq("is_active", true)
      .order("name", { ascending: true }),
    admin
      .from("sales_logs")
      .select("*, company:company_id(name, code, brand_color), edit_requests:sales_log_edit_requests(id, requested_changes, status, created_at, resolved_at, resolution_note)")
      .eq("organization_id", auth.orgId)
      .eq("sales_agent_id", auth.user.id)
      .eq("company_id", selectedCompanyId)
      .eq("log_date", today)
      .order("created_at", { ascending: false }),
    admin
      .from("sales_logs")
      .select("items")
      .eq("organization_id", auth.orgId)
      .eq("sales_agent_id", auth.user.id)
      .eq("company_id", selectedCompanyId)
      .order("log_date", { ascending: false })
      .limit(30),
    admin
      .from("sales_logs")
      .select("items")
      .eq("organization_id", auth.orgId)
      .eq("sales_agent_id", auth.user.id)
      .eq("company_id", selectedCompanyId)
      .eq("log_date", yesterday)
      .order("created_at", { ascending: false })
      .limit(1),
  ]);

  if (companiesResult.error) return NextResponse.json({ message: companiesResult.error.message }, { status: 500 });
  if (productsResult.error) return NextResponse.json({ message: productsResult.error.message }, { status: 500 });
  if (todayResult.error) return NextResponse.json({ message: todayResult.error.message }, { status: 500 });
  if (historyResult.error) return NextResponse.json({ message: historyResult.error.message }, { status: 500 });
  if (yesterdayResult.error) return NextResponse.json({ message: yesterdayResult.error.message }, { status: 500 });

  const frequency: Record<string, number> = {};
  for (const log of (historyResult.data ?? []) as Record<string, unknown>[]) {
    const items = Array.isArray(log.items) ? log.items as Record<string, unknown>[] : [];
    for (const item of items) {
      const productId = String(item.product_id || "");
      if (productId) frequency[productId] = (frequency[productId] || 0) + toNumber(item.quantity);
    }
  }

  const products = [...((productsResult.data ?? []) as Record<string, unknown>[])].sort((a, b) => {
    const byFrequency = (frequency[String(b.id)] || 0) - (frequency[String(a.id)] || 0);
    if (byFrequency !== 0) return byFrequency;
    return String(a.name || "").localeCompare(String(b.name || ""), "ar");
  });

  const yesterdayRecord = ((yesterdayResult.data ?? []) as Record<string, unknown>[])[0] || null;
  const yesterdayItems = Array.isArray(yesterdayRecord?.items) ? yesterdayRecord.items : [];
  const todayLogs = (todayResult.data ?? []) as Record<string, unknown>[];

  return NextResponse.json({
    data: {
      companies: companiesResult.data ?? [],
      selectedCompanyId,
      products,
      todayLogs,
      todayLog: todayLogs[0] ?? null,
      yesterdayItems,
      soldFrequency: frequency,
    },
  });
}

export async function POST(request: NextRequest) {
  const auth = await requireSalesAccess(undefined, request);
  if ("error" in auth) return auth.error;
  if (auth.role !== "sales" && auth.role !== "sales_manager") {
    return NextResponse.json({ message: "تسجيل المبيعات متاح للبائعين فقط." }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const companyId = String(body.company_id || "").trim();
  const requestedItems = Array.isArray(body.items) ? body.items as Record<string, unknown>[] : [];
  const notes = String(body.notes || "").trim();
  const admin = createAdminClient();
  const assignedCompanyIds = await getAssignedCompanyIds(admin, auth);
  if (!companyId || !assignedCompanyIds.includes(companyId)) {
    return NextResponse.json({ message: "اختر شركة مبيعات مسندة إليك." }, { status: 400 });
  }

  const commandId = String(body.command_id || request.headers.get("idempotency-key") || crypto.randomUUID());
  const logResult = await (admin as unknown as RpcClient).rpc("submit_sales_log", {
    p_org_id: auth.orgId,
    p_actor_user_id: auth.user.id,
    p_command_id: commandId,
    p_request_id: auth.requestId,
    p_company_id: companyId,
    p_items: requestedItems,
    p_notes: notes || null,
  });
  if (logResult.error) {
    return NextResponse.json({ message: logResult.error.message, requestId: auth.requestId }, { status: rpcStatus(logResult.error.code) });
  }
  const log = (Array.isArray(logResult.data) ? logResult.data[0] : logResult.data) as Record<string, unknown> | null;
  if (!log) return NextResponse.json({ message: "لم يتم إنشاء تقرير المبيعات.", requestId: auth.requestId }, { status: 500 });
  return NextResponse.json({ data: log, requestId: auth.requestId }, { status: 201 });
}

export async function DELETE(request: NextRequest) {
  const auth = await requireSalesAccess({ managerOnly: true }, request);
  if ("error" in auth) return auth.error;
  const body = await request.json().catch(() => ({}));
  const salesLogId = String(body.sales_log_id || body.id || "").trim();
  const expectedVersion = Number(body.expected_version);
  const reason = String(body.reason || "").trim();
  if (!salesLogId || !Number.isInteger(expectedVersion) || expectedVersion < 1 || reason.length < 5) {
    return NextResponse.json({ message: "معرف السجل والإصدار وسبب إلغاء واضح مطلوبة." }, { status: 400 });
  }
  const result = await (createAdminClient() as unknown as RpcClient).rpc("void_sales_log", {
    p_org_id: auth.orgId,
    p_actor_user_id: auth.user.id,
    p_command_id: String(body.command_id || request.headers.get("idempotency-key") || crypto.randomUUID()),
    p_request_id: auth.requestId,
    p_sales_log_id: salesLogId,
    p_expected_version: expectedVersion,
    p_reason: reason,
  });
  if (result.error) {
    return NextResponse.json({ message: result.error.message, requestId: auth.requestId }, { status: rpcStatus(result.error.code) });
  }
  return NextResponse.json({ data: Array.isArray(result.data) ? result.data[0] : result.data, requestId: auth.requestId });
}
