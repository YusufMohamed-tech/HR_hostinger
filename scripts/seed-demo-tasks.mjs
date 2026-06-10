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
const assignmentTaskCount = Number(process.env.SEED_DEMO_ASSIGNMENT_TASK_COUNT || 100);
const myTaskCount = Number(process.env.SEED_DEMO_MY_TASK_COUNT || 100);

if (!projectRef || !accessToken) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL/SUPABASE_PROJECT_REF or SUPABASE_ACCESS_TOKEN in .env.local");
  process.exit(1);
}

if (!Number.isInteger(assignmentTaskCount) || !Number.isInteger(myTaskCount) || assignmentTaskCount < 1 || myTaskCount < 1) {
  console.error("SEED_DEMO_ASSIGNMENT_TASK_COUNT and SEED_DEMO_MY_TASK_COUNT must be positive integers.");
  process.exit(1);
}

const oldDemoTitles = [
  "mo",
  "dasssad",
  "بيع 10 خطوط النهاردة",
  "مراجعة حضور فريق المبيعات",
  "اعتماد عهد الأجهزة المسلمة",
  "تحديث بيانات مواقع الرياض",
  "متابعة طلبات السلف المعلقة",
  "مراجعة ملفات الموظفين الجدد",
  "تجهيز كشف الرواتب التجريبي",
  "مطابقة أرصدة الإجازات",
  "تجهيز تقرير مبيعات الأسبوع",
];

const statuses = ["pending", "in_progress", "completed", "delayed", "rejected"];
const priorities = ["low", "medium", "high", "urgent"];
const cities = ["الرياض", "جدة", "الدمام", "مكة", "المدينة", "الخبر", "أبها", "تبوك", "القصيم", "حائل"];
const companies = ["STC", "Mobily", "Zain", "Salam", "Lebara", "Virgin", "Red Bull Mobile"];

const assignmentActions = ["مراجعة", "اعتماد", "تحديث", "مطابقة", "تجهيز", "متابعة", "فحص", "إغلاق", "تدقيق", "تحضير"];
const assignmentSubjects = [
  "سجلات حضور",
  "ملفات الموظفين",
  "عهد الأجهزة",
  "طلبات السلف",
  "أرصدة الإجازات",
  "مواقع العمل",
  "مسيرات الرواتب",
  "طلبات التوظيف",
  "تقارير المبيعات",
  "إقرارات الاستلام",
];

const myActions = ["اعتماد", "مراجعة قرار", "تحضير رد", "تدقيق طلب", "تحديث حالة", "متابعة موافقة", "إرسال قرار", "فحص مستند", "إغلاق مراجعة", "مطابقة سجل"];
const mySubjects = [
  "إجازة موظف",
  "سلفة مالية",
  "توقيع عهدة",
  "تعديل راتب",
  "ترقية وظيفية",
  "طلب توظيف",
  "ملف تأمينات",
  "عقد جديد",
  "مخالفة حضور",
  "رصيد إجازات",
];

const notesByStatus = {
  pending: "بانتظار بدء التنفيذ وتأكيد استلام المهمة.",
  in_progress: "تم البدء في التنفيذ وجاري استكمال المتطلبات.",
  completed: "تم الانتهاء من المهمة وإغلاقها بنجاح.",
  delayed: "يوجد تأخير بسبب انتظار بيانات إضافية.",
  rejected: "تم رفض الإجراء ويحتاج إلى مراجعة السبب.",
};

const progressByStatus = {
  pending: 0,
  in_progress: 55,
  completed: 100,
  delayed: 35,
  rejected: 0,
};

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function jsonSql(value) {
  return sqlLiteral(JSON.stringify(value));
}

