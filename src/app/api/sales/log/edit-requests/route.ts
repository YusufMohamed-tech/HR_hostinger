import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireSalesAccess } from "@/lib/server/sales-auth";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function toNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
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
  const auth = await requireSalesAccess();
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

  const existingResult = await admin
    .from("sales_log_edit_requests")
    .select("id")
    .eq("organization_id", auth.orgId)
    .eq("sales_log_id", salesLogId)
    .eq("status", "pending")
    .maybeSingle();
  if (existingResult.error) return NextResponse.json({ message: existingResult.error.message }, { status: 500 });
  if (existingResult.data) {
    return NextResponse.json({ message: "يوجد طلب تعديل قيد المراجعة لهذا التقرير بالفعل." }, { status: 409 });
  }

  const insertResult = await admin
    .from("sales_log_edit_requests")
    .insert({
      organization_id: auth.orgId,
      sales_log_id: salesLogId,
      company_id: companyId || null,
      sales_agent_id: auth.user.id,
      requested_changes: requestedChanges,
      status: "pending",
    } as never)
    .select("*")
    .single();
  if (insertResult.error) return NextResponse.json({ message: insertResult.error.message }, { status: 500 });

  const profileResult = await admin.from("profiles").select("full_name, email").eq("user_id", auth.user.id).maybeSingle();
  const agentName = String((profileResult.data as Record<string, unknown> | null)?.full_name || auth.user.email || "بائع");
  const companyName = String(((log.company as Record<string, unknown> | null)?.name) || "شركة المبيعات");

  const [companyManagersResult, orgManagersResult] = await Promise.all([
    companyId
      ? admin
          .from("sales_company_assignments")
          .select("user_id")
          .eq("organization_id", auth.orgId)
          .eq("company_id", companyId)
          .eq("assignment_role", "manager")
          .eq("is_active", true)
      : Promise.resolve({ data: [], error: null }),
    admin
      .from("org_members")
      .select("user_id, role")
      .eq("org_id", auth.orgId)
      .in("role", ["hr_admin", "admin"]),
  ]);

  if (companyManagersResult.error) return NextResponse.json({ message: companyManagersResult.error.message }, { status: 500 });
  if (orgManagersResult.error) return NextResponse.json({ message: orgManagersResult.error.message }, { status: 500 });

  const recipients = Array.from(new Set([
    ...(((companyManagersResult.data ?? []) as Record<string, unknown>[]).map((row) => String(row.user_id || ""))),
    ...(((orgManagersResult.data ?? []) as Record<string, unknown>[]).map((row) => String(row.user_id || ""))),
  ].filter((userId) => userId && userId !== auth.user.id)));

  if (recipients.length > 0) {
    await admin.from("notifications").insert(recipients.map((userId) => ({
      org_id: auth.orgId,
      user_id: userId,
      title: `طلب تعديل تقرير مبيعات من ${agentName}`,
      body: `${companyName}: ${requestedChanges}`,
      type: "sales",
      link: `/sales/reports?agent=${auth.user.id}&company=${companyId}&date=${String(log.log_date || "")}`,
      is_read: false,
    })) as never);
  }

  return NextResponse.json({ data: insertResult.data });
}

export async function PATCH(request: NextRequest) {
  const auth = await requireSalesAccess({ managerOnly: true });
  if ("error" in auth) return auth.error;

  const body = await request.json().catch(() => ({}));
  const requestId = String(body.id || "").trim();
  const status = String(body.status || "").trim();
  const resolutionNote = String(body.resolution_note || "").trim();
  const notes = String(body.notes || "").trim();
  const requestedItems = Array.isArray(body.items) ? body.items as Record<string, unknown>[] : [];

  if (!requestId || !["applied", "rejected"].includes(status)) {
    return NextResponse.json({ message: "قرار طلب التعديل غير صحيح." }, { status: 400 });
  }

  const admin = createAdminClient();
  const editRequestResult = await admin
    .from("sales_log_edit_requests")
    .select("*")
    .eq("id", requestId)
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
    .select("id, organization_id, company_id, sales_agent_id, log_date")
    .eq("id", String(editRequest.sales_log_id || ""))
    .eq("organization_id", auth.orgId)
    .maybeSingle();

  if (logResult.error) return NextResponse.json({ message: logResult.error.message }, { status: 500 });
  const log = logResult.data as Record<string, unknown> | null;
  if (!log) return NextResponse.json({ message: "تقرير المبيعات غير موجود." }, { status: 404 });

  if (status === "rejected") {
    const updateResult = await admin
      .from("sales_log_edit_requests")
      .update({ status: "rejected", resolved_by: auth.user.id, resolved_at: new Date().toISOString(), resolution_note: resolutionNote || null } as never)
      .eq("id", requestId)
      .select("*")
      .single();
    if (updateResult.error) return NextResponse.json({ message: updateResult.error.message }, { status: 500 });

    await admin.from("notifications").insert({
      org_id: auth.orgId,
      user_id: String(editRequest.sales_agent_id || ""),
      title: "تم رفض طلب تعديل تقرير المبيعات",
      body: resolutionNote || "راجع مدير المبيعات لمعرفة سبب الرفض.",
      type: "sales",
      link: `/sales/history?date=${String(log.log_date || "")}`,
      is_read: false,
    } as never);

    return NextResponse.json({ data: updateResult.data });
  }

  const productIds = Array.from(new Set(requestedItems.map((item) => String(item.product_id || "")).filter(Boolean)));
  if (productIds.length === 0) return NextResponse.json({ message: "أضف منتجاً واحداً على الأقل قبل تطبيق التعديل." }, { status: 400 });

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
      const discountPercent = Math.max(0, Math.min(100, toNumber(item.discount_percent)));
      if (!product || product.is_active === false) throw new Error("يوجد منتج غير متاح في التقرير.");
      if (quantity <= 0) throw new Error("الكمية يجب أن تكون أكبر من صفر.");
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

  const logUpdateResult = await admin
    .from("sales_logs")
    .update({
      items,
      subtotal,
      total_discount: totalDiscount,
      grand_total: grandTotal,
      notes: notes || null,
      status: "reviewed",
      reviewed_by: auth.user.id,
      reviewed_at: new Date().toISOString(),
    } as never)
    .eq("id", String(log.id || ""))
    .eq("organization_id", auth.orgId);
  if (logUpdateResult.error) return NextResponse.json({ message: logUpdateResult.error.message }, { status: 500 });

  const updateResult = await admin
    .from("sales_log_edit_requests")
    .update({ status: "applied", resolved_by: auth.user.id, resolved_at: new Date().toISOString(), resolution_note: resolutionNote || null } as never)
    .eq("id", requestId)
    .select("*")
    .single();
  if (updateResult.error) return NextResponse.json({ message: updateResult.error.message }, { status: 500 });

  await admin.from("notifications").insert({
    org_id: auth.orgId,
    user_id: String(editRequest.sales_agent_id || ""),
    title: "تم تطبيق تعديل تقرير المبيعات",
    body: `تم تحديث التقرير بإجمالي ${grandTotal.toLocaleString("ar-SA")} ريال سعودي.`,
    type: "sales",
    link: `/sales/history?date=${String(log.log_date || "")}`,
    is_read: false,
  } as never);

  return NextResponse.json({ data: updateResult.data });
}
