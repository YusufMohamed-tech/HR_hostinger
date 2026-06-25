import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireTenantContext } from "@/lib/server/tenant-context";

// Kept temporarily for older route parity while active handlers use requireTenantContext.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
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
  const auth = await requireTenantContext({ roles: ["admin", "hr_admin"], feature: "assets" });
  if ("error" in auth) return auth.error;
  if (!["admin", "hr_admin"].includes(auth.role)) {
    return NextResponse.json({ message: "تسليم العهد متاح للموارد البشرية فقط." }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const admin = createAdminClient();
  const mode = String((body as Record<string, unknown>).mode || "").trim();

  if (mode === "inventory") {
    const assetName = String((body as Record<string, unknown>).asset_name || "").trim();
    const assetType = String((body as Record<string, unknown>).asset_type || "Company Asset").trim();
    const serialNumber = String((body as Record<string, unknown>).serial_number || "").trim();
    const officeLocationId = String((body as Record<string, unknown>).office_location_id || "").trim();
    const purchaseDate = String((body as Record<string, unknown>).purchase_date || "").trim();
    const notes = String((body as Record<string, unknown>).notes || "").trim();

    if (!assetName || !serialNumber) {
      return NextResponse.json({ message: "اسم الأصل والرقم التسلسلي مطلوبان." }, { status: 400 });
    }

    const { data, error } = await admin
      .from("asset_inventory")
      .insert({
        org_id: auth.orgId,
        asset_name: assetName,
        asset_type: assetType || "Company Asset",
        serial_number: serialNumber,
        office_location_id: officeLocationId || null,
        purchase_date: purchaseDate || null,
        notes: notes || null,
        status: "available",
        created_by: auth.user.id,
      } as never)
      .select("*, office_location:office_location_id(name, city)")
      .single();

    if (error) return NextResponse.json({ message: error.message }, { status: 500 });
    return NextResponse.json({ data });
  }

  const employeeId = String((body as Record<string, unknown>).employee_id || "").trim();
  const inventoryId = String((body as Record<string, unknown>).inventory_id || "").trim();
  let assetName = String((body as Record<string, unknown>).asset_name || "").trim();
  let assetType = String((body as Record<string, unknown>).asset_type || "Company Asset").trim();
  let serialNumber = String((body as Record<string, unknown>).serial_number || "").trim();
  const notes = String((body as Record<string, unknown>).notes || "").trim();

  if (!employeeId || (!assetName && !inventoryId)) {
    return NextResponse.json({ message: "الموظف واسم العهدة مطلوبان." }, { status: 400 });
  }

  if (inventoryId) {
    const { data: inventory, error: inventoryError } = await admin
      .from("asset_inventory")
      .select("*")
      .eq("org_id", auth.orgId)
      .eq("id", inventoryId)
      .maybeSingle();

    if (inventoryError) return NextResponse.json({ message: inventoryError.message }, { status: 500 });
    const inventoryRecord = inventory as Record<string, unknown> | null;
    if (!inventoryRecord) return NextResponse.json({ message: "الأصل غير موجود في المخزون." }, { status: 404 });

    const inventoryStatus = String(inventoryRecord.status || "");
    if (!["available", "returned"].includes(inventoryStatus)) {
      return NextResponse.json({ message: "هذا الأصل غير متاح للتسليم حاليًا." }, { status: 400 });
    }

    assetName = String(inventoryRecord.asset_name || assetName);
    assetType = String(inventoryRecord.asset_type || assetType || "Company Asset");
    serialNumber = String(inventoryRecord.serial_number || serialNumber);
  }

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
      inventory_id: inventoryId || null,
      notes: notes || null,
      status: "assigned",
      assigned_by: auth.user.id,
    } as never)
    .select("*, employee:employee_id(full_name, employee_code)")
    .single();

  if (error) return NextResponse.json({ message: error.message }, { status: 500 });

  if (inventoryId) {
    await admin
      .from("asset_inventory")
      .update({
        status: "assigned",
        current_employee_id: employeeId,
        current_assignment_id: String((data as Record<string, unknown>).id || ""),
        updated_by: auth.user.id,
      } as never)
      .eq("org_id", auth.orgId)
      .eq("id", inventoryId);
  }

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
  const auth = await requireTenantContext({ feature: "assets" });
  if ("error" in auth) return auth.error;

  const body = await request.json().catch(() => ({}));
  const id = String((body as Record<string, unknown>).id || "").trim();
  let signaturePath = String((body as Record<string, unknown>).signature_path || "").trim();
  const signatureData = String((body as Record<string, unknown>).signature_data || "").trim();
  const status = String((body as Record<string, unknown>).status || "").trim();
  const admin = createAdminClient();

  if (!id) {
    return NextResponse.json({ message: "معرف العهدة مطلوب." }, { status: 400 });
  }

  if (status) {
    if (!["admin", "hr_admin"].includes(auth.role)) {
      return NextResponse.json({ message: "تغيير حالة العهدة متاح للموارد البشرية فقط." }, { status: 403 });
    }

    const updateData: Record<string, unknown> = {
      status,
      updated_by: auth.user.id,
    };
    if (status === "returned") {
      updateData.returned_date = new Date().toISOString().slice(0, 10);
      updateData.returned_by = auth.user.id;
    }

    const { data, error } = await admin
      .from("employee_assets")
      .update(updateData as never)
      .eq("org_id", auth.orgId)
      .eq("id", id)
      .select("*, employee:employee_id(full_name, employee_code)")
      .single();

    if (error) return NextResponse.json({ message: error.message }, { status: 500 });

    const assetRecord = data as Record<string, unknown> | null;
    const inventoryId = String(assetRecord?.inventory_id || "");
    if (inventoryId) {
      const clearCurrent = ["returned", "damaged", "lost"].includes(status);
      await admin
        .from("asset_inventory")
        .update({
          status,
          current_employee_id: clearCurrent ? null : assetRecord?.employee_id || null,
          current_assignment_id: clearCurrent ? null : id,
          updated_by: auth.user.id,
        } as never)
        .eq("id", inventoryId)
        .eq("org_id", auth.orgId);
    }

    return NextResponse.json({ data });
  }

  if (!signaturePath && !signatureData) {
    return NextResponse.json({ message: "معرف العهدة والتوقيع مطلوبان." }, { status: 400 });
  }

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

  if (!signaturePath) {
    const bytes = new TextEncoder().encode(signatureData);
    const filePath = `${auth.orgId}/assets/${id}/asset-signature-${Date.now()}.txt`;
    const uploadResult = await admin.storage
      .from("balance-attachments")
      .upload(filePath, bytes, {
        contentType: "text/plain",
        upsert: false,
      });

    if (uploadResult.error) {
      return NextResponse.json({ message: uploadResult.error.message }, { status: 500 });
    }
    signaturePath = uploadResult.data.path;
  }

  const { data, error } = await admin
    .from("employee_assets")
    .update({
      acknowledgment_signature_url: signaturePath,
      acknowledged_at: new Date().toISOString(),
    } as never)
    .eq("org_id", auth.orgId)
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