function formatNumber(number) {
  return String(number).padStart(3, "0");
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

function createdAtFor(index, hour = 9) {
  const baseDate = dateInTimeZone("Africa/Cairo");
  const date = addDays(baseDate, -Math.floor(index / 12));
  const minute = String((index * 7) % 60).padStart(2, "0");
  return `${date}T${String(hour).padStart(2, "0")}:${minute}:00+03:00`;
}

function taskDueDate(index, groupOffset = 0) {
  const baseDate = dateInTimeZone("Africa/Cairo");
  return addDays(baseDate, ((index + groupOffset) % 17) - 5);
}

function makeAssignmentTasks(count) {
  return Array.from({ length: count }).map((_, index) => {
    const action = assignmentActions[index % assignmentActions.length];
    const subject = assignmentSubjects[Math.floor(index / assignmentActions.length) % assignmentSubjects.length];
    const city = cities[index % cities.length];
    const company = companies[index % companies.length];
    const status = statuses[index % statuses.length];
    const priority = priorities[(index + 2) % priorities.length];
    const sequence = formatNumber(index + 1);

    return {
      group: "assignment",
      title: `${action} ${subject} - ${city} ${sequence}`,
      description: `مهمة تشغيلية لمتابعة ${subject} في ${city} ضمن أعمال ${company}.`,
      status,
      priority,
      due_date: taskDueDate(index),
      created_at: createdAtFor(index, 9),
      progress: progressByStatus[status],
      note: notesByStatus[status],
    };
  });
}

function makeMyTasks(count) {
  return Array.from({ length: count }).map((_, index) => {
    const action = myActions[index % myActions.length];
    const subject = mySubjects[Math.floor(index / myActions.length) % mySubjects.length];
    const city = cities[(index + 3) % cities.length];
    const company = companies[(index + 4) % companies.length];
    const status = statuses[(index + 1) % statuses.length];
    const priority = priorities[(index + 1) % priorities.length];
    const sequence = formatNumber(index + 1);

    return {
      group: "mine",
      title: `${action} ${subject} - متابعة HR ${sequence}`,
      description: `مهمة موجهة لمسؤول الموارد البشرية لمراجعة ${subject} في ${city} ضمن ${company}.`,
      status,
      priority,
      due_date: taskDueDate(index, 6),
      created_at: createdAtFor(index, 11),
      progress: progressByStatus[status],
      note: notesByStatus[status],
    };
  });
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

async function getHrEmployee(orgId) {
  const rows = await runSql(`
    select id, user_id, full_name, email
    from public.employees
    where org_id = ${sqlLiteral(orgId)}::uuid
      and lower(email) = 'hr@tatwir.sa'
      and user_id is not null
    order by created_at
    limit 1;
  `);
  if (rows.length) return rows[0];

  const fallback = await runSql(`
    select id, user_id, full_name, email
    from public.employees
    where org_id = ${sqlLiteral(orgId)}::uuid
      and user_id is not null
    order by created_at
    limit 1;
  `);
  if (!fallback.length) throw new Error("No HR employee profile with user_id was found.");
  return fallback[0];
}

async function getOtherCreator(orgId, hrEmployeeId) {
  const preferred = ["manager.test@tatwir.sa", "employee.test@tatwir.sa"];
  const rows = await runSql(`
    select id, user_id, full_name, email
    from public.employees
    where org_id = ${sqlLiteral(orgId)}::uuid
      and id <> ${sqlLiteral(hrEmployeeId)}::uuid
      and user_id is not null
      and lower(email) in (${preferred.map(sqlLiteral).join(", ")})
    order by case lower(email)
      when 'manager.test@tatwir.sa' then 0
      else 2
    end, created_at
    limit 1;
  `);
  if (rows.length) return rows[0];

  const fallback = await runSql(`
    select id, user_id, full_name, email
    from public.employees
    where org_id = ${sqlLiteral(orgId)}::uuid
      and id <> ${sqlLiteral(hrEmployeeId)}::uuid
      and user_id is not null
    order by created_at
    limit 1;
  `);
  if (!fallback.length) throw new Error("No non-HR creator profile with user_id was found.");
  return fallback[0];
}

async function getAssignableEmployees(orgId, hrEmployeeId) {
  const rows = await runSql(`
    select distinct on (e.user_id)
      e.id,
      e.user_id,
      e.full_name,
      e.email,
      e.employee_code
    from public.employees e
    where e.org_id = ${sqlLiteral(orgId)}::uuid
      and e.id <> ${sqlLiteral(hrEmployeeId)}::uuid
      and e.user_id is not null
    order by e.user_id, e.full_name, e.employee_code nulls last, e.created_at;
  `);
  if (!rows.length) throw new Error("No assignable employees were found.");
  return rows;
}

async function deleteExistingDemoTasks(orgId, titles) {
  const rows = await runSql(`
    with title_list as (
      select value::text as title
      from jsonb_array_elements_text(${jsonSql([...new Set(titles)])}::jsonb)
    ),
    seed_ids as (
      select t.id
      from public.tasks t
      join title_list l on l.title = t.title
      where t.org_id = ${sqlLiteral(orgId)}::uuid
    ),
    deleted_notifications as (
      delete from public.notifications n
      using seed_ids s
      where n.org_id = ${sqlLiteral(orgId)}::uuid
        and n.type = 'task'
        and coalesce(n.link, '') like '%' || s.id::text || '%'
      returning n.id
    ),
    deleted_tasks as (
      delete from public.tasks t
      using seed_ids s
      where t.id = s.id
      returning t.id
    )
    select count(*)::int as deleted_count from deleted_tasks;
  `);
  return Number(rows[0]?.deleted_count || 0);
}

async function insertDemoTasks(payload) {
  const rows = await runSql(`
    with payload as (
      select *
      from jsonb_to_recordset(${jsonSql(payload)}::jsonb) as task_payload(
        group_name text,
        title text,
        description text,
        priority text,
        status text,
        due_date date,
        created_at timestamptz,
        created_by uuid,
        creator_employee_id uuid,
        assignee_id uuid,
        progress integer,
        note text
      )
    ),
    inserted_tasks as (
      insert into public.tasks (
        org_id,
        title,
        description,
        priority,
        status,
        due_date,
        location_id,
        created_by,
        created_at,
        updated_at
      )
      select
        ${sqlLiteral(payload[0].org_id)}::uuid,
        title,
        description,
        priority,
        status::public.task_status,
        due_date,
        null,
        created_by,
        created_at,
        created_at
      from payload
      returning id, title
    ),
    task_map as (
      select p.*, it.id as task_id
      from payload p
      join inserted_tasks it on it.title = p.title
    ),
    inserted_assignments as (
      insert into public.task_assignments (
        org_id,
        task_id,
        employee_id,
        status,
        assigned_at
      )
      select
        ${sqlLiteral(payload[0].org_id)}::uuid,
        task_id,
        assignee_id,
        status::public.task_status,
        created_at
      from task_map
      returning id
    ),
    inserted_updates as (
      insert into public.task_updates (
        org_id,
        task_id,
        employee_id,
        status,
        progress,
        note,
        created_at
      )
      select
        ${sqlLiteral(payload[0].org_id)}::uuid,
        task_id,
        creator_employee_id,
        status::public.task_status,
        progress,
        note,
        created_at + interval '10 minutes'
      from task_map
      returning id
    )
    select
      (select count(*)::int from inserted_tasks) as inserted_tasks,
      (select count(*)::int from inserted_assignments) as inserted_assignments,
      (select count(*)::int from inserted_updates) as inserted_updates;
  `);
  return rows[0] || { inserted_tasks: 0, inserted_assignments: 0, inserted_updates: 0 };
}

async function verifyCounts({ orgId, hrEmployee, assignmentTitles, myTitles }) {
  const rows = await runSql(`
    with assignment_titles as (
      select value::text as title
      from jsonb_array_elements_text(${jsonSql(assignmentTitles)}::jsonb)
    ),
    my_titles as (
      select value::text as title
      from jsonb_array_elements_text(${jsonSql(myTitles)}::jsonb)
    ),
    assignment_rows as (
      select t.status::text
      from public.tasks t
      join assignment_titles at on at.title = t.title
      where t.org_id = ${sqlLiteral(orgId)}::uuid
        and t.created_by = ${sqlLiteral(hrEmployee.user_id)}::uuid
    ),
    my_rows as (
      select t.status::text
      from public.tasks t
      join my_titles mt on mt.title = t.title
      join public.task_assignments ta on ta.task_id = t.id
      where t.org_id = ${sqlLiteral(orgId)}::uuid
        and ta.employee_id = ${sqlLiteral(hrEmployee.id)}::uuid
    ),
    status_counts as (
      select 'assignment' as scope, status, count(*)::int as count from assignment_rows group by status
      union all
      select 'mine' as scope, status, count(*)::int as count from my_rows group by status
    )
    select
      (select count(*)::int from assignment_rows) as assignment_tab_count,
      (select count(*)::int from my_rows) as my_tasks_tab_count,
      coalesce(jsonb_object_agg(scope || ':' || status, count), '{}'::jsonb) as status_counts
    from status_counts;
  `);
  return rows[0] || { assignment_tab_count: 0, my_tasks_tab_count: 0, status_counts: {} };
}

async function main() {
  const organization = await getOrganization();
  const hrEmployee = await getHrEmployee(organization.id);
  const otherCreator = await getOtherCreator(organization.id, hrEmployee.id);
  const assignees = await getAssignableEmployees(organization.id, hrEmployee.id);
  const assignmentTasks = makeAssignmentTasks(assignmentTaskCount);
  const myTasks = makeMyTasks(myTaskCount);
  const assignmentTitles = assignmentTasks.map((task) => task.title);
  const myTitles = myTasks.map((task) => task.title);
  const allGeneratedTitles = [...assignmentTitles, ...myTitles];

  const payload = [
    ...assignmentTasks.map((task, index) => ({
      ...task,
      group_name: "assignment",
      org_id: organization.id,
      created_by: hrEmployee.user_id,
      creator_employee_id: hrEmployee.id,
      assignee_id: assignees[index % assignees.length].id,
    })),
    ...myTasks.map((task) => ({
      ...task,
      group_name: "mine",
      org_id: organization.id,
      created_by: otherCreator.user_id,
      creator_employee_id: otherCreator.id,
      assignee_id: hrEmployee.id,
    })),
  ];

  const deletedCount = await deleteExistingDemoTasks(organization.id, [...oldDemoTitles, ...allGeneratedTitles]);
  const inserted = await insertDemoTasks(payload);
  const verification = await verifyCounts({
    orgId: organization.id,
    hrEmployee,
    assignmentTitles,
    myTitles,
  });

  console.log(`Organization: ${organization.name || organization.id}`);
  console.log(`HR assignment creator: ${hrEmployee.full_name || hrEmployee.email}`);
  console.log(`My-tasks creator: ${otherCreator.full_name || otherCreator.email}`);
  console.log(`Assignable employees used: ${assignees.length}`);
  console.log(`Deleted previous demo tasks: ${deletedCount}`);
  console.log(`Inserted tasks: ${inserted.inserted_tasks}`);
  console.log(`Inserted assignments: ${inserted.inserted_assignments}`);
  console.log(`Inserted updates: ${inserted.inserted_updates}`);
  console.log(`Assignment tab tasks: ${verification.assignment_tab_count}`);
  console.log(`My tasks tab tasks: ${verification.my_tasks_tab_count}`);
  console.log(`Status counts: ${JSON.stringify(verification.status_counts)}`);
}

main().catch((error) => {
  console.error("Demo task seed failed:", error.message);
  process.exit(1);
});
