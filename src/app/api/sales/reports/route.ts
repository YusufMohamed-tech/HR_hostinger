import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireSalesAccess } from "@/lib/server/sales-auth";

function dateOrEmpty(value: string | null) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

function itemArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value as Record<string, unknown>[] : [];
}

export async function GET(request: NextRequest) {
  const auth = await requireSalesAccess();
  if ("error" in auth) return auth.error;

  const search = request.nextUrl.searchParams;
  const scope = search.get("scope") || "";
  const agent = String(search.get("agent") || "").trim();
  const product = String(search.get("product") || "").trim();
  const status = String(search.get("status") || "").trim();
  const dateFrom = dateOrEmpty(search.get("date_from"));
  const dateTo = dateOrEmpty(search.get("date_to"));

  const managerView = auth.isManager && scope !== "mine";
  const admin = createAdminClient();

  let query = admin
    .from("sales_logs")
    .select("*, agent:sales_agent_id(full_name, email)")
    .eq("organization_id", auth.orgId)
    .order("log_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (!managerView) query = query.eq("sales_agent_id", auth.user.id);
  if (managerView && agent) query = query.eq("sales_agent_id", agent);
  if (status && status !== "all") query = query.eq("status", status);
  if (dateFrom) query = query.gte("log_date", dateFrom);
  if (dateTo) query = query.lte("log_date", dateTo);

  const logsResult = await query;
  if (logsResult.error) return NextResponse.json({ message: logsResult.error.message }, { status: 500 });

  let logs = (logsResult.data ?? []) as Record<string, unknown>[];
  if (product) {
    logs = logs.filter((log) => itemArray(log.items).some((item) => String(item.product_id || "") === product));
  }

  const [membersResult, profilesResult, productsResult] = await Promise.all([
    admin.from("org_members").select("user_id, role, org_id").eq("org_id", auth.orgId).in("role", ["sales", "sales_manager"]),
    admin.from("profiles").select("user_id, full_name, email, phone, account_status").eq("org_id", auth.orgId),
    admin.from("sales_products").select("*").eq("organization_id", auth.orgId).order("name", { ascending: true }),
  ]);

  if (membersResult.error) return NextResponse.json({ message: membersResult.error.message }, { status: 500 });
  if (profilesResult.error) return NextResponse.json({ message: profilesResult.error.message }, { status: 500 });
  if (productsResult.error) return NextResponse.json({ message: productsResult.error.message }, { status: 500 });

  const profiles = new Map(((profilesResult.data ?? []) as Record<string, unknown>[]).map((profile) => [String(profile.user_id), profile]));
  const agents = ((membersResult.data ?? []) as Record<string, unknown>[]).map((member) => {
    const profile = profiles.get(String(member.user_id)) || {};
    return {
      user_id: String(member.user_id || ""),
      org_id: String(member.org_id || ""),
      role: String(member.role || ""),
      full_name: String(profile.full_name || profile.email || "بائع"),
      email: String(profile.email || ""),
      phone: typeof profile.phone === "string" ? profile.phone : null,
      status: String(profile.account_status || "active"),
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
      products: productsResult.data ?? [],
      summary: {
        totalRevenue,
        totalDiscount,
        transactionCount: logs.length,
        topProduct,
      },
    },
  });
}
