import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireSalesAccess } from "@/lib/server/sales-auth";

function asNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

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

async function getScopedCompanyIds(admin: ReturnType<typeof createAdminClient>, auth: { orgId: string; user: { id: string }; role: string }, role?: "sales" | "manager") {
  if (["admin", "hr_admin"].includes(auth.role)) return null;
  let query = admin
    .from("sales_company_assignments")
    .select("company_id, assignment_role, start_date, end_date, is_active")
    .eq("organization_id", auth.orgId)
    .eq("user_id", auth.user.id)
    .eq("is_active", true);
  if (role) query = query.eq("assignment_role", role);

  const result = await query;
  if (result.error) throw result.error;
  return ((result.data ?? []) as Record<string, unknown>[])
    .filter(isActiveAssignment)
    .map((assignment) => String(assignment.company_id))
    .filter(Boolean);
}

async function canManageCompany(admin: ReturnType<typeof createAdminClient>, auth: { orgId: string; user: { id: string }; role: string }, companyId: string) {
  if (["admin", "hr_admin"].includes(auth.role)) return true;
  const ids = await getScopedCompanyIds(admin, auth, "manager");
  return Boolean(ids?.includes(companyId));
}

export async function GET(request: NextRequest) {
  const auth = await requireSalesAccess();
  if ("error" in auth) return auth.error;

  const includeInactive = request.nextUrl.searchParams.get("include_inactive") === "1";
  const companyId = String(request.nextUrl.searchParams.get("company_id") || "").trim();
  const admin = createAdminClient();

  let query = admin
    .from("sales_products")
    .select("*, company:company_id(name, code, brand_color)")
    .eq("organization_id", auth.orgId)
    .order("name", { ascending: true });

  if (!includeInactive) query = query.eq("is_active", true);
  if (companyId) query = query.eq("company_id", companyId);

  const scopedCompanyIds = await getScopedCompanyIds(admin, auth).catch((error) => {
    throw error;
  });
  if (Array.isArray(scopedCompanyIds)) {
    if (scopedCompanyIds.length === 0) return NextResponse.json({ data: [] });
    query = query.in("company_id", scopedCompanyIds);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ message: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

export async function POST(request: NextRequest) {
  const auth = await requireSalesAccess({ managerOnly: true });
  if ("error" in auth) return auth.error;

  const body = await request.json().catch(() => ({}));
  const name = String(body.name || "").trim();
  const companyId = String(body.company_id || "").trim();
  const price = asNumber(body.price);

  if (!companyId) return NextResponse.json({ message: "اختر شركة المنتج." }, { status: 400 });
  if (name.length < 2) return NextResponse.json({ message: "اسم المنتج مطلوب." }, { status: 400 });
  if (price < 0) return NextResponse.json({ message: "السعر لا يمكن أن يكون أقل من صفر." }, { status: 400 });

  const admin = createAdminClient();
  if (!(await canManageCompany(admin, auth, companyId))) {
    return NextResponse.json({ message: "ليست لديك صلاحية إدارة منتجات هذه الشركة." }, { status: 403 });
  }

  const { data, error } = await admin
    .from("sales_products")
    .insert({
      organization_id: auth.orgId,
      company_id: companyId,
      name,
      description: String(body.description || "").trim() || null,
      unit: String(body.unit || "").trim() || null,
      category: String(body.category || "").trim() || null,
      price,
      revenue_account_id: String(body.revenue_account_id || "").trim() || null,
      is_active: body.is_active !== false,
      created_by: auth.user.id,
    } as never)
    .select()
    .single();

  if (error) return NextResponse.json({ message: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

export async function PATCH(request: NextRequest) {
  const auth = await requireSalesAccess({ managerOnly: true });
  if ("error" in auth) return auth.error;

  const body = await request.json().catch(() => ({}));
  const id = String(body.id || "").trim();
  if (!id) return NextResponse.json({ message: "معرف المنتج مطلوب." }, { status: 400 });

  const admin = createAdminClient();
  const currentResult = await admin
    .from("sales_products")
    .select("id, company_id")
    .eq("id", id)
    .eq("organization_id", auth.orgId)
    .maybeSingle();
  if (currentResult.error) return NextResponse.json({ message: currentResult.error.message }, { status: 500 });
  if (!currentResult.data) return NextResponse.json({ message: "المنتج غير موجود." }, { status: 404 });

  const nextCompanyId = String(body.company_id || (currentResult.data as Record<string, unknown>).company_id || "").trim();
  if (!(await canManageCompany(admin, auth, String((currentResult.data as Record<string, unknown>).company_id || ""))) || !(await canManageCompany(admin, auth, nextCompanyId))) {
    return NextResponse.json({ message: "ليست لديك صلاحية إدارة منتجات هذه الشركة." }, { status: 403 });
  }

  const values: Record<string, unknown> = {};
  if ("company_id" in body) values.company_id = nextCompanyId || null;
  if ("name" in body) {
    const name = String(body.name || "").trim();
    if (name.length < 2) return NextResponse.json({ message: "اسم المنتج مطلوب." }, { status: 400 });
    values.name = name;
  }
  if ("description" in body) values.description = String(body.description || "").trim() || null;
  if ("unit" in body) values.unit = String(body.unit || "").trim() || null;
  if ("category" in body) values.category = String(body.category || "").trim() || null;
  if ("revenue_account_id" in body) values.revenue_account_id = String(body.revenue_account_id || "").trim() || null;
  if ("price" in body) {
    const price = asNumber(body.price);
    if (price < 0) return NextResponse.json({ message: "السعر لا يمكن أن يكون أقل من صفر." }, { status: 400 });
    values.price = price;
  }
  if ("is_active" in body) values.is_active = Boolean(body.is_active);

  const { data, error } = await admin
    .from("sales_products")
    .update(values as never)
    .eq("id", id)
    .eq("organization_id", auth.orgId)
    .select()
    .single();

  if (error) return NextResponse.json({ message: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

export async function DELETE(request: NextRequest) {
  const auth = await requireSalesAccess({ managerOnly: true });
  if ("error" in auth) return auth.error;

  const body = await request.json().catch(() => ({}));
  const id = String(body.id || "").trim();
  if (!id) return NextResponse.json({ message: "معرف المنتج مطلوب." }, { status: 400 });

  const admin = createAdminClient();
  const currentResult = await admin
    .from("sales_products")
    .select("id, company_id")
    .eq("id", id)
    .eq("organization_id", auth.orgId)
    .maybeSingle();
  if (currentResult.error) return NextResponse.json({ message: currentResult.error.message }, { status: 500 });
  if (!currentResult.data) return NextResponse.json({ message: "المنتج غير موجود." }, { status: 404 });
  if (!(await canManageCompany(admin, auth, String((currentResult.data as Record<string, unknown>).company_id || "")))) {
    return NextResponse.json({ message: "ليست لديك صلاحية إدارة منتجات هذه الشركة." }, { status: 403 });
  }

  const { data, error } = await admin
    .from("sales_products")
    .update({ is_active: false } as never)
    .eq("id", id)
    .eq("organization_id", auth.orgId)
    .select("id")
    .single();

  if (error) return NextResponse.json({ message: error.message }, { status: 500 });
  return NextResponse.json({ data });
}
