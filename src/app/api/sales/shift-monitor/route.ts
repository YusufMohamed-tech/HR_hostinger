import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireSalesAccess } from "@/lib/server/sales-auth";
import { formatCurrency } from "@/lib/utils/currency";

type AuthContext = {
  user: { id: string; email?: string | null };
  orgId: string;
  role: string;
  timezone: string;
  requestId: string;
};

type PromptType = "hourly" | "mid_shift" | "end_shift";

type MonitorContext = {
  organizationId: string;
  userId: string;
  employeeId: string | null;
  agentName: string;
  companyId: string;
  companyName: string;
  company: Record<string, unknown>;
  shiftId: string | null;
  shift: Record<string, unknown> | null;
  promptDate: string;
  targetAmount: number;
  achievedAmount: number;
  progressPercent: number;
  remainingAmount: number;
  elapsedMinutes: number;
  durationMinutes: number;
  minutesUntilEnd: number;
  requestId: string;
};

function toNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value: number) {
  return formatCurrency(value);
}

function organizationNow(timezone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const byType = new Map(parts.map((part) => [part.type, part.value]));
  const hour = Number(byType.get("hour") || "0") % 24;
  const minute = Number(byType.get("minute") || "0");
  return {
    date: `${byType.get("year")}-${byType.get("month")}-${byType.get("day")}`,
    minutes: hour * 60 + minute,
  };
}

function validDate(value: unknown) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

function isActiveAssignment(assignment: Record<string, unknown>, today: string) {
  if (assignment.is_active === false) return false;
  const start = validDate(assignment.start_date) || today;
  const end = validDate(assignment.end_date);
  return start <= today && (!end || end >= today);
}

function minutesFromTime(value: unknown) {
  const text = String(value || "");
  const match = text.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return Math.max(0, Math.min(1439, hour * 60 + minute));
}

function calculateShiftWindow(shift: Record<string, unknown>, nowMinutes: number) {
  const start = minutesFromTime(shift.start_time);
  const end = minutesFromTime(shift.end_time);
  if (start === null || end === null) return null;

  const normalizedStart = start;
  let normalizedEnd = end;
  let normalizedNow = nowMinutes;

  if (normalizedEnd <= normalizedStart) {
    normalizedEnd += 1440;
    if (normalizedNow < start) normalizedNow += 1440;
  }

  const duration = Math.max(1, normalizedEnd - normalizedStart);
  const inShift = normalizedNow >= normalizedStart && normalizedNow <= normalizedEnd;

  return {
    inShift,
    elapsedMinutes: Math.max(0, normalizedNow - normalizedStart),
    durationMinutes: duration,
    minutesUntilEnd: Math.max(0, normalizedEnd - normalizedNow),
  };
}

function activeEmployeeShift(employee: Record<string, unknown>, today: string) {
  const rows = Array.isArray(employee.employee_shifts) ? employee.employee_shifts as Record<string, unknown>[] : [];
  return rows
    .filter((row) => isActiveAssignment(row, today))
    .sort((a, b) => String(b.start_date || "").localeCompare(String(a.start_date || "")))[0] || null;
}

function promptPayload(type: PromptType, key: string, context: MonitorContext, row: Record<string, unknown>) {
  const base = {
    id: String(row.id || ""),
    version: Math.max(1, toNumber(row.version)),
    type,
    key,
    company_id: context.companyId,
    company_name: context.companyName,
    target_amount: context.targetAmount,
    achieved_amount: context.achievedAmount,
    progress_percent: context.progressPercent,
    remaining_amount: context.remainingAmount,
    action_url: `/sales/log?company_id=${context.companyId}`,
    snooze_minutes: 15,
  };

  if (type === "end_shift") {
    return {
      ...base,
      title: "سبب عدم تحقيق هدف المبيعات مطلوب",
      body: `حققت ${money(context.achievedAmount)} من هدف ${money(context.targetAmount)}. اكتب سبب عدم تحقيق الهدف قبل نهاية الوردية.`,
      requires_reason: true,
    };
  }

  if (type === "mid_shift") {
    return {
      ...base,
      title: "تنبيه منتصف الوردية",
      body: `لم تصل بعد إلى 40% من هدف اليوم. الحالي ${context.progressPercent}% والمتبقي ${money(context.remainingAmount)}.`,
      requires_reason: false,
    };
  }

  return {
    ...base,
    title: "تسجيل مبيعات الساعة",
    body: `لو تمت مبيعات خلال الساعة الحالية سجلها الآن. الحالي ${money(context.achievedAmount)} من هدف ${money(context.targetAmount)}.`,
    requires_reason: false,
  };
}

function shouldSuppressPrompt(row: Record<string, unknown> | null, type: PromptType) {
  if (!row) return false;
  const action = String(row.action || "");
  const snoozedUntil = row.snoozed_until ? new Date(String(row.snoozed_until)) : null;
  if (snoozedUntil && snoozedUntil.getTime() > Date.now()) return true;
  if (type === "end_shift") return action === "submitted_reason";
  return action === "acknowledged" || action === "submitted_reason";
}

