import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireSalesAccess } from "@/lib/server/sales-auth";
import { formatCurrency } from "@/lib/utils/currency";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function toNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value: number) {
  return formatCurrency(value);
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
  const auth = await requireSalesAccess();
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
      .select("*, company:company_id(name, code, brand_color)")
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
  const auth = await requireSalesAccess();
  if ("error" in auth) return auth.error;
  if (auth.role !== "sales" && auth.role !== "sales_manager") {
    return NextResponse.json({ message: "تسجيل المبيعات متاح للبائعين فقط." }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const companyId = String(body.company_id || "").trim();
  const requestedItems = Array.isArray(body.items) ? body.items as Record<string, unknown>[] : [];
  const notes = String(body.notes || "").trim();
  const today = todayIso();

  const admin = createAdminClient();
  const assignedCompanyIds = await getAssignedCompanyIds(admin, auth);
  if (!companyId || !assignedCompanyIds.includes(companyId)) {
    return NextResponse.json({ message: "اختر شركة مبيعات مسندة إليك." }, { status: 400 });
  }

  const productIds = Array.from(new Set(requestedItems.map((item) => String(item.product_id || "")).filter(Boolean)));
  if (productIds.length === 0) return NextResponse.json({ message: "اختر منتجًا واحدًا على الأقل." }, { status: 400 });

  const productsResult = await admin
    .from("sales_products")
    .select("id, name, price, is_active, company_id")
    .eq("organization_id", auth.orgId)
    .eq("company_id", companyId)
    .in("id", productIds);

  if (productsResult.error) return NextResponse.json({ message: productsResult.error.message }, { status: 500 });

  const products = new Map(((productsResult.data ?? []) as Record<string, unknown>[]).map((product) => [String(product.id), product]));
  let items: Array<Record<string, unknown>>;
  try {
    items = requestedItems.map((item) => {
      const productId = String(item.product_id || "");
      const product = products.get(productId);
      const quantity = Math.max(0, Math.floor(toNumber(item.quantity)));
      const discountPercent = toNumber(item.discount_percent);
      if (!product || product.is_active === false) throw new Error("يوجد منتج غير متاح في التقرير.");
      if (quantity <= 0) throw new Error("الكمية يجب أن تكون أكبر من صفر.");
      if (discountPercent < 0 || discountPercent > 100) throw new Error("نسبة الخصم يجب أن تكون بين 0 و100.");
      const unitPrice = toNumber(product.price);
      const gross = quantity * unitPrice;
      const discountAmount = Number((gross * discountPercent / 100).toFixed(2));
      return {
        product_id: productId,
        product_name: String(product.name || "منتج"),
        quantity,
        unit_price: unitPrice,
        discount_percent: discountPercent,
        discount_amount: discountAmount,
        line_total: Number((gross - discountAmount).toFixed(2)),
      };
    });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "بيانات المنتجات غير صحيحة." }, { status: 400 });
  }

  const subtotal = Number(items.reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.unit_price || 0), 0).toFixed(2));
  const totalDiscount = Number(items.reduce((sum, item) => sum + Number(item.discount_amount || 0), 0).toFixed(2));
  const grandTotal = Number(items.reduce((sum, item) => sum + Number(item.line_total || 0), 0).toFixed(2));

  const profileResult = await admin.from("profiles").select("full_name, email").eq("user_id", auth.user.id).maybeSingle();
  const agentName = String((profileResult.data as Record<string, unknown> | null)?.full_name || auth.user.email || "بائع");

  const logResult = await admin
    .from("sales_logs")
    .insert({
      organization_id: auth.orgId,
      company_id: companyId,
      sales_agent_id: auth.user.id,
      log_date: today,
      items,
      subtotal,
      total_discount: totalDiscount,
      grand_total: grandTotal,
      notes: notes || null,
      status: "submitted",
    } as never)
    .select("*, company:company_id(name, code, brand_color)")
    .single();

  if (logResult.error) return NextResponse.json({ message: logResult.error.message }, { status: 500 });

  const [companyManagersResult, orgManagersResult] = await Promise.all([
    admin
      .from("sales_company_assignments")
      .select("user_id")
      .eq("organization_id", auth.orgId)
      .eq("company_id", companyId)
      .eq("assignment_role", "manager")
      .eq("is_active", true),
    admin
      .from("org_members")
      .select("user_id, role")
      .eq("org_id", auth.orgId)
      .in("role", ["hr_admin", "admin"]),
  ]);

  const recipients = Array.from(new Set([
    ...(((companyManagersResult.data ?? []) as Record<string, unknown>[]).map((row) => String(row.user_id || ""))),
    ...(((orgManagersResult.data ?? []) as Record<string, unknown>[]).map((row) => String(row.user_id || ""))),
  ].filter((userId) => userId && userId !== auth.user.id)));

  if (recipients.length > 0) {
    await admin.from("notifications").insert(recipients.map((userId) => ({
      org_id: auth.orgId,
      user_id: userId,
      title: `تقرير مبيعات جديد من ${agentName}`,
      body: `تم إرسال مبيعات بقيمة ${money(grandTotal)}.`,
      type: "sales",
      link: `/sales/reports?agent=${auth.user.id}&company=${companyId}&date_from=${today}&date_to=${today}`,
      is_read: false,
    })) as never);
  }

  return NextResponse.json({ data: logResult.data });
}
