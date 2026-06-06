import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireSalesAccess } from "@/lib/server/sales-auth";

async function getAuthUserByEmail(email: string) {
  const admin = createAdminClient();
  let page = 1;
  const perPage = 100;

  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const found = data.users.find((candidate) => candidate.email?.toLowerCase() === email.toLowerCase());
    if (found) return found;
    if (data.users.length < perPage) return null;
    page += 1;
  }
}

async function recordSalesCareerEvent(
  admin: ReturnType<typeof createAdminClient>,
  values: {
    employee_id: string;
    event_type: "hired" | "promoted" | "role_change";
    previous_value?: Record<string, unknown> | null;
    new_value: Record<string, unknown>;
    effective_date?: string;
    notes?: string;
    created_by?: string;
  }
) {
  if (!values.employee_id) return { error: null };

  const result = await admin.from("employee_career_events").insert({
    employee_id: values.employee_id,
    event_type: values.event_type,
    previous_value: values.previous_value || null,
    new_value: values.new_value,
    effective_date: values.effective_date || new Date().toISOString().split("T")[0],
    notes: values.notes || null,
    created_by: values.created_by || null,
  } as never);

  return { error: result.error ? { message: result.error.message } : null };
}

async function loadTeam(orgId: string) {
  const admin = createAdminClient();
  const [membersResult, profilesResult, employeesResult] = await Promise.all([
    admin.from("org_members").select("user_id, role, org_id").eq("org_id", orgId).in("role", ["sales", "sales_manager"]),
    admin.from("profiles").select("user_id, full_name, email, phone, account_status").eq("org_id", orgId),
    admin.from("employees").select("id, user_id, national_id, status, job_title").eq("org_id", orgId),
  ]);

  if (membersResult.error) return { data: null, error: membersResult.error };
  if (profilesResult.error) return { data: null, error: profilesResult.error };
  if (employeesResult.error) return { data: null, error: employeesResult.error };

  const profiles = new Map(((profilesResult.data ?? []) as Record<string, unknown>[]).map((profile) => [String(profile.user_id), profile]));
  const employees = new Map(((employeesResult.data ?? []) as Record<string, unknown>[]).map((employee) => [String(employee.user_id), employee]));

  return {
    data: ((membersResult.data ?? []) as Record<string, unknown>[]).map((member) => {
      const userId = String(member.user_id || "");
      const profile = profiles.get(userId) || {};
      const employee = employees.get(userId) || {};
      return {
        user_id: userId,
        org_id: String(member.org_id || ""),
        role: String(member.role || ""),
        full_name: String(profile.full_name || profile.email || "بائع"),
        email: String(profile.email || ""),
        phone: typeof profile.phone === "string" ? profile.phone : null,
        national_id: typeof employee.national_id === "string" ? employee.national_id : null,
        status: String(profile.account_status || employee.status || "active"),
        employee_id: String(employee.id || ""),
      };
    }),
    error: null,
  };
}

export async function GET() {
  const auth = await requireSalesAccess({ managerOnly: true });
  if ("error" in auth) return auth.error;

  const result = await loadTeam(auth.orgId);
  if (result.error) return NextResponse.json({ message: result.error.message }, { status: 500 });
  return NextResponse.json({ data: result.data });
}

