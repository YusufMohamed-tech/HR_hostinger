import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireSalesAccess } from "@/lib/server/sales-auth";

type RpcResult = { data: unknown; error: { message: string; code?: string } | null };
type RpcClient = { rpc: (name: string, args: Record<string, unknown>) => Promise<RpcResult> };

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function isActiveAssignment(assignment: Record<string, unknown>) {
  if (assignment.is_active === false) return false;
  const today = todayIso();
  const start = String(assignment.start_date || today);
  const end = assignment.end_date ? String(assignment.end_date) : "";
  return start <= today && (!end || end >= today);
}

async function getManagerScopedCompanyIds(admin: ReturnType<typeof createAdminClient>, auth: { orgId: string; user: { id: string }; role: string }) {
  if (["admin", "hr_admin"].includes(auth.role)) return null;
  const result = await admin
    .from("sales_company_assignments")
    .select("company_id, assignment_role, start_date, end_date, is_active")
    .eq("organization_id", auth.orgId)
    .eq("user_id", auth.user.id)
    .eq("assignment_role", "manager")
    .eq("is_active", true);
  if (result.error) throw result.error;
  return ((result.data ?? []) as Record<string, unknown>[])
    .filter(isActiveAssignment)
    .map((assignment) => String(assignment.company_id))
    .filter(Boolean);
}

