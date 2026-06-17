import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireSalesAccess } from "@/lib/server/sales-auth";
import { formatCurrency } from "@/lib/utils/currency";

type AuthContext = {
  user: { id: string; email?: string | null };
  orgId: string;
  role: string;
};

type PromptType = "hourly" | "mid_shift" | "end_shift";

type QueryError = { message: string };
type SingleResult<T> = { data: T | null; error: QueryError | null };
type EmptyResult = { error: QueryError | null };

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
};

function toNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value: number) {
  return formatCurrency(value);
}

function riyadhNow() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Riyadh",
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

function promptPayload(type: PromptType, key: string, context: MonitorContext) {
  const base = {
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

async function notifyRecipients(
  admin: ReturnType<typeof createAdminClient>,
  context: MonitorContext,
  values: { title: string; body: string; link?: string; excludeUserId?: string }
) {
  const [companyManagersResult, orgManagersResult] = await Promise.all([
    admin
      .from("sales_company_assignments")
      .select("user_id")
      .eq("organization_id", context.organizationId)
      .eq("company_id", context.companyId)
      .eq("assignment_role", "manager")
      .eq("is_active", true),
    admin
      .from("org_members")
      .select("user_id, role")
      .eq("org_id", context.organizationId)
      .in("role", ["hr_admin", "admin"]),
  ]);

  const recipients = Array.from(new Set([
    ...(((companyManagersResult.data ?? []) as Record<string, unknown>[]).map((row) => String(row.user_id || ""))),
    ...(((orgManagersResult.data ?? []) as Record<string, unknown>[]).map((row) => String(row.user_id || ""))),
  ].filter((userId) => userId && userId !== values.excludeUserId)));

  if (recipients.length === 0) return;

  await admin.from("notifications").insert(recipients.map((userId) => ({
    org_id: context.organizationId,
    user_id: userId,
    title: values.title,
    body: values.body,
    type: "sales",
    link: values.link || `/sales/reports?agent=${context.userId}&company=${context.companyId}&date_from=${context.promptDate}&date_to=${context.promptDate}`,
    is_read: false,
  })) as never);
}

async function notifySalesAgent(
  admin: ReturnType<typeof createAdminClient>,
  context: MonitorContext,
  values: { title: string; body: string; link?: string }
) {
  await admin.from("notifications").insert({
    org_id: context.organizationId,
    user_id: context.userId,
    title: values.title,
    body: values.body,
    type: "sales",
    link: values.link || `/sales/log?company_id=${context.companyId}`,
    is_read: false,
  } as never);
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
  const match = {
    organization_id: context.organizationId,
    sales_agent_id: context.userId,
    company_id: context.companyId,
    prompt_date: context.promptDate,
    prompt_type: type,
    prompt_key: key,
  };

  const existingResult = await admin
    .from("sales_shift_prompts")
    .select("*")
    .match(match)
    .maybeSingle() as unknown as SingleResult<Record<string, unknown>>;

  if (existingResult.error) throw existingResult.error;

  let row = existingResult.data as Record<string, unknown> | null;
  const firstTime = !row;

  if (!row) {
    const insertResult = await admin
      .from("sales_shift_prompts")
      .insert({
        ...match,
        employee_id: context.employeeId,
        shift_id: context.shiftId,
        target_amount: context.targetAmount,
        achieved_amount: context.achievedAmount,
        required_percent: type === "mid_shift" ? 40 : type === "end_shift" ? 100 : 0,
        action: "shown",
      } as never)
      .select("*")
      .single() as unknown as SingleResult<Record<string, unknown>>;
    if (insertResult.error) throw insertResult.error;
    row = insertResult.data as Record<string, unknown>;
  } else {
    const updateResult = await admin
      .from("sales_shift_prompts")
      .update({
        target_amount: context.targetAmount,
        achieved_amount: context.achievedAmount,
        required_percent: type === "mid_shift" ? 40 : type === "end_shift" ? 100 : 0,
      } as never)
      .eq("id", String(row.id))
      .select("*")
      .single() as unknown as SingleResult<Record<string, unknown>>;
    if (!updateResult.error && updateResult.data) row = updateResult.data as Record<string, unknown>;
  }

  if (firstTime && type === "mid_shift") {
    await notifySalesAgent(admin, context, {
      title: "تنبيه هدف المبيعات",
      body: `لم تصل إلى 40% من هدف ${context.companyName}. الحالي ${context.progressPercent}%.`,
    });
  }

  if (firstTime && type === "end_shift") {
    await notifyRecipients(admin, context, {
      title: `لم يحقق ${context.agentName} هدف المبيعات`,
      body: `حقق ${money(context.achievedAmount)} من أصل ${money(context.targetAmount)} قبل نهاية الوردية.`,
      excludeUserId: context.userId,
    });
  }

  if (shouldSuppressPrompt(row, type)) return null;
  return promptPayload(type, key, context);
}

function getDailyTarget(assignment: Record<string, unknown>) {
  const assignmentTarget = toNumber(assignment.daily_target);
  return assignmentTarget > 0 ? assignmentTarget : 0;
}

async function buildMonitorData(request: NextRequest, auth: AuthContext) {
  const now = riyadhNow();
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
  const auth = await requireSalesAccess();
  if ("error" in auth) return auth.error;

  try {
    const data = await buildMonitorData(request, auth);
    return NextResponse.json({ data });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "تعذر تحميل تنبيهات المبيعات." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireSalesAccess();
  if ("error" in auth) return auth.error;
  if (auth.role !== "sales" && auth.role !== "sales_manager") {
    return NextResponse.json({ message: "هذا الإجراء متاح لفريق المبيعات فقط." }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const promptType = String(body.prompt_type || "") as PromptType;
  const promptKey = String(body.prompt_key || "").trim();
  const companyId = String(body.company_id || "").trim();
  const action = String(body.action || "").trim();
  const reason = String(body.reason || "").trim();
  const now = riyadhNow();

  if (!["hourly", "mid_shift", "end_shift"].includes(promptType) || !promptKey || !companyId) {
    return NextResponse.json({ message: "بيانات التنبيه غير مكتملة." }, { status: 400 });
  }

  if (action === "submit_reason" && reason.length < 5) {
    return NextResponse.json({ message: "اكتب سببًا واضحًا قبل الإرسال." }, { status: 400 });
  }

  const admin = createAdminClient();
  const promptResult = await admin
    .from("sales_shift_prompts")
    .select("*")
    .eq("organization_id", auth.orgId)
    .eq("sales_agent_id", auth.user.id)
    .eq("company_id", companyId)
    .eq("prompt_date", now.date)
    .eq("prompt_type", promptType)
    .eq("prompt_key", promptKey)
    .maybeSingle() as unknown as SingleResult<Record<string, unknown>>;

  if (promptResult.error) return NextResponse.json({ message: promptResult.error.message }, { status: 500 });
  if (!promptResult.data) return NextResponse.json({ message: "لم يتم العثور على التنبيه." }, { status: 404 });

  const updateValues: Record<string, unknown> = {};
  if (action === "snooze") {
    updateValues.action = "snoozed";
    updateValues.snoozed_until = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  } else if (action === "submit_reason") {
    updateValues.action = "submitted_reason";
    updateValues.reason = reason;
    updateValues.reason_submitted_at = new Date().toISOString();
    updateValues.snoozed_until = null;
  } else {
    updateValues.action = "acknowledged";
    updateValues.snoozed_until = null;
  }

  const updateResult = await admin
    .from("sales_shift_prompts")
    .update(updateValues as never)
    .eq("id", String((promptResult.data as Record<string, unknown>).id)) as unknown as EmptyResult;

  if (updateResult.error) return NextResponse.json({ message: updateResult.error.message }, { status: 500 });

  if (action === "submit_reason") {
    const fakeRequest = new NextRequest(new URL(`/api/sales/shift-monitor?company_id=${companyId}`, request.url));
    const data = await buildMonitorData(fakeRequest, auth);
    const context: MonitorContext = {
      organizationId: auth.orgId,
      userId: auth.user.id,
      employeeId: null,
      agentName: String(auth.user.email || "Sales"),
      companyId,
      companyName: data.company?.name || "شركة المبيعات",
      company: data.company as unknown as Record<string, unknown>,
      shiftId: data.shift?.id || null,
      shift: data.shift as unknown as Record<string, unknown> | null,
      promptDate: now.date,
      targetAmount: data.target_amount,
      achievedAmount: data.achieved_amount,
      progressPercent: data.progress_percent,
      remainingAmount: data.remaining_amount,
      elapsedMinutes: 0,
      durationMinutes: 0,
      minutesUntilEnd: 0,
    };
    await notifyRecipients(admin, context, {
      title: `سبب عدم تحقيق هدف المبيعات`,
      body: reason,
      excludeUserId: auth.user.id,
    });
  }

  const nextData = await buildMonitorData(request, auth);
  return NextResponse.json({ data: nextData });
}