export async function POST(request: NextRequest) {
  const auth = await requireSalesAccess({ managerOnly: true });
  if ("error" in auth) return auth.error;

  const body = await request.json().catch(() => ({}));
  const fullName = String(body.full_name || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const phone = String(body.phone || "").trim();
  const nationalId = String(body.national_id || "").trim();
  const requestedRole = String(body.role || "sales").trim().toLowerCase();
  const salesRole = requestedRole === "sales_manager" ? "sales_manager" : "sales";
  const salesTitle = salesRole === "sales_manager" ? "Sales Manager" : "Sales";

  if (fullName.length < 2) return NextResponse.json({ message: "اسم البائع مطلوب." }, { status: 400 });
  if (!email.includes("@")) return NextResponse.json({ message: "بريد إلكتروني صحيح مطلوب." }, { status: 400 });
  if (password.length < 8) return NextResponse.json({ message: "كلمة المرور يجب ألا تقل عن 8 أحرف." }, { status: 400 });

  const admin = createAdminClient();
  const existing = await getAuthUserByEmail(email);

  if (existing) {
    const { data: membership } = await admin
      .from("org_members")
      .select("org_id, role")
      .eq("user_id", existing.id)
      .maybeSingle();
    const member = membership as Record<string, unknown> | null;
    if (member && String(member.org_id || "") !== auth.orgId) {
      return NextResponse.json({ message: "هذا البريد مرتبط بمنظمة أخرى." }, { status: 409 });
    }
  }

  const authResult = existing
    ? await admin.auth.admin.updateUserById(existing.id, {
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName },
      })
    : await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName },
      });

  if (authResult.error || !authResult.data.user) {
    return NextResponse.json({ message: authResult.error?.message || "تعذر إنشاء الحساب." }, { status: 500 });
  }

  const userId = authResult.data.user.id;
  const profileError = (await admin.from("profiles").upsert({
    user_id: userId,
    org_id: auth.orgId,
    full_name: fullName,
    email,
    phone: phone || null,
    title: salesTitle,
    account_status: "active",
  } as never, { onConflict: "user_id" })).error;
  if (profileError) return NextResponse.json({ message: profileError.message }, { status: 500 });

  const memberError = (await admin.from("org_members").upsert({
    org_id: auth.orgId,
    user_id: userId,
    role: salesRole,
  } as never, { onConflict: "org_id,user_id" })).error;
  if (memberError) return NextResponse.json({ message: memberError.message }, { status: 500 });

  const employeeResult = await admin
    .from("employees")
    .select("id, job_title")
    .eq("org_id", auth.orgId)
    .eq("user_id", userId)
    .maybeSingle();

  if (employeeResult.error) return NextResponse.json({ message: employeeResult.error.message }, { status: 500 });

  if (employeeResult.data) {
    const employeeRecord = employeeResult.data as Record<string, unknown>;
    const previousTitle = String(employeeRecord.job_title || "");
    const updateError = (await admin.from("employees").update({
      full_name: fullName,
      email,
      phone: phone || null,
      national_id: nationalId || null,
      job_title: salesTitle,
      status: "Active",
    } as never).eq("id", String(employeeRecord.id))).error;
    if (updateError) return NextResponse.json({ message: updateError.message }, { status: 500 });

    if (previousTitle && previousTitle !== salesTitle) {
      const eventResult = await recordSalesCareerEvent(admin, {
        employee_id: String(employeeRecord.id || ""),
        event_type: salesRole === "sales_manager" ? "promoted" : "role_change",
        previous_value: { job_title: previousTitle },
        new_value: { job_title: salesTitle, sales_role: salesRole },
        notes: salesRole === "sales_manager" ? "Promotion to Sales Manager" : "Sales role changed",
        created_by: auth.user.id,
      });
      if (eventResult.error) return NextResponse.json({ message: eventResult.error.message }, { status: 500 });
    }
  } else {
    const createResult = await admin.from("employees").insert({
      org_id: auth.orgId,
      user_id: userId,
      full_name: fullName,
      email,
      phone: phone || null,
      national_id: nationalId || null,
      job_title: salesTitle,
      status: "Active",
    } as never).select("id").single();
    if (createResult.error) return NextResponse.json({ message: createResult.error.message }, { status: 500 });

    const eventResult = await recordSalesCareerEvent(admin, {
      employee_id: String((createResult.data as Record<string, unknown> | null)?.id || ""),
      event_type: "hired",
      previous_value: null,
      new_value: { job_title: salesTitle, sales_role: salesRole },
      notes: "Sales team member created",
      created_by: auth.user.id,
    });
    if (eventResult.error) return NextResponse.json({ message: eventResult.error.message }, { status: 500 });
  }

  const team = await loadTeam(auth.orgId);
  if (team.error) return NextResponse.json({ message: team.error.message }, { status: 500 });
  const created = (team.data || []).find((agent) => agent.user_id === userId) || null;
  return NextResponse.json({ data: created });
}

