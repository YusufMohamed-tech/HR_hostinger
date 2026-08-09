import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantContext } from "@/lib/server/tenant-context";
import { getMissingEmployeeFields } from "@/lib/employee-profile-completion";

type RpcClient = {
  rpc: (name: string, args: Record<string, unknown>) => Promise<{
    data: unknown;
    error: { message: string; code?: string } | null;
  }>;
};

const employeeCompletionSelect = [
  "id", "org_id", "user_id", "employee_code", "full_name", "full_name_ar", "full_name_en",
  "email", "phone", "address", "work_city", "national_address_code", "emergency_contact_name",
  "emergency_contact_phone", "national_id", "date_of_birth", "date_of_birth_hijri", "gender",
  "hiring_date", "department_id", "job_title", "manager_id", "location_id", "company_id", "project_id",
  "city", "province", "employment_type", "status", "base_salary", "bonus", "deductions",
  "leave_balance_manual_adjustment", "leave_accrual_start_date", "payment_method", "bank_account",
  "bank_account_name", "bank_name", "iban", "education_level", "lifecycle_status", "lifecycle_version",
  "onboarding_status", "onboarding_progress", "onboarding_due_at", "can_multi_checkin", "carrier_supervisor_id",
  "employee_locations(location_id,is_primary,assigned_from,assigned_to)",
].join(",");

const updateSchema = z.object({
  item_id: z.string().uuid(),
  action: z.enum([
    "request", "review", "verify", "reject", "waive",
    "not_applicable", "reopen", "set_due",
  ]),
  reason: z.string().trim().max(1000).nullable().optional(),
  due_at: z.string().date().nullable().optional(),
});

const createSchema = z.object({
  employee_id: z.string().uuid(),
  label_ar: z.string().trim().min(2).max(200),
  label_en: z.string().trim().max(200).nullable().optional(),
  category: z.enum(["identity", "contract", "compliance", "payroll", "attendance", "employment", "other"]).default("other"),
  evidence_kind: z.enum(["document", "form", "assignment", "approval", "none"]).default("document"),
  severity: z.enum(["required", "compliance", "capability", "recommended"]).default("required"),
  capability: z.enum(["general", "payroll", "payroll_payment", "attendance", "inventory", "sales", "accounting"]).nullable().optional(),
  due_at: z.string().date().nullable().optional(),
  employee_can_submit: z.boolean().default(true),
});

function errorStatus(code?: string) {
  if (code === "P0002") return 404;
  if (code === "42501") return 403;
  if (code === "22023" || code === "23514") return 422;
  return 500;
}

