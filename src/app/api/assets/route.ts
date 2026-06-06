import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";

async function getAuthContext() {
  const supabase = await createServerSupabaseClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  const user = userData?.user;
  if (userError || !user) {
    return { error: NextResponse.json({ message: "غير مصرح بالدخول." }, { status: 401 }) };
  }

  const { data: membership, error: membershipError } = await supabase
    .from("org_members")
    .select("org_id, role")
    .eq("user_id", user.id)
    .maybeSingle();

  const member = membership as Record<string, unknown> | null;
  const orgId = String(member?.org_id || "");
  const role = String(member?.role || "");
  if (membershipError || !orgId || !role) {
    return { error: NextResponse.json({ message: "لا توجد صلاحية منظمة." }, { status: 403 }) };
  }

  return { user, orgId, role };
}

async function notifyHr(admin: ReturnType<typeof createAdminClient>, orgId: string, title: string, body: string, link = "/assets") {
  const { data: members } = await admin
    .from("org_members")
    .select("user_id")
    .eq("org_id", orgId)
    .in("role", ["admin", "hr_admin"]);

  const rows = ((members ?? []) as Record<string, unknown>[]).map((member) => ({
    org_id: orgId,
    user_id: String(member.user_id),
    title,
    body,
    type: "system",
    link,
    is_read: false,
  }));

  if (rows.length > 0) await admin.from("notifications").insert(rows as never);
}

export async function POST(request: NextRequest) {
  const auth = await getAuthContext();
  if ("error" in auth) return auth.error;
  if (!["admin", "hr_admin"].includes(auth.role)) {
    return NextResponse.json({ message: "تسليم العهد متاح للموارد البشرية فقط." }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const employeeId = String((body as Record<string, unknown>).employee_id || "").trim();
  const assetName = String((body as Record<string, unknown>).asset_name || "").trim();
  const assetType = String((body as Record<string, unknown>).asset_type || "Company Asset").trim();
  const serialNumber = String((body as Record<string, unknown>).serial_number || "").trim();
  const notes = String((body as Record<string, unknown>).notes || "").trim();

  if (!employeeId || !assetName) {
    return NextResponse.json({ message: "الموظف واسم العهدة مطلوبان." }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: employee, error: employeeError } = await admin
    .from("employees")
    .select("id, full_name, user_id")
    .eq("org_id", auth.orgId)
    .eq("id", employeeId)
    .maybeSingle();

  if (employeeError) return NextResponse.json({ message: employeeError.message }, { status: 500 });
  const employeeRecord = employee as Record<string, unknown> | null;
  if (!employeeRecord) return NextResponse.json({ message: "الموظف غير موجود." }, { status: 404 });

  const { data, error } = await admin
    .from("employee_assets")
    .insert({
      org_id: auth.orgId,
      employee_id: employeeId,
      asset_name: assetName,
      asset_type: assetType || "Company Asset",
      serial_number: serialNumber || null,
      notes: notes || null,
      status: "assigned",
      assigned_by: auth.user.id,
    } as never)
    .select("*, employee:employee_id(full_name, employee_code)")
    .single();

  if (error) return NextResponse.json({ message: error.message }, { status: 500 });

  const employeeUserId = String(employeeRecord.user_id || "");
  if (employeeUserId) {
    await admin.from("notifications").insert({
      org_id: auth.orgId,
      user_id: employeeUserId,
      title: "تم تسليم عهدة جديدة",
      body: `تم تسجيل عهدة جديدة لك: ${assetName}. برجاء مراجعتها والتوقيع بالاستلام.`,
      type: "system",
      link: "/assets",
      is_read: false,
    } as never);
  }

  return NextResponse.json({ data });
}

export async function PATCH(request: NextRequest) {
  const auth = await getAuthContext();
  if ("error" in auth) return auth.error;

  const body = await request.json().catch(() => ({}));
  const id = String((body as Record<string, unknown>).id || "").trim();
  const signaturePath = String((body as Record<string, unknown>).signature_path || "").trim();

  if (!id || !signaturePath) {
    return NextResponse.json({ message: "معرف العهدة والتوقيع مطلوبان." }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: asset, error: assetError } = await admin
    .from("employee_assets")
    .select("*, employee:employee_id(full_name, user_id)")
    .eq("org_id", auth.orgId)
    .eq("id", id)
    .maybeSingle();

  if (assetError) return NextResponse.json({ message: assetError.message }, { status: 500 });
  const assetRecord = asset as Record<string, unknown> | null;
  if (!assetRecord) return NextResponse.json({ message: "العهدة غير موجودة." }, { status: 404 });

  if (auth.role === "employee") {
    const employee = (assetRecord.employee ?? null) as Record<string, unknown> | null;
    if (String(employee?.user_id || "") !== auth.user.id) {
      return NextResponse.json({ message: "لا يمكنك توقيع عهدة غير مسندة لك." }, { status: 403 });
    }
  }

  const { data, error } = await admin
    .from("employee_assets")
    .update({
      acknowledgment_signature_url: signaturePath,
      acknowledged_at: new Date().toISOString(),
    } as never)
    .eq("id", id)
    .select("*, employee:employee_id(full_name, employee_code)")
    .single();

  if (error) return NextResponse.json({ message: error.message }, { status: 500 });

  const employee = (assetRecord.employee ?? null) as Record<string, unknown> | null;
  const employeeName = String(employee?.full_name || "الموظف");
  const assetName = String(assetRecord.asset_name || assetRecord.asset_type || "عهدة");
  await notifyHr(admin, auth.orgId, "تم توقيع استلام عهدة", `${employeeName} وقّع استلام عهدة: ${assetName}.`);

  return NextResponse.json({ data });
}
