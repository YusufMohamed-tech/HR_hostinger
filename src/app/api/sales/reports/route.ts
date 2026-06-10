import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireSalesAccess } from "@/lib/server/sales-auth";

function dateOrEmpty(value: string | null) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

function itemArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value as Record<string, unknown>[] : [];
}

function isActiveAssignment(assignment: Record<string, unknown>) {
  if (assignment.is_active === false) return false;
  const today = new Date().toISOString().slice(0, 10);
  const start = String(assignment.start_date || today);
  const end = assignment.end_date ? String(assignment.end_date) : "";
  return start <= today && (!end || end >= today);
}

async function getScopedCompanyIds(admin: ReturnType<typeof createAdminClient>, auth: { orgId: string; user: { id: string }; role: string }) {
  if (["admin", "hr_admin"].includes(auth.role)) return null;
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
  const auth = await requireSalesAccess();
  if ("error" in auth) return auth.error;

  const search = request.nextUrl.searchParams;
  const scope = search.get("scope") || "";
  const agent = String(search.get("agent") || "").trim();
  const product = String(search.get("product") || "").trim();
  const company = String(search.get("company") || search.get("company_id") || "").trim();
  const status = String(search.get("status") || "").trim();
  const dateFrom = dateOrEmpty(search.get("date_from"));
  const dateTo = dateOrEmpty(search.get("date_to"));

  const managerView = auth.isManager && scope !== "mine";
  const admin = createAdminClient();
  const scopedCompanyIds = await getScopedCompanyIds(admin, auth);

  let query = admin
    .from("sales_logs")
    .select("*, agent:sales_agent_id(full_name, email), company:company_id(name, code, brand_color), edit_requests:sales_log_edit_requests(id, requested_changes, status, created_at, resolved_at, resolution_note)")
    .eq("organization_id", auth.orgId)
    .order("log_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (!managerView) query = query.eq("sales_agent_id", auth.user.id);
  if (managerView && agent) query = query.eq("sales_agent_id", agent);
  if (company) query = query.eq("company_id", company);
  if (Array.isArray(scopedCompanyIds)) {
    if (scopedCompanyIds.length === 0) {
      return NextResponse.json({ data: { logs: [], agents: [], products: [], companies: [], summary: { totalRevenue: 0, totalDiscount: 0, transactionCount: 0, topProduct: null } } });
    }
    query = query.in("company_id", scopedCompanyIds);
  }
  if (status && status !== "all") query = query.eq("status", status);
  if (dateFrom) query = query.gte("log_date", dateFrom);
  if (dateTo) query = query.lte("log_date", dateTo);

  const logsResult = await query;
  if (logsResult.error) return NextResponse.json({ message: logsResult.error.message }, { status: 500 });

  let logs = (logsResult.data ?? []) as Record<string, unknown>[];
  if (product) {
    logs = logs.filter((log) => itemArray(log.items).some((item) => String(item.product_id || "") === product));
  }

  const [membersResult, profilesResult, productsResult, companiesResult, assignmentsResult] = await Promise.all([
    admin.from("org_members").select("user_id, role, org_id").eq("org_id", auth.orgId).in("role", ["sales", "sales_manager"]),
    admin.from("profiles").select("user_id, full_name, email, phone, account_status").eq("org_id", auth.orgId),
    admin.from("sales_products").select("*").eq("organization_id", auth.orgId).order("name", { ascending: true }),
    admin.from("sales_companies").select("*").eq("organization_id", auth.orgId).eq("is_active", true).order("name", { ascending: true }),
    admin.from("sales_company_assignments").select("user_id, company_id, assignment_role, start_date, end_date, is_active").eq("organization_id", auth.orgId),
  ]);

  if (membersResult.error) return NextResponse.json({ message: membersResult.error.message }, { status: 500 });
  if (profilesResult.error) return NextResponse.json({ message: profilesResult.error.message }, { status: 500 });
  if (productsResult.error) return NextResponse.json({ message: productsResult.error.message }, { status: 500 });
  if (companiesResult.error) return NextResponse.json({ message: companiesResult.error.message }, { status: 500 });
  if (assignmentsResult.error) return NextResponse.json({ message: assignmentsResult.error.message }, { status: 500 });

  const allowedCompanySet = Array.isArray(scopedCompanyIds) ? new Set(scopedCompanyIds) : null;
  const products = ((productsResult.data ?? []) as Record<string, unknown>[]).filter((productRecord) => {
    return !allowedCompanySet || allowedCompanySet.has(String(productRecord.company_id || ""));
  });
  const companies = ((companiesResult.data ?? []) as Record<string, unknown>[]).filter((companyRecord) => {
    return !allowedCompanySet || allowedCompanySet.has(String(companyRecord.id || ""));
  });

  const profiles = new Map(((profilesResult.data ?? []) as Record<string, unknown>[]).map((profile) => [String(profile.user_id), profile]));
  const assignmentsByUser = new Map<string, Record<string, unknown>[]>();
  for (const assignment of (assignmentsResult.data ?? []) as Record<string, unknown>[]) {
    const userId = String(assignment.user_id || "");
    const list = assignmentsByUser.get(userId) || [];
    list.push(assignment);
    assignmentsByUser.set(userId, list);
  }
  const agents = ((membersResult.data ?? []) as Record<string, unknown>[]).map((member) => {
    const userId = String(member.user_id || "");
    const profile = profiles.get(userId) || {};
    return {
      user_id: userId,
      org_id: String(member.org_id || ""),
      role: String(member.role || ""),
      full_name: String(profile.full_name || profile.email || "بائع"),
      email: String(profile.email || ""),
      phone: typeof profile.phone === "string" ? profile.phone : null,
      status: String(profile.account_status || "active"),
      company_assignments: assignmentsByUser.get(userId) || [],
    };
  });

  const totalRevenue = logs.reduce((sum, log) => sum + Number(log.grand_total || 0), 0);
  const totalDiscount = logs.reduce((sum, log) => sum + Number(log.total_discount || 0), 0);
  const productTotals = new Map<string, { name: string; quantity: number; total: number }>();
  for (const log of logs) {
    for (const item of itemArray(log.items)) {
      const id = String(item.product_id || item.product_name || "");
      const current = productTotals.get(id) || { name: String(item.product_name || "منتج"), quantity: 0, total: 0 };
      current.quantity += Number(item.quantity || 0);
      current.total += Number(item.line_total || 0);
      productTotals.set(id, current);
    }
  }
  const topProduct = Array.from(productTotals.values()).sort((a, b) => b.total - a.total)[0] || null;

  return NextResponse.json({
    data: {
      logs,
      agents,
      products,
      companies,
      summary: {
        totalRevenue,
        totalDiscount,
        transactionCount: logs.length,
        topProduct,
      },
    },
  });
}