export async function GET(request: NextRequest) {
  const auth = await requireTenantContext({ feature: "hr" }, request);
  if ("error" in auth) return auth.error;

  const canManage = auth.capabilities.manage_people;
  if (!canManage && !auth.employeeId) {
    return NextResponse.json({ message: "Employee profile is required.", requestId: auth.requestId }, { status: 403 });
  }
  const requestedEmployeeId = request.nextUrl.searchParams.get("employee_id");
  const employeeId = canManage ? requestedEmployeeId : auth.employeeId;

  let employeeQuery = auth.admin
    .from("employees")
    .select("id, full_name, employee_code, email, lifecycle_status, onboarding_status, onboarding_progress, onboarding_due_at")
    .eq("org_id", auth.orgId)
    .in("lifecycle_status", ["active", "offboarding"]);
  if (employeeId) employeeQuery = employeeQuery.eq("id", employeeId);
  const employeeResult = await employeeQuery.order("full_name");
  if (employeeResult.error) {
    return NextResponse.json({ message: employeeResult.error.message, requestId: auth.requestId }, { status: 500 });
  }

  const employees = (employeeResult.data || []) as unknown as Array<Record<string, unknown>>;
  const refreshResults = await Promise.all(employees.map((employee) =>
    (auth.admin as unknown as RpcClient).rpc("refresh_employee_onboarding", {
      p_employee_id: String(employee.id),
    })
  ));
  const refreshError = refreshResults.find((result) => result.error)?.error;
  if (refreshError) {
    return NextResponse.json({ message: refreshError.message, requestId: auth.requestId }, { status: 500 });
  }
  const employeeIds = employees.map((employee) => String(employee.id));
  if (employeeIds.length === 0) {
    return NextResponse.json({
      data: { employees: [], cases: [], items: [], capabilities: [], canManage },
      requestId: auth.requestId,
    });
  }

  const [refreshedEmployees, cases, items, capabilities] = await Promise.all([
    auth.admin
      .from("employees")
      .select(employeeCompletionSelect)
      .eq("org_id", auth.orgId)
      .in("id", employeeIds)
      .order("full_name"),
    auth.admin
      .from("employee_onboarding_cases")
      .select("*")
      .eq("org_id", auth.orgId)
      .in("employee_id", employeeIds),
    auth.admin
      .from("employee_onboarding_items")
      .select("*")
      .eq("org_id", auth.orgId)
      .in("employee_id", employeeIds)
      .order("due_at"),
    auth.admin
      .from("employee_capability_readiness")
      .select("*")
      .eq("org_id", auth.orgId)
      .in("employee_id", employeeIds),
  ]);
  const dependencyError = refreshedEmployees.error || cases.error || items.error || capabilities.error;
  if (dependencyError) {
    return NextResponse.json({ message: dependencyError.message, requestId: auth.requestId }, { status: 500 });
  }

  return NextResponse.json({
    data: {
      employees: ((refreshedEmployees.data || []) as unknown as Array<Record<string, unknown>>).map((employee) => ({
        ...employee,
        missing_fields: getMissingEmployeeFields(employee),
      })),
      cases: cases.data || [],
      items: items.data || [],
      capabilities: capabilities.data || [],
      canManage,
    },
    requestId: auth.requestId,
  });
}

export async function PATCH(request: NextRequest) {
  const auth = await requireTenantContext({ feature: "hr", capability: "manage_people" }, request);
  if ("error" in auth) return auth.error;
  const parsed = updateSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({
      message: parsed.error.issues[0]?.message || "Invalid onboarding action.",
      requestId: auth.requestId,
    }, { status: 400 });
  }

  const result = await (auth.admin as unknown as RpcClient).rpc("update_employee_onboarding_item", {
    p_org_id: auth.orgId,
    p_actor_user_id: auth.user.id,
    p_request_id: auth.requestId,
    p_item_id: parsed.data.item_id,
    p_action: parsed.data.action,
    p_reason: parsed.data.reason || null,
    p_due_at: parsed.data.due_at || null,
    p_managed_file_id: null,
  });
  if (result.error) {
    return NextResponse.json({
      message: result.error.message,
      requestId: auth.requestId,
    }, { status: errorStatus(result.error.code) });
  }
  return NextResponse.json({
    data: Array.isArray(result.data) ? result.data[0] || null : result.data,
    requestId: auth.requestId,
  });
}

export async function POST(request: NextRequest) {
  const auth = await requireTenantContext({ feature: "hr", capability: "manage_people" }, request);
  if ("error" in auth) return auth.error;
  const parsed = createSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({
      message: parsed.error.issues[0]?.message || "Invalid employee requirement.",
      requestId: auth.requestId,
    }, { status: 400 });
  }
  const result = await (auth.admin as unknown as RpcClient).rpc("create_employee_onboarding_requirement", {
    p_org_id: auth.orgId,
    p_actor_user_id: auth.user.id,
    p_request_id: auth.requestId,
    p_employee_id: parsed.data.employee_id,
    p_label_ar: parsed.data.label_ar,
    p_label_en: parsed.data.label_en || null,
    p_category: parsed.data.category,
    p_evidence_kind: parsed.data.evidence_kind,
    p_severity: parsed.data.severity,
    p_capability: parsed.data.capability || null,
    p_due_at: parsed.data.due_at || null,
    p_employee_can_submit: parsed.data.employee_can_submit,
  });
  if (result.error) {
    return NextResponse.json({
      message: result.error.message,
      requestId: auth.requestId,
    }, { status: errorStatus(result.error.code) });
  }
  return NextResponse.json({
    data: Array.isArray(result.data) ? result.data[0] || null : result.data,
    requestId: auth.requestId,
  }, { status: 201 });
}