export async function POST(request: NextRequest) {
  const auth = await requireSalesAccess(undefined, request);
  if ("error" in auth) return auth.error;
  if (auth.role !== "sales" && auth.role !== "sales_manager") {
    return NextResponse.json({ message: "طلبات تعديل المبيعات متاحة للبائعين فقط." }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const salesLogId = String(body.sales_log_id || "").trim();
  const requestedChanges = String(body.requested_changes || "").trim();
  if (!salesLogId || requestedChanges.length < 3) {
    return NextResponse.json({ message: "اكتب التعديل المطلوب بوضوح." }, { status: 400 });
  }

  const admin = createAdminClient();
  const logResult = await admin
    .from("sales_logs")
    .select("id, organization_id, company_id, sales_agent_id, log_date, grand_total, company:company_id(name)")
    .eq("id", salesLogId)
    .eq("organization_id", auth.orgId)
    .maybeSingle();

  if (logResult.error) return NextResponse.json({ message: logResult.error.message }, { status: 500 });
  const log = logResult.data as Record<string, unknown> | null;
  if (!log) return NextResponse.json({ message: "تقرير المبيعات غير موجود." }, { status: 404 });
  if (String(log.sales_agent_id || "") !== auth.user.id) {
    return NextResponse.json({ message: "يمكنك طلب تعديل تقاريرك فقط." }, { status: 403 });
  }

  const companyId = String(log.company_id || "");
  if (companyId) {
    const assignmentResult = await admin
      .from("sales_company_assignments")
      .select("company_id, start_date, end_date, is_active")
      .eq("organization_id", auth.orgId)
      .eq("user_id", auth.user.id)
      .eq("company_id", companyId)
      .eq("is_active", true);
    if (assignmentResult.error) return NextResponse.json({ message: assignmentResult.error.message }, { status: 500 });
    const hasAssignment = ((assignmentResult.data ?? []) as Record<string, unknown>[]).some(isActiveAssignment);
    if (!hasAssignment) return NextResponse.json({ message: "هذا التقرير غير مرتبط بشركة مسندة لك حالياً." }, { status: 403 });
  }

  const command = await (admin as unknown as RpcClient).rpc("submit_sales_log_edit_request", {
    p_org_id: auth.orgId,
    p_actor_user_id: auth.user.id,
    p_command_id: String(body.command_id || request.headers.get("idempotency-key") || crypto.randomUUID()),
    p_request_id: auth.requestId,
    p_sales_log_id: salesLogId,
    p_requested_changes: requestedChanges,
  });
  if (command.error) {
    const code = command.error.code || "";
    const responseStatus = code === "42501" ? 403 : code === "P0002" ? 404
      : ["23505", "40001", "55000"].includes(code) ? 409
        : ["22023", "23514"].includes(code) ? 400 : 500;
    return NextResponse.json({ message: command.error.message, requestId: auth.requestId }, { status: responseStatus });
  }
  return NextResponse.json({ data: Array.isArray(command.data) ? command.data[0] : command.data, requestId: auth.requestId }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const auth = await requireSalesAccess({ managerOnly: true }, request);
  if ("error" in auth) return auth.error;

  const body = await request.json().catch(() => ({}));
  const editRequestId = String(body.id || "").trim();
  const status = String(body.status || "").trim();
  const resolutionNote = String(body.resolution_note || "").trim();
  const notes = String(body.notes || "").trim();
  const requestedItems = Array.isArray(body.items) ? body.items as Record<string, unknown>[] : [];

  if (!editRequestId || !["applied", "rejected"].includes(status)) {
    return NextResponse.json({ message: "قرار طلب التعديل غير صحيح." }, { status: 400 });
  }

  const admin = createAdminClient();
  const editRequestResult = await admin
    .from("sales_log_edit_requests")
    .select("*")
    .eq("id", editRequestId)
    .eq("organization_id", auth.orgId)
    .maybeSingle();

  if (editRequestResult.error) return NextResponse.json({ message: editRequestResult.error.message }, { status: 500 });
  const editRequest = editRequestResult.data as Record<string, unknown> | null;
  if (!editRequest) return NextResponse.json({ message: "طلب التعديل غير موجود." }, { status: 404 });
  if (String(editRequest.status || "") !== "pending") {
    return NextResponse.json({ message: "تمت مراجعة هذا الطلب من قبل." }, { status: 409 });
  }

  const companyId = String(editRequest.company_id || "");
  const scopedCompanyIds = await getManagerScopedCompanyIds(admin, auth);
  if (Array.isArray(scopedCompanyIds) && (!companyId || !scopedCompanyIds.includes(companyId))) {
    return NextResponse.json({ message: "ليس لديك صلاحية مراجعة طلبات هذه الشركة." }, { status: 403 });
  }

  const logResult = await admin
    .from("sales_logs")
    .select("id, organization_id, company_id, sales_agent_id, log_date, version")
    .eq("id", String(editRequest.sales_log_id || ""))
    .eq("organization_id", auth.orgId)
    .maybeSingle();

  if (logResult.error) return NextResponse.json({ message: logResult.error.message }, { status: 500 });
  const log = logResult.data as Record<string, unknown> | null;
  if (!log) return NextResponse.json({ message: "تقرير المبيعات غير موجود." }, { status: 404 });

  if (status === "applied" && requestedItems.length === 0) {
    return NextResponse.json({ message: "أضف منتجاً واحداً على الأقل قبل تطبيق التعديل." }, { status: 400 });
  }
  const command = await (admin as unknown as RpcClient).rpc("resolve_sales_log_edit", {
    p_org_id: auth.orgId,
    p_actor_user_id: auth.user.id,
    p_command_id: String(body.command_id || request.headers.get("idempotency-key") || crypto.randomUUID()),
    p_request_id: auth.requestId,
    p_edit_request_id: editRequestId,
    p_expected_version: Number(log.version),
    p_decision: status,
    p_items: status === "applied" ? requestedItems : [],
    p_notes: notes || null,
    p_resolution_note: resolutionNote || null,
  });
  if (command.error) {
    const code = command.error.code || "";
    const responseStatus = code === "42501" ? 403 : code === "P0002" ? 404
      : ["23505", "40001", "55000"].includes(code) ? 409
        : ["22023", "23514"].includes(code) ? 400 : 500;
    return NextResponse.json({ message: command.error.message, requestId: auth.requestId }, { status: responseStatus });
  }
  const resolvedRequest = Array.isArray(command.data) ? command.data[0] : command.data;

  return NextResponse.json({ data: resolvedRequest, requestId: auth.requestId });
}
