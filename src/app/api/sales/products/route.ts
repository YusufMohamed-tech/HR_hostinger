import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireSalesAccess } from "@/lib/server/sales-auth";

function asNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function GET(request: NextRequest) {
  const auth = await requireSalesAccess();
  if ("error" in auth) return auth.error;

  const includeInactive = request.nextUrl.searchParams.get("include_inactive") === "1";
  const admin = createAdminClient();
  let query = admin
    .from("sales_products")
    .select("*")
    .eq("organization_id", auth.orgId)
    .order("name", { ascending: true });

  if (!includeInactive) query = query.eq("is_active", true);

  const { data, error } = await query;
  if (error) return NextResponse.json({ message: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

export async function POST(request: NextRequest) {
  const auth = await requireSalesAccess({ managerOnly: true });
  if ("error" in auth) return auth.error;

  const body = await request.json().catch(() => ({}));
  const name = String(body.name || "").trim();
  const price = asNumber(body.price);

  if (name.length < 2) return NextResponse.json({ message: "اسم المنتج مطلوب." }, { status: 400 });
  if (price < 0) return NextResponse.json({ message: "السعر لا يمكن أن يكون أقل من صفر." }, { status: 400 });

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("sales_products")
    .insert({
      organization_id: auth.orgId,
      name,
      description: String(body.description || "").trim() || null,
      unit: String(body.unit || "").trim() || null,
      category: String(body.category || "").trim() || null,
      price,
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

  const values: Record<string, unknown> = {};
  if ("name" in body) {
    const name = String(body.name || "").trim();
    if (name.length < 2) return NextResponse.json({ message: "اسم المنتج مطلوب." }, { status: 400 });
    values.name = name;
  }
  if ("description" in body) values.description = String(body.description || "").trim() || null;
  if ("unit" in body) values.unit = String(body.unit || "").trim() || null;
  if ("category" in body) values.category = String(body.category || "").trim() || null;
  if ("price" in body) {
    const price = asNumber(body.price);
    if (price < 0) return NextResponse.json({ message: "السعر لا يمكن أن يكون أقل من صفر." }, { status: 400 });
    values.price = price;
  }
  if ("is_active" in body) values.is_active = Boolean(body.is_active);

  const admin = createAdminClient();
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
