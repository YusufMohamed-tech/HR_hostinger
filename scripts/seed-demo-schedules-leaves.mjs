import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import dotenv from "dotenv";

const envPath = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
const projectRef =
  process.env.SUPABASE_PROJECT_REF ||
  supabaseUrl?.match(/^https:\/\/([^.]+)\.supabase\.co/i)?.[1];
const orgSlug = process.env.INITIAL_ORG_SLUG || "tatwir-talent";
const scheduleAssignmentCount = Number(process.env.SEED_DEMO_SCHEDULE_ASSIGNMENT_COUNT || 160);
const leaveRequestCount = Number(process.env.SEED_DEMO_LEAVE_REQUEST_COUNT || 120);

if (!projectRef || !accessToken) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL/SUPABASE_PROJECT_REF or SUPABASE_ACCESS_TOKEN in .env.local");
  process.exit(1);
}

const shiftTemplates = [
  { name: "عرض - صباحي الرياض", shift_type: "morning", start_time: "08:00", end_time: "16:00" },
  { name: "عرض - صباحي جدة", shift_type: "morning", start_time: "09:00", end_time: "17:00" },
  { name: "عرض - صباحي الدمام", shift_type: "morning", start_time: "07:30", end_time: "15:30" },
  { name: "عرض - مسائي الرياض", shift_type: "night", start_time: "14:00", end_time: "22:00" },
  { name: "عرض - مسائي جدة", shift_type: "night", start_time: "15:00", end_time: "23:00" },
  { name: "عرض - مسائي الدمام", shift_type: "night", start_time: "16:00", end_time: "00:00" },
  { name: "عرض - مرن المبيعات", shift_type: "flexible", start_time: "10:00", end_time: "18:00" },
  { name: "عرض - مرن التدريب", shift_type: "flexible", start_time: "11:00", end_time: "19:00" },
  { name: "عرض - مواقع ميدانية", shift_type: "morning", start_time: "12:00", end_time: "20:00" },
  { name: "عرض - دعم نهاية الأسبوع", shift_type: "flexible", start_time: "13:00", end_time: "21:00" },
  { name: "عرض - وردية فروع", shift_type: "morning", start_time: "08:30", end_time: "16:30" },
  { name: "عرض - وردية معارض", shift_type: "night", start_time: "17:00", end_time: "01:00" },
];

const leaveTypes = ["vacation", "sick", "emergency"];
const leaveReasons = [
  "إجازة سنوية مخططة",
  "ظرف عائلي طارئ",
  "متابعة طبية",
  "راحة بعد مهمة ميدانية",
  "تسوية رصيد إجازات",
  "مراجعة مستندات شخصية",
  "إجازة قصيرة قبل نهاية الأسبوع",
  "مرافقة أحد أفراد الأسرة",
];

const leaveScenarios = [
  { status: "pending", current_step: 1, manager_approval_status: "pending", hr_approval_status: "pending", label: "بانتظار المدير" },
  { status: "pending", current_step: 2, manager_approval_status: "approved", hr_approval_status: "pending", label: "بانتظار HR" },
  { status: "approved", current_step: 2, manager_approval_status: "approved", hr_approval_status: "approved", label: "معتمدة" },
  { status: "rejected", current_step: 1, manager_approval_status: "rejected", hr_approval_status: "pending", label: "رفض المدير" },
  { status: "rejected", current_step: 2, manager_approval_status: "approved", hr_approval_status: "rejected", label: "رفض HR" },
];

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function jsonSql(value) {
  return sqlLiteral(JSON.stringify(value));
}