export async function PATCH(request: NextRequest) {
  const auth = await requireSalesAccess({ managerOnly: true });
  if ("error" in auth) return auth.error;

  const body = await request.json().catch(() => ({}));
  const userId = String(body.user_id || "").trim();
  if (!userId) return NextResponse.json({ message: "معرف البائع مطلوب." }, { status: 400 });

  const admin = createAdminClient();
  const memberResult = await admin
    .from("org_members")
    .select("org_id, role")
    .eq("org_id", auth.orgId)
    .eq("user_id", userId)
    .in("role", ["sales", "sales_manager"])
    .maybeSingle();

  if (memberResult.error) return NextResponse.json({ message: memberResult.error.message }, { status: 500 });
  if (!memberResult.data) return NextResponse.json({ message: "البائع غير موجود داخل منظمتك." }, { status: 404 });

  const previousRole = String((memberResult.data as Record<string, unknown>).role || "");
  const employeeResult = await admin
    .from("employees")
    .select("id, job_title")
    .eq("org_id", auth.orgId)
    .eq("user_id", userId)
    .maybeSingle();

  if (employeeResult.error) return NextResponse.json({ message: employeeResult.error.message }, { status: 500 });

  const employeeRecord = (employeeResult.data || null) as Record<string, unknown> | null;
  const employeeId = String(employeeRecord?.id || "");
  const previousTitle = String(employeeRecord?.job_title || (previousRole === "sales_manager" ? "Sales Manager" : "Sales"));

  const fullName = String(body.full_name || "").trim();
  const phone = String(body.phone || "").trim();
  const nationalId = String(body.national_id || "").trim();
  const status = String(body.status || "").trim().toLowerCase();
  const requestedRole = String(body.role || "").trim().toLowerCase();
  const nextRole = requestedRole === "sales" || requestedRole === "sales_manager" ? requestedRole : "";
  const profileValues: Record<string, unknown> = {};
  const employeeValues: Record<string, unknown> = {};

  if (fullName) {
    profileValues.full_name = fullName;
    employeeValues.full_name = fullName;
  }
  if ("phone" in body) {
    profileValues.phone = phone || null;
    employeeValues.phone = phone || null;
  }
  if ("national_id" in body) employeeValues.national_id = nationalId || null;
  if (status) {
    const active = status === "active" || status === "نشط";
    profileValues.account_status = active ? "active" : "inactive";
    employeeValues.status = active ? "Active" : "Inactive";
  }
  if (nextRole) {
    const title = nextRole === "sales_manager" ? "Sales Manager" : "Sales";
    profileValues.title = title;
    employeeValues.job_title = title;
  }

  if (nextRole) {
    const memberError = (await admin
      .from("org_members")
      .update({ role: nextRole } as never)
      .eq("org_id", auth.orgId)
      .eq("user_id", userId)
      .in("role", ["sales", "sales_manager"])).error;
    if (memberError) return NextResponse.json({ message: memberError.message }, { status: 500 });
  }

  if (Object.keys(profileValues).length > 0) {
    const profileError = (await admin.from("profiles").update(profileValues as never).eq("user_id", userId).eq("org_id", auth.orgId)).error;
    if (profileError) return NextResponse.json({ message: profileError.message }, { status: 500 });
  }

  if (Object.keys(employeeValues).length > 0) {
    const employeeError = (await admin.from("employees").update(employeeValues as never).eq("user_id", userId).eq("org_id", auth.orgId)).error;
    if (employeeError) return NextResponse.json({ message: employeeError.message }, { status: 500 });
  }

  if (nextRole && nextRole !== previousRole && employeeId) {
    const title = nextRole === "sales_manager" ? "Sales Manager" : "Sales";
    const eventResult = await recordSalesCareerEvent(admin, {
      employee_id: employeeId,
      event_type: nextRole === "sales_manager" ? "promoted" : "role_change",
      previous_value: { sales_role: previousRole, job_title: previousTitle },
      new_value: { sales_role: nextRole, job_title: title },
      notes: nextRole === "sales_manager" ? "Promotion to Sales Manager" : "Sales role changed",
      created_by: auth.user.id,
    });
    if (eventResult.error) return NextResponse.json({ message: eventResult.error.message }, { status: 500 });
  }

  const team = await loadTeam(auth.orgId);
  if (team.error) return NextResponse.json({ message: team.error.message }, { status: 500 });
  const updated = (team.data || []).find((agent) => agent.user_id === userId) || null;
  return NextResponse.json({ data: updated });
}
