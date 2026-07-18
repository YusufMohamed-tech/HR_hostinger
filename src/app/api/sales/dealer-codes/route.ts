import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireSalesAccess } from "@/lib/server/sales-auth";

export async function GET(request: NextRequest) {
  const auth = await requireSalesAccess({ managerOnly: true });
  if ("error" in auth) return auth.error;

  const admin = createAdminClient();
  const sp = request.nextUrl.searchParams;
  const employeeId = sp.get("employee_id");
  const isActive = sp.get("is_active");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = (admin as any)
    .from("employee_dealer_codes")
    .select(`
      *,
      employee:employees(id, full_name, gosi_registered)
    `)
    .eq("organization_id", auth.orgId)
    .order("created_at", { ascending: false });

  if (employeeId) q = q.eq("employee_id", employeeId) as typeof q;
  if (isActive === "true") q = q.eq("is_active", true) as typeof q;
  if (isActive === "false") q = q.eq("is_active", false) as typeof q;

  const { data, error } = await q;
  if (error) return NextResponse.json({ message: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

export async function POST(request: NextRequest) {
  const auth = await requireSalesAccess({ managerOnly: true });
  if ("error" in auth) return auth.error;

  const body = await request.json() as {
    employee_id: string;
    dealer_code: string;
    start_date: string;
    end_date?: string;
    dealer_name?: string;
    channel?: string;
    region?: string;
    city?: string;
    location_name?: string;
    notes?: string;
  };

  if (!body.employee_id || !body.dealer_code || !body.start_date) {
    return NextResponse.json({ message: "employee_id, dealer_code, and start_date are required" }, { status: 400 });
  }

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (admin as any)
    .from("employee_dealer_codes")
    .insert({
      organization_id: auth.orgId,
      employee_id: body.employee_id,
      dealer_code: body.dealer_code.trim().toUpperCase(),
      start_date: body.start_date,
      end_date: body.end_date ?? null,
      dealer_name: body.dealer_name ?? null,
      channel: body.channel ?? null,
      region: body.region ?? null,
      city: body.city ?? null,
      location_name: body.location_name ?? null,
      notes: body.notes ?? null,
      assigned_by: auth.user.id,
      is_active: true,
    })
    .select()
    .single();

  if (error) {
    const msg = error.code === "23P01" ? "This dealer code overlaps with an existing assignment for the same period" : error.message;
    return NextResponse.json({ message: msg }, { status: 400 });
  }
  return NextResponse.json({ data }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const auth = await requireSalesAccess({ managerOnly: true });
  if ("error" in auth) return auth.error;

  const sp = request.nextUrl.searchParams;
  const id = sp.get("id");
  if (!id) return NextResponse.json({ message: "id is required" }, { status: 400 });

  const body = await request.json() as Record<string, unknown>;
  const allowed = ["end_date", "is_active", "notes", "dealer_name", "channel", "region", "city", "location_name"];
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const key of allowed) {
    if (key in body) update[key] = body[key];
  }

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (admin as any)
    .from("employee_dealer_codes")
    .update(update)
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

  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ message: "id is required" }, { status: 400 });

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (admin as any)
    .from("employee_dealer_codes")
    .delete()
    .eq("id", id)
    .eq("organization_id", auth.orgId);

  if (error) return NextResponse.json({ message: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