async function ensurePrompt(
  admin: ReturnType<typeof createAdminClient>,
  type: PromptType,
  key: string,
  context: MonitorContext
) {
  const { data, error } = await admin.rpc("ensure_sales_shift_prompt_atomic", {
    p_org_id: context.organizationId,
    p_actor_user_id: context.userId,
    p_request_id: context.requestId,
    p_company_id: context.companyId,
    p_employee_id: context.employeeId,
    p_shift_id: context.shiftId,
    p_prompt_date: context.promptDate,
    p_prompt_type: type,
    p_prompt_key: key,
    p_target_amount: context.targetAmount,
    p_achieved_amount: context.achievedAmount,
    p_required_percent: type === "mid_shift" ? 40 : type === "end_shift" ? 100 : 0,
  });
  if (error) throw new Error(error.message);
  const row = data && typeof data === "object" && !Array.isArray(data)
    ? data as Record<string, unknown>
    : null;
  if (!row?.id) throw new Error("Shift prompt command returned no prompt.");

  if (shouldSuppressPrompt(row, type)) return null;
  return promptPayload(type, key, context, row);
}

function getDailyTarget(assignment: Record<string, unknown>) {
  const assignmentTarget = toNumber(assignment.daily_target);
  return assignmentTarget > 0 ? assignmentTarget : 0;
}

async function buildMonitorData(request: NextRequest, auth: AuthContext) {
  const now = organizationNow(auth.timezone);
  const admin = createAdminClient();

  if (auth.role !== "sales" && auth.role !== "sales_manager") {
    return {
      inShift: false,
      company: null,
      shift: null,
      target_amount: 0,
      achieved_amount: 0,
      progress_percent: 0,
      remaining_amount: 0,
      prompt: null,
    };
  }

  const employeeResult = await admin
    .from("employees")
    .select("id, full_name, employee_shifts(id, shift_id, start_date, end_date, is_active, shift:shift_id(id, name, start_time, end_time))")
    .eq("org_id", auth.orgId)
    .eq("user_id", auth.user.id)
    .maybeSingle();

  if (employeeResult.error) throw employeeResult.error;
  const employee = (employeeResult.data || {}) as Record<string, unknown>;
  const activeShift = activeEmployeeShift(employee, now.date);
  const shift = (activeShift?.shift || null) as Record<string, unknown> | null;
  const window = shift ? calculateShiftWindow(shift, now.minutes) : null;

  if (!shift || !window?.inShift) {
    return {
      inShift: false,
      company: null,
      shift: shift ? {
        id: String(shift.id || ""),
        name: String(shift.name || ""),
        start_time: String(shift.start_time || ""),
        end_time: String(shift.end_time || ""),
      } : null,
      target_amount: 0,
      achieved_amount: 0,
      progress_percent: 0,
      remaining_amount: 0,
      prompt: null,
    };
  }

  const requestedCompanyId = String(request.nextUrl.searchParams.get("company_id") || "").trim();
  const assignmentsResult = await admin
    .from("sales_company_assignments")
    .select("id, company_id, assignment_role, start_date, end_date, daily_target, target_notes, is_active, company:company_id(id, name, slug, code, brand_color, is_active)")
    .eq("organization_id", auth.orgId)
    .eq("user_id", auth.user.id)
    .eq("is_active", true);

  if (assignmentsResult.error) throw assignmentsResult.error;

  const assignments = ((assignmentsResult.data ?? []) as Record<string, unknown>[])
    .filter((assignment) => isActiveAssignment(assignment, now.date))
    .filter((assignment) => {
      const company = assignment.company as Record<string, unknown> | null;
      return company?.is_active !== false;
    });

  const selectedAssignment = assignments.find((assignment) => String(assignment.company_id || "") === requestedCompanyId) || assignments[0] || null;
  if (!selectedAssignment) {
    return {
      inShift: true,
      company: null,
      shift: {
        id: String(shift.id || ""),
        name: String(shift.name || ""),
        start_time: String(shift.start_time || ""),
        end_time: String(shift.end_time || ""),
      },
      target_amount: 0,
      achieved_amount: 0,
      progress_percent: 0,
      remaining_amount: 0,
      prompt: null,
    };
  }

  const company = (selectedAssignment.company || {}) as Record<string, unknown>;
  const companyId = String(selectedAssignment.company_id || "");
  const targetAmount = getDailyTarget(selectedAssignment);

  const logsResult = await admin
    .from("sales_logs")
    .select("grand_total")
    .eq("organization_id", auth.orgId)
    .eq("sales_agent_id", auth.user.id)
    .eq("company_id", companyId)
    .eq("log_date", now.date);

  if (logsResult.error) throw logsResult.error;

  const achievedAmount = Number(((logsResult.data ?? []) as Record<string, unknown>[])
    .reduce((sum, log) => sum + toNumber(log.grand_total), 0)
    .toFixed(2));
  const progressPercent = targetAmount > 0 ? Math.min(999, Math.round((achievedAmount / targetAmount) * 100)) : 0;
  const remainingAmount = Math.max(0, Number((targetAmount - achievedAmount).toFixed(2)));
  const context: MonitorContext = {
    organizationId: auth.orgId,
    userId: auth.user.id,
    employeeId: String(employee.id || "") || null,
    agentName: String(employee.full_name || auth.user.email || "Sales"),
    companyId,
    companyName: String(company.name || "شركة المبيعات"),
    company,
    shiftId: String(activeShift?.shift_id || shift.id || "") || null,
    shift,
    promptDate: now.date,
    targetAmount,
    achievedAmount,
    progressPercent,
    remainingAmount,
    requestId: auth.requestId,
    ...window,
  };

  let prompt = null;
  if (targetAmount > 0 && achievedAmount < targetAmount && context.minutesUntilEnd <= 60) {
    prompt = await ensurePrompt(admin, "end_shift", `end-${context.shiftId || "shift"}`, context);
  } else if (
    targetAmount > 0 &&
    achievedAmount < targetAmount * 0.4 &&
    context.elapsedMinutes >= context.durationMinutes / 2
  ) {
    prompt = await ensurePrompt(admin, "mid_shift", `mid-${context.shiftId || "shift"}`, context);
  } else {
    const hourNumber = Math.max(1, Math.floor(context.elapsedMinutes / 60) + 1);
    prompt = await ensurePrompt(admin, "hourly", `hour-${context.shiftId || "shift"}-${hourNumber}`, context);
  }

  return {
    inShift: true,
    company: {
      id: companyId,
      organization_id: auth.orgId,
      name: String(company.name || ""),
      slug: String(company.slug || ""),
      code: typeof company.code === "string" ? company.code : null,
      brand_color: typeof company.brand_color === "string" ? company.brand_color : null,
      is_active: company.is_active !== false,
    },
    shift: {
      id: String(shift.id || ""),
      name: String(shift.name || ""),
      start_time: String(shift.start_time || ""),
      end_time: String(shift.end_time || ""),
    },
    target_amount: targetAmount,
    achieved_amount: achievedAmount,
    progress_percent: progressPercent,
    remaining_amount: remainingAmount,
    prompt,
  };
}