function dateInTimeZone(timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function addDays(dateString, days) {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function createdAtFor(baseDate, index, hour = 8) {
  const date = addDays(baseDate, -Math.floor(index / 10));
  const minute = String((index * 9) % 60).padStart(2, "0");
  return `${date}T${String(hour).padStart(2, "0")}:${minute}:00+03:00`;
}

function dateRange(baseDate, index) {
  const start = addDays(baseDate, (index % 35) - 10);
  const end = index % 4 === 0 ? addDays(start, 14 + (index % 10)) : null;
  return { start, end };
}

async function runSql(query) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Supabase SQL failed (${response.status}): ${text}`);
  }

  return text ? JSON.parse(text) : [];
}

async function getOrganization() {
  const rows = await runSql(`
    select id, name, slug
    from public.organizations
    where slug = ${sqlLiteral(orgSlug)}
    order by created_at
    limit 1;
  `);
  if (rows.length) return rows[0];

  const fallback = await runSql(`
    select id, name, slug
    from public.organizations
    order by created_at
    limit 1;
  `);
  if (!fallback.length) throw new Error("No organization found.");
  return fallback[0];
}

async function getHrUser(orgId) {
  const rows = await runSql(`
    select e.id as employee_id, e.user_id, e.full_name, e.email
    from public.employees e
    where e.org_id = ${sqlLiteral(orgId)}::uuid
      and e.user_id is not null
      and lower(e.email) = 'hr@tatwir.sa'
    order by e.created_at
    limit 1;
  `);
  if (rows.length) return rows[0];

  const fallback = await runSql(`
    select e.id as employee_id, e.user_id, e.full_name, e.email
    from public.employees e
    where e.org_id = ${sqlLiteral(orgId)}::uuid
      and e.user_id is not null
    order by e.created_at
    limit 1;
  `);
  if (!fallback.length) throw new Error("No HR user was found.");
  return fallback[0];
}

async function getEmployees(orgId) {
  const rows = await runSql(`
    select distinct on (coalesce(e.user_id::text, e.id::text))
      e.id,
      e.user_id,
      e.full_name,
      e.employee_code,
      e.email,
      e.hiring_date
    from public.employees e
    where e.org_id = ${sqlLiteral(orgId)}::uuid
    order by coalesce(e.user_id::text, e.id::text), e.full_name, e.employee_code nulls last, e.created_at
    limit 260;
  `);
  if (!rows.length) throw new Error("No employees were found.");
  return rows;
}

async function getLocations(orgId) {
  return runSql(`
    select id, name
    from public.locations
    where org_id = ${sqlLiteral(orgId)}::uuid
    order by name
    limit 30;
  `);
}

function buildSchedulePayload({ orgId, employees, locations, baseDate }) {
  const shifts = shiftTemplates.map((shift, index) => ({
    ...shift,
    org_id: orgId,
    location_id: locations.length ? locations[index % locations.length].id : null,
  }));

  const assignments = Array.from({ length: scheduleAssignmentCount }).map((_, index) => {
    const employee = employees[index % employees.length];
    const shift = shifts[index % shifts.length];
    const range = dateRange(baseDate, index);
    return {
      org_id: orgId,
      employee_id: employee.id,
      shift_name: shift.name,
      start_date: range.start,
      end_date: range.end,
      created_at: createdAtFor(baseDate, index, 7),
    };
  });

  return { shifts, assignments };
}

function buildLeavePayload({ orgId, employees, hrUser, baseDate }) {
  const leaveEmployees = employees.filter((employee) => employee.id !== hrUser.employee_id);
  const requests = Array.from({ length: leaveRequestCount }).map((_, index) => {
    const employee = leaveEmployees[index % Math.max(1, leaveEmployees.length)];
    const scenario = leaveScenarios[index % leaveScenarios.length];
    const leaveType = leaveTypes[index % leaveTypes.length];
    const startDate = addDays(baseDate, (index % 45) - 18);
    const dayCount = 1 + (index % 5);
    const endDate = addDays(startDate, dayCount - 1);
    const requestedAt = createdAtFor(baseDate, index, 10);
    const decidedAt = scenario.status === "pending" ? null : `${addDays(baseDate, -Math.floor(index / 9))}T14:${String((index * 11) % 60).padStart(2, "0")}:00+03:00`;
    const reason = `بيانات عرض: ${leaveReasons[index % leaveReasons.length]} - ${scenario.label} ${String(index + 1).padStart(3, "0")}`;
    const history = [
      { step: 1, status: "submitted", at: requestedAt, by: employee.user_id || null },
    ];

    if (scenario.manager_approval_status === "approved") {
      history.push({ step: 1, status: "approved", at: requestedAt, by: hrUser.user_id || null, note: "موافقة المدير ضمن بيانات العرض" });
    }
    if (scenario.manager_approval_status === "rejected") {
      history.push({ step: 1, status: "rejected", at: decidedAt || requestedAt, by: hrUser.user_id || null, note: "رفض المدير ضمن بيانات العرض" });
    }
    if (scenario.hr_approval_status === "approved") {
      history.push({ step: 2, status: "approved", at: decidedAt || requestedAt, by: hrUser.user_id || null, note: "اعتماد HR ضمن بيانات العرض" });
    }
    if (scenario.hr_approval_status === "rejected") {
      history.push({ step: 2, status: "rejected", at: decidedAt || requestedAt, by: hrUser.user_id || null, note: "رفض HR ضمن بيانات العرض" });
    }

    return {
      org_id: orgId,
      employee_id: employee.id,
      leave_type: leaveType,
      status: scenario.status,
      start_date: startDate,
      end_date: endDate,
      day_count: dayCount,
      reason,
      requested_at: requestedAt,
      decided_at: decidedAt,
      decided_by: scenario.status === "pending" ? null : hrUser.user_id,
      decision_note: scenario.status === "pending" ? null : scenario.label,
      manager_approval_status: scenario.manager_approval_status,
      hr_approval_status: scenario.hr_approval_status,
      current_step: scenario.current_step,
      total_steps: 2,
      approval_history: history,
    };
  });

  const balanceEmployees = employees.slice(0, Math.min(120, employees.length));
  const balances = balanceEmployees.map((employee, index) => ({
    org_id: orgId,
    employee_id: employee.id,
    sick_remaining: 7 + (index % 5),
    vacation_remaining: 16 + (index % 12),
    emergency_remaining: 2 + (index % 3),
    accrual_start_date: addDays(baseDate, -180 - (index % 120)),
    vacation_accrued_days: 14 + (index % 10),
    manual_adjustment: (index % 5) - 2,
    transaction_amount: index % 2 === 0 ? 1 : -1,
    transaction_type: index % 2 === 0 ? "manual_adjustment" : "leave_deduction",
    transaction_reason: `بيانات عرض: حركة رصيد إجازات ${String(index + 1).padStart(3, "0")}`,
    created_by: hrUser.user_id,
    created_at: createdAtFor(baseDate, index, 12),
  }));

  return { requests, balances };
}

async function seedSchedules({ orgId, shifts, assignments }) {
  const rows = await runSql(`
    begin;

    delete from public.shifts
    where org_id = ${sqlLiteral(orgId)}::uuid
      and name like 'عرض - %';

    with shift_payload as (
      select *
      from jsonb_to_recordset(${jsonSql(shifts)}::jsonb) as shift_payload(
        org_id uuid,
        name text,
        shift_type text,
        start_time time,
        end_time time,
        location_id uuid
      )
    ),
    inserted_shifts as (
      insert into public.shifts (org_id, name, shift_type, start_time, end_time, location_id)
      select org_id, name, shift_type::public.shift_type, start_time, end_time, location_id
      from shift_payload
      returning id, name
    ),
    assignment_payload as (
      select *
      from jsonb_to_recordset(${jsonSql(assignments)}::jsonb) as assignment_payload(
        org_id uuid,
        employee_id uuid,
        shift_name text,
        start_date date,
        end_date date,
        created_at timestamptz
      )
    ),
    inserted_assignments as (
      insert into public.employee_shifts (org_id, employee_id, shift_id, start_date, end_date, created_at)
      select ap.org_id, ap.employee_id, s.id, ap.start_date, ap.end_date, ap.created_at
      from assignment_payload ap
      join inserted_shifts s on s.name = ap.shift_name
      returning id
    )
    select
      (select count(*)::int from inserted_shifts) as shifts,
      (select count(*)::int from inserted_assignments) as assignments;

    commit;
  `);

  return rows[0] || { shifts: 0, assignments: 0 };
}

async function seedLeaves({ orgId, requests, balances }) {
  const rows = await runSql(`
    begin;

    with demo_requests as (
      select id
      from public.leave_requests
      where org_id = ${sqlLiteral(orgId)}::uuid
        and reason like 'بيانات عرض:%'
    ),
    deleted_demo_transactions as (
      delete from public.leave_balance_transactions tx
      using demo_requests dr
      where tx.leave_request_id = dr.id
      returning tx.id
    )
    delete from public.leave_balance_transactions
    where org_id = ${sqlLiteral(orgId)}::uuid
      and reason like 'بيانات عرض:%';

    delete from public.leave_requests
    where org_id = ${sqlLiteral(orgId)}::uuid
      and reason like 'بيانات عرض:%';

    with balance_payload as (
      select *
      from jsonb_to_recordset(${jsonSql(balances)}::jsonb) as balance_payload(
        org_id uuid,
        employee_id uuid,
        sick_remaining integer,
        vacation_remaining integer,
        emergency_remaining integer,
        accrual_start_date date,
        vacation_accrued_days numeric,
        manual_adjustment numeric,
        transaction_amount numeric,
        transaction_type text,
        transaction_reason text,
        created_by uuid,
        created_at timestamptz
      )
    ),
    upserted_balances as (
      insert into public.leave_balances (
        org_id,
        employee_id,
        sick_remaining,
        vacation_remaining,
        emergency_remaining,
        accrual_start_date,
        vacation_accrued_days,
        manual_adjustment,
        last_accrual_calculated_at,
        updated_at
      )
      select
        org_id,
        employee_id,
        sick_remaining,
        vacation_remaining,
        emergency_remaining,
        accrual_start_date,
        vacation_accrued_days,
        manual_adjustment,
        now(),
        now()
      from balance_payload
      on conflict (org_id, employee_id)
      do update set
        sick_remaining = excluded.sick_remaining,
        vacation_remaining = excluded.vacation_remaining,
        emergency_remaining = excluded.emergency_remaining,
        accrual_start_date = excluded.accrual_start_date,
        vacation_accrued_days = excluded.vacation_accrued_days,
        manual_adjustment = excluded.manual_adjustment,
        last_accrual_calculated_at = excluded.last_accrual_calculated_at,
        updated_at = excluded.updated_at
      returning id, org_id, employee_id, vacation_remaining
    ),
    inserted_balance_transactions as (
      insert into public.leave_balance_transactions (
        org_id,
        employee_id,
        leave_balance_id,
        leave_type,
        transaction_type,
        amount,
        balance_before,
        balance_after,
        reason,
        created_by,
        created_at
      )
      select
        bp.org_id,
        bp.employee_id,
        ub.id,
        'vacation',
        bp.transaction_type,
        bp.transaction_amount,
        greatest(0, ub.vacation_remaining - bp.transaction_amount),
        ub.vacation_remaining,
        bp.transaction_reason,
        bp.created_by,
        bp.created_at
      from balance_payload bp
      join upserted_balances ub on ub.employee_id = bp.employee_id and ub.org_id = bp.org_id
      returning id
    ),
    request_payload as (
      select *
      from jsonb_to_recordset(${jsonSql(requests)}::jsonb) as request_payload(
        org_id uuid,
        employee_id uuid,
        leave_type text,
        status text,
        start_date date,
        end_date date,
        day_count integer,
        reason text,
        requested_at timestamptz,
        decided_at timestamptz,
        decided_by uuid,
        decision_note text,
        manager_approval_status text,
        hr_approval_status text,
        current_step integer,
        total_steps integer,
        approval_history jsonb
      )
    ),
    inserted_requests as (
      insert into public.leave_requests (
        org_id,
        employee_id,
        leave_type,
        status,
        start_date,
        end_date,
        reason,
        requested_at,
        decided_at,
        decided_by,
        decision_note,
        manager_approval_status,
        hr_approval_status,
        current_step,
        total_steps,
        approval_history
      )
      select
        org_id,
        employee_id,
        leave_type::public.leave_type,
        status::public.leave_status,
        start_date,
        end_date,
        reason,
        requested_at,
        decided_at,
        decided_by,
        decision_note,
        manager_approval_status,
        hr_approval_status,
        current_step,
        total_steps,
        approval_history
      from request_payload
      returning id, org_id, employee_id, leave_type, status, start_date, end_date, reason, decided_by
    ),
    inserted_request_deductions as (
      insert into public.leave_balance_transactions (
        org_id,
        employee_id,
        leave_balance_id,
        leave_request_id,
        leave_type,
        transaction_type,
        amount,
        balance_before,
        balance_after,
        reason,
        created_by,
        created_at
      )
      select
        ir.org_id,
        ir.employee_id,
        lb.id,
        ir.id,
        ir.leave_type::text,
        'leave_deduction',
        -1 * rp.day_count,
        coalesce(
          case ir.leave_type::text
            when 'vacation' then lb.vacation_remaining
            when 'sick' then lb.sick_remaining
            else lb.emergency_remaining
          end,
          0
        ) + rp.day_count,
        coalesce(
          case ir.leave_type::text
            when 'vacation' then lb.vacation_remaining
            when 'sick' then lb.sick_remaining
            else lb.emergency_remaining
          end,
          0
        ),
        'بيانات عرض: خصم طلب إجازة معتمد',
        ir.decided_by,
        coalesce(rp.decided_at, rp.requested_at)
      from inserted_requests ir
      join request_payload rp on rp.reason = ir.reason
      left join public.leave_balances lb on lb.org_id = ir.org_id and lb.employee_id = ir.employee_id
      where ir.status = 'approved'
      returning id
    )
    select
      (select count(*)::int from upserted_balances) as balances,
      (select count(*)::int from inserted_balance_transactions) as balance_transactions,
      (select count(*)::int from inserted_requests) as leave_requests,
      (select count(*)::int from inserted_request_deductions) as leave_deductions;

    commit;
  `);

  return rows[0] || { balances: 0, balance_transactions: 0, leave_requests: 0, leave_deductions: 0 };
}

async function verify(orgId) {
  const rows = await runSql(`
    select
      (select count(*)::int from public.shifts where org_id = ${sqlLiteral(orgId)}::uuid and name like 'عرض - %') as demo_shifts,
      (select count(*)::int
       from public.employee_shifts es
       join public.shifts s on s.id = es.shift_id
       where es.org_id = ${sqlLiteral(orgId)}::uuid and s.name like 'عرض - %') as demo_shift_assignments,
      (select count(*)::int from public.leave_requests where org_id = ${sqlLiteral(orgId)}::uuid and reason like 'بيانات عرض:%') as demo_leave_requests,
      (select jsonb_object_agg(status, count) from (
        select status::text, count(*)::int
        from public.leave_requests
        where org_id = ${sqlLiteral(orgId)}::uuid and reason like 'بيانات عرض:%'
        group by status
      ) s) as leave_statuses,
      (select count(*)::int from public.leave_balance_transactions where org_id = ${sqlLiteral(orgId)}::uuid and reason like 'بيانات عرض:%') as demo_balance_transactions;
  `);
  return rows[0];
}

async function main() {
  const organization = await getOrganization();
  const [hrUser, employees, locations] = await Promise.all([
    getHrUser(organization.id),
    getEmployees(organization.id),
    getLocations(organization.id),
  ]);
  const baseDate = dateInTimeZone("Africa/Cairo");
  const schedulePayload = buildSchedulePayload({ orgId: organization.id, employees, locations, baseDate });
  const leavePayload = buildLeavePayload({ orgId: organization.id, employees, hrUser, baseDate });

  const scheduleResult = await seedSchedules({
    orgId: organization.id,
    shifts: schedulePayload.shifts,
    assignments: schedulePayload.assignments,
  });
  const leaveResult = await seedLeaves({
    orgId: organization.id,
    requests: leavePayload.requests,
    balances: leavePayload.balances,
  });
  const verification = await verify(organization.id);

  console.log(`Organization: ${organization.name || organization.id}`);
  console.log(`HR actor: ${hrUser.full_name || hrUser.email}`);
  console.log(`Employees used: ${employees.length}`);
  console.log(`Locations used: ${locations.length}`);
  console.log(`Seeded shifts: ${scheduleResult.shifts}`);
  console.log(`Seeded shift assignments: ${scheduleResult.assignments}`);
  console.log(`Seeded leave balances: ${leaveResult.balances}`);
  console.log(`Seeded leave balance transactions: ${leaveResult.balance_transactions}`);
  console.log(`Seeded leave requests: ${leaveResult.leave_requests}`);
  console.log(`Seeded approved leave deductions: ${leaveResult.leave_deductions}`);
  console.log(`Verification: ${JSON.stringify(verification)}`);
}

main().catch((error) => {
  console.error("Schedule/leave demo seed failed:", error.message);
  process.exit(1);
});
