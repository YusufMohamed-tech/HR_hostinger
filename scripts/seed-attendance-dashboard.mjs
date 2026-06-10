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
const presentTarget = Number(process.env.SEED_ATTENDANCE_PRESENT_COUNT || 390);
const absentTarget = Number(process.env.SEED_ATTENDANCE_ABSENT_COUNT || 10);
const lateMinutes = Number(process.env.SEED_ATTENDANCE_LATE_MINUTES || 240);

if (!projectRef || !accessToken) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL/SUPABASE_PROJECT_REF or SUPABASE_ACCESS_TOKEN in .env.local");
  process.exit(1);
}

if (!Number.isInteger(presentTarget) || presentTarget < 0 || !Number.isInteger(absentTarget) || absentTarget < 0) {
  console.error("SEED_ATTENDANCE_PRESENT_COUNT and SEED_ATTENDANCE_ABSENT_COUNT must be non-negative integers.");
  process.exit(1);
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function dateInTimeZone(timeZone) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function targetDates() {
  if (process.env.SEED_ATTENDANCE_DATES) {
    return [...new Set(process.env.SEED_ATTENDANCE_DATES.split(",").map((date) => date.trim()).filter(Boolean))];
  }

  const appDate = new Date().toISOString().slice(0, 10);
  const cairoDate = dateInTimeZone("Africa/Cairo");
  return [...new Set([appDate, cairoDate])];
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

async function getAttendanceColumns() {
  const rows = await runSql(`
    select column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'attendance_records';
  `);
  return new Set(rows.map((row) => row.column_name));
}

function buildInsertSql({ orgId, workDate, columns }) {
  const checkInAt = `(${sqlLiteral(workDate)}::date::timestamp + time '12:00') AT TIME ZONE 'Africa/Cairo'`;
  const baseColumns = [
    "org_id",
    "employee_id",
    "work_date",
    "check_in_at",
    "status",
    "total_minutes",
    "late_minutes",
    "within_geofence",
    "distance_meters",
    "check_in_device",
    "created_at",
    "updated_at",
  ];
  const baseValues = [
    "org_id",
    "employee_id",
    sqlLiteral(workDate),
    checkInAt,
    `case when rn <= ${presentTarget} then 'present'::public.attendance_status else 'late'::public.attendance_status end`,
    "0",
    `case when rn <= ${presentTarget} then 0 else ${lateMinutes} end`,
    "true",
    "0",
    sqlLiteral("Dashboard attendance seed"),
    "now()",
    "now()",
  ];

  const optionalColumns = [
    ["location_id", "location_id"],
    ["scheduled_check_in_at", checkInAt],
    ["scheduled_check_out_at", `${checkInAt} + interval '8 hours'`],
    ["early_arrival_minutes", "0"],
    ["early_leave_minutes", "0"],
    ["overtime_minutes", "0"],
    ["arrival_status", `case when rn <= ${presentTarget} then 'on_time' else 'late' end`],
    ["departure_status", "null"],
    ["device_fingerprint", sqlLiteral("dashboard-attendance-seed")],
    ["is_registered_device", "true"],
  ];

  for (const [column, value] of optionalColumns) {
    if (columns.has(column)) {
      baseColumns.push(column);
      baseValues.push(value);
    }
  }

  return `
    with ranked_employees as (
      select
        e.org_id,
        e.id as employee_id,
        e.location_id,
        row_number() over (order by e.full_name, e.employee_code nulls last, e.id) as rn,
        count(*) over () as employee_count
      from public.employees e
      where e.org_id = ${sqlLiteral(orgId)}::uuid
    ),
    attendance_scope as (
      select
        *,
        greatest(0, employee_count - ${absentTarget}) as record_limit
      from ranked_employees
    )
    insert into public.attendance_records (${baseColumns.join(", ")})
    select ${baseValues.join(", ")}
    from attendance_scope
    where rn <= record_limit
    order by rn;
  `;
}

async function seedDate({ orgId, workDate, columns }) {
  const sql = `
    begin;

    do $$
    begin
      if exists (select 1 from pg_trigger where tgrelid = 'public.attendance_records'::regclass and tgname = 'trg_apply_shift_late_attendance') then
        alter table public.attendance_records disable trigger trg_apply_shift_late_attendance;
      end if;
      if exists (select 1 from pg_trigger where tgrelid = 'public.attendance_records'::regclass and tgname = 'trg_notify_hr_late_attendance') then
        alter table public.attendance_records disable trigger trg_notify_hr_late_attendance;
      end if;
    end $$;

    delete from public.attendance_records
    where org_id = ${sqlLiteral(orgId)}::uuid
      and work_date = ${sqlLiteral(workDate)}::date;

    ${buildInsertSql({ orgId, workDate, columns })}

    do $$
    begin
      if exists (select 1 from pg_trigger where tgrelid = 'public.attendance_records'::regclass and tgname = 'trg_apply_shift_late_attendance') then
        alter table public.attendance_records enable trigger trg_apply_shift_late_attendance;
      end if;
      if exists (select 1 from pg_trigger where tgrelid = 'public.attendance_records'::regclass and tgname = 'trg_notify_hr_late_attendance') then
        alter table public.attendance_records enable trigger trg_notify_hr_late_attendance;
      end if;
    end $$;

    commit;
  `;

  await runSql(sql);
}

async function verifyDate(orgId, workDate) {
  const rows = await runSql(`
    with totals as (
      select count(*)::int as employee_count
      from public.employees
      where org_id = ${sqlLiteral(orgId)}::uuid
    ),
    attendance as (
      select
        count(*) filter (where status = 'present')::int as present_count,
        count(*) filter (where status = 'late')::int as late_count,
        count(*) filter (where status = 'on_leave')::int as on_leave_count,
        count(*)::int as recorded_count,
        min(check_in_at at time zone 'Africa/Cairo')::time as first_check_in_cairo,
        max(check_in_at at time zone 'Africa/Cairo')::time as last_check_in_cairo
      from public.attendance_records
      where org_id = ${sqlLiteral(orgId)}::uuid
        and work_date = ${sqlLiteral(workDate)}::date
    )
    select
      totals.employee_count,
      attendance.present_count,
      attendance.late_count,
      greatest(0, totals.employee_count - attendance.present_count - attendance.late_count - attendance.on_leave_count)::int as absent_count,
      attendance.recorded_count,
      attendance.first_check_in_cairo::text,
      attendance.last_check_in_cairo::text
    from totals, attendance;
  `);
  return rows[0];
}

async function main() {
  const organization = await getOrganization();
  const columns = await getAttendanceColumns();
  const dates = targetDates();

  const employeeRows = await runSql(`
    select count(*)::int as employee_count
    from public.employees
    where org_id = ${sqlLiteral(organization.id)}::uuid;
  `);
  const employeeCount = Number(employeeRows[0]?.employee_count || 0);
  if (employeeCount < presentTarget + absentTarget) {
    throw new Error(`Need at least ${presentTarget + absentTarget} employees, but found ${employeeCount}.`);
  }

  console.log(`Organization: ${organization.name || organization.id}`);
  console.log(`Employees: ${employeeCount}`);
  console.log(`Target: ${presentTarget} present, ${absentTarget} absent, ${employeeCount - presentTarget - absentTarget} late`);

  for (const workDate of dates) {
    await seedDate({ orgId: organization.id, workDate, columns });
    const result = await verifyDate(organization.id, workDate);
    console.log(
      `${workDate}: present ${result.present_count}, late ${result.late_count}, absent ${result.absent_count}, check-in ${result.first_check_in_cairo}-${result.last_check_in_cairo} Cairo`
    );
  }
}

main().catch((error) => {
  console.error("Attendance dashboard seed failed:", error.message);
  process.exit(1);
});