export async function GET(request: NextRequest) {
  const auth = await requireSalesAccess(undefined, request);
  if ("error" in auth) return auth.error;

  try {
    const data = await buildMonitorData(request, auth);
    return NextResponse.json({ data });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "تعذر تحميل تنبيهات المبيعات." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireSalesAccess(undefined, request);
  if ("error" in auth) return auth.error;
  if (auth.role !== "sales" && auth.role !== "sales_manager") {
    return NextResponse.json({ message: "هذا الإجراء متاح لفريق المبيعات فقط." }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const promptType = String(body.prompt_type || "") as PromptType;
  const promptKey = String(body.prompt_key || "").trim();
  const companyId = String(body.company_id || "").trim();
  const promptId = String(body.prompt_id || "").trim();
  const commandId = String(body.command_id || "").trim();
  const expectedVersion = Number(body.expected_version || 0);
  const action = String(body.action || "").trim();
  const reason = String(body.reason || "").trim();

  if (!["hourly", "mid_shift", "end_shift"].includes(promptType) || !promptKey || !companyId
      || !/^[0-9a-f-]{36}$/i.test(promptId) || !/^[0-9a-f-]{36}$/i.test(commandId)
      || !Number.isInteger(expectedVersion) || expectedVersion < 1) {
    return NextResponse.json({ message: "بيانات التنبيه غير مكتملة." }, { status: 400 });
  }

  if (action === "submit_reason" && reason.length < 5) {
    return NextResponse.json({ message: "اكتب سببًا واضحًا قبل الإرسال." }, { status: 400 });
  }

  const { error } = await auth.admin.rpc("respond_sales_shift_prompt_atomic", {
    p_org_id: auth.orgId,
    p_actor_user_id: auth.user.id,
    p_request_id: auth.requestId,
    p_command_id: commandId,
    p_prompt_id: promptId,
    p_expected_version: expectedVersion,
    p_action: action,
    p_reason: reason || null,
    p_snooze_minutes: 15,
  });
  if (error) {
    const status = error.code === "P0002" ? 404
      : error.code === "40001" || error.code === "23505" || error.code === "55000" ? 409
        : error.code === "42501" ? 403 : error.code === "22023" || error.code === "23514" ? 400 : 500;
    return NextResponse.json({ message: error.message, requestId: auth.requestId }, { status });
  }

  const nextData = await buildMonitorData(request, auth);
  return NextResponse.json({ data: nextData });
}
