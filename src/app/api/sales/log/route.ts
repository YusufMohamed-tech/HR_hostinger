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

export async function GET() {
  const auth = await requireSalesAccess();
  if ("error" in auth) return auth.error;

  const admin = createAdminClient();
  const today = todayIso();
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

  const [productsResult, todayResult, historyResult, yesterdayResult] = await Promise.all([
    admin
      .from("sales_products")
      .select("*")
      .eq("organization_id", auth.orgId)
      .eq("is_active", true)
      .order("name", { ascending: true }),
    admin
      .from("sales_logs")
      .select("*")
      .eq("organization_id", auth.orgId)
      .eq("sales_agent_id", auth.user.id)
      .eq("log_date", today)
      .maybeSingle(),
    admin
      .from("sales_logs")
      .select("items")
      .eq("organization_id", auth.orgId)
      .eq("sales_agent_id", auth.user.id)
      .order("log_date", { ascending: false })
      .limit(30),
    admin
      .from("sales_logs")
      .select("items")
      .eq("organization_id", auth.orgId)
      .eq("sales_agent_id", auth.user.id)
      .eq("log_date", yesterday)
      .maybeSingle(),
  ]);

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

  const yesterdayRecord = yesterdayResult.data as unknown as Record<string, unknown> | null;
  const yesterdayItems = Array.isArray(yesterdayRecord?.items)
    ? yesterdayRecord.items
    : [];

  return NextResponse.json({
    data: {
      products,
      todayLog: todayResult.data ?? null,
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
  const requestedItems = Array.isArray(body.items) ? body.items as Record<string, unknown>[] : [];
  const notes = String(body.notes || "").trim();
  const today = todayIso();

  const admin = createAdminClient();
  const existingResult = await admin
    .from("sales_logs")
    .select("id, created_at")
    .eq("organization_id", auth.orgId)
    .eq("sales_agent_id", auth.user.id)
    .eq("log_date", today)
    .maybeSingle();

  if (existingResult.error) return NextResponse.json({ message: existingResult.error.message }, { status: 500 });
  if (existingResult.data) {
    const createdAt = String((existingResult.data as Record<string, unknown>).created_at || "");
    return NextResponse.json({ message: `تم إرسال تقرير اليوم بالفعل في ${createdAt.slice(11, 16)}` }, { status: 409 });
  }

  const productIds = Array.from(new Set(requestedItems.map((item) => String(item.product_id || "")).filter(Boolean)));
  if (productIds.length === 0) return NextResponse.json({ message: "اختر منتجًا واحدًا على الأقل." }, { status: 400 });

  const productsResult = await admin
    .from("sales_products")
    .select("id, name, price, is_active")
    .eq("organization_id", auth.orgId)
    .in("id", productIds);

  if (productsResult.error) return NextResponse.json({ message: productsResult.error.message }, { status: 500 });

  const products = new Map(((productsResult.data ?? []) as Record<string, unknown>[]).map((product) => [String(product.id), product]));
  const items = requestedItems.map((item) => {
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

  const subtotal = Number(items.reduce((sum, item) => sum + item.quantity * item.unit_price, 0).toFixed(2));
  const totalDiscount = Number(items.reduce((sum, item) => sum + item.discount_amount, 0).toFixed(2));
  const grandTotal = Number(items.reduce((sum, item) => sum + item.line_total, 0).toFixed(2));

  const profileResult = await admin.from("profiles").select("full_name, email").eq("user_id", auth.user.id).maybeSingle();
  const agentName = String((profileResult.data as Record<string, unknown> | null)?.full_name || auth.user.email || "بائع");

  const logResult = await admin
    .from("sales_logs")
    .insert({
      organization_id: auth.orgId,
      sales_agent_id: auth.user.id,
      log_date: today,
      items,
      subtotal,
      total_discount: totalDiscount,
      grand_total: grandTotal,
      notes: notes || null,
      status: "submitted",
    } as never)
    .select()
    .single();

  if (logResult.error) return NextResponse.json({ message: logResult.error.message }, { status: 500 });

  const recipientsResult = await admin
    .from("org_members")
    .select("user_id, role")
    .eq("org_id", auth.orgId)
    .in("role", ["sales_manager", "hr_admin", "admin"]);

  const recipients = Array.from(new Set(((recipientsResult.data ?? []) as Record<string, unknown>[])
    .map((member) => String(member.user_id || ""))
    .filter(Boolean)));

  if (recipients.length > 0) {
    await admin.from("notifications").insert(recipients.map((userId) => ({
      org_id: auth.orgId,
      user_id: userId,
      title: `تقرير مبيعات جديد من ${agentName}`,
      body: `تم إرسال تقرير مبيعات بقيمة ${money(grandTotal)}.`,
      type: "sales",
      link: `/sales/reports?agent=${auth.user.id}&date_from=${today}&date_to=${today}`,
      is_read: false,
    })) as never);
  }

  return NextResponse.json({ data: logResult.data });
}
