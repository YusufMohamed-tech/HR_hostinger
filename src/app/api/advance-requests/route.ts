import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { formatCurrency } from "@/lib/utils/currency";

const reviewStatuses = new Set(["approved", "partial_approved", "rejected"]);

async function getAuthContext() {
  const supabase = await createServerSupabaseClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  const user = userData?.user;
  if (userError || !user) return { error: NextResponse.json({ message: "غير مصرح بالدخول." }, { status: 401 }) };

  const { data: membership, error: membershipError } = await supabase
    .from("org_members")
    .select("org_id, role")
    .eq("user_id", user.id)
    .maybeSingle();

  const member = membership as Record<string, unknown> | null;
  const orgId = String(member?.org_id || "");
  const role = String(member?.role || "");
  if (membershipError || !orgId || !role) return { error: NextResponse.json({ message: "لا توجد صلاحية منظمة." }, { status: 403 }) };
  return { user, orgId, role };
}

export async function GET() {
  const auth = await getAuthContext();
  if ("error" in auth) return auth.error;

  const admin = createAdminClient();
  let query = admin
    .from("advance_requests")
    .select("*, employee:employee_id(full_name, employee_code, user_id)")
    .eq("organization_id", auth.orgId)
    .order("created_at", { ascending: false });

  if (!["admin", "hr_admin"].includes(auth.role)) {
    const { data: employee } = await admin
      .from("employees")
      .select("id")
      .eq("org_id", auth.orgId)
      .eq("user_id", auth.user.id)
      .maybeSingle();
    const employeeId = String((employee as Record<string, unknown> | null)?.id || "");
    query = query.eq("employee_id", employeeId);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ message: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

export async function POST(request: NextRequest) {
  const auth = await getAuthContext();
  if ("error" in auth) return auth.error;

  const body = await request.json().catch(() => ({}));
  const requestedAmount = Number((body as Record<string, unknown>).requested_amount || 0);
  const reason = String((body as Record<string, unknown>).reason || "").trim();
  const signature = String((body as Record<string, unknown>).employee_signature_data || "").trim();

  if (requestedAmount <= 0) return NextResponse.json({ message: "مبلغ السلفة مطلوب." }, { status: 400 });
  if (!signature.startsWith("data:image/")) return NextResponse.json({ message: "توقيع الموظف مطلوب قبل إرسال الطلب." }, { status: 400 });

  const admin = createAdminClient();
  const { data: employee, error: employeeError } = await admin
    .from("employees")
    .select("id, full_name")
    .eq("org_id", auth.orgId)
    .eq("user_id", auth.user.id)
    .maybeSingle();

  if (employeeError) return NextResponse.json({ message: employeeError.message }, { status: 500 });
  const employeeRecord = employee as Record<string, unknown> | null;
  const employeeId = String(employeeRecord?.id || "");
  if (!employeeId) return NextResponse.json({ message: "ملف الموظف مطلوب." }, { status: 403 });

  const { data, error } = await admin
    .from("advance_requests")
    .insert({
      organization_id: auth.orgId,
      employee_id: employeeId,
      requested_amount: requestedAmount,
      reason: reason || null,
      employee_signature_data: signature,
      employee_signed_at: new Date().toISOString(),
      status: "pending",
    } as never)
    .select("*, employee:employee_id(full_name, employee_code, user_id)")
    .single();

  if (error) return NextResponse.json({ message: error.message }, { status: 500 });

  const { data: hrMembers } = await admin
    .from("org_members")
    .select("user_id")
    .eq("org_id", auth.orgId)
    .in("role", ["admin", "hr_admin"]);

  const employeeName = String(employeeRecord?.full_name || "موظف");
  const rows = ((hrMembers ?? []) as Record<string, unknown>[]).map((member) => ({
    org_id: auth.orgId,
    user_id: String(member.user_id),
    title: "طلب سلفة جديد",
    body: `طلب سلفة جديد من ${employeeName} بقيمة ${formatCurrency(requestedAmount)}`,
    type: "system",
    link: "/balances",
    is_read: false,
  }));
  if (rows.length > 0) await admin.from("notifications").insert(rows as never);

  return NextResponse.json({ data });
}

export async function PATCH(request: NextRequest) {
  const auth = await getAuthContext();
  if ("error" in auth) return auth.error;
  if (!["admin", "hr_admin"].includes(auth.role)) {
    return NextResponse.json({ message: "مراجعة طلبات السلف متاحة للموارد البشرية فقط." }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const id = String((body as Record<string, unknown>).id || "").trim();
  const status = String((body as Record<string, unknown>).status || "").trim();
  const approvedAmount = Number((body as Record<string, unknown>).approved_amount || 0);
  const hrNotes = String((body as Record<string, unknown>).hr_notes || "").trim();

  if (!id) return NextResponse.json({ message: "معرف الطلب مطلوب." }, { status: 400 });
  if (!reviewStatuses.has(status)) return NextResponse.json({ message: "قرار غير مدعوم." }, { status: 400 });
  if (status !== "rejected" && approvedAmount <= 0) return NextResponse.json({ message: "مبلغ الموافقة مطلوب." }, { status: 400 });

  const admin = createAdminClient();
  const { data: requestRow, error: requestError } = await admin
    .from("advance_requests")
    .select("*, employee:employee_id(full_name, user_id)")
    .eq("organization_id", auth.orgId)
    .eq("id", id)
    .maybeSingle();

  if (requestError) return NextResponse.json({ message: requestError.message }, { status: 500 });
  if (!requestRow) return NextResponse.json({ message: "طلب السلفة غير موجود." }, { status: 404 });

  const row = requestRow as Record<string, unknown>;
  const employee = (row.employee ?? null) as Record<string, unknown> | null;
  const finalAmount = status === "rejected" ? null : approvedAmount;

  const { data, error } = await admin
    .from("advance_requests")
    .update({
      status,
      approved_amount: finalAmount,
      hr_notes: hrNotes || null,
      reviewed_by: auth.user.id,
      reviewed_at: new Date().toISOString(),
    } as never)
    .eq("id", id)
    .select("*, employee:employee_id(full_name, employee_code, user_id)")
    .single();

  if (error) return NextResponse.json({ message: error.message }, { status: 500 });

  if (status !== "rejected" && finalAmount) {
    await admin.from("financial_balances").insert({
      org_id: auth.orgId,
      employee_id: String(row.employee_id),
      balance_type: "advance_payment",
      amount: finalAmount,
      status: "unpaid",
      description: `سلفة معتمدة من طلب رقم ${id}`,
    } as never);
  }

  const employeeUserId = String(employee?.user_id || "");
  if (employeeUserId) {
    const decisionLabel = status === "rejected" ? "تم رفض طلب السلفة" : status === "partial_approved" ? "تمت الموافقة الجزئية على طلب السلفة" : "تمت الموافقة على طلب السلفة";
    await admin.from("notifications").insert({
      org_id: auth.orgId,
      user_id: employeeUserId,
      title: decisionLabel,
      body: status === "rejected" ? (hrNotes || "تمت مراجعة طلبك.") : `المبلغ المعتمد: ${formatCurrency(finalAmount)}`,
      type: "system",
      link: "/balances",
      is_read: false,
    } as never);
  }

  return NextResponse.json({ data });
}
