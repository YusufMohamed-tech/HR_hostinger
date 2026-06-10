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

if (!projectRef || !accessToken) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL/SUPABASE_PROJECT_REF or SUPABASE_ACCESS_TOKEN in .env.local");
  process.exit(1);
}

const staleTitles = [
  "mo",
  "dasssad",
  "بيع 10 خطوط النهاردة",
];

const seedTasks = [
  {
    title: "مراجعة حضور فريق المبيعات",
    description: "تدقيق سجلات الحضور والتأخير قبل اعتماد تقرير اليوم.",
    priority: "high",
    status: "in_progress",
    dueOffset: 1,
    assigneeEmail: "abdalla.test@tatwir.sa",
    progress: 55,
    note: "تمت مراجعة أغلب السجلات وجاري مطابقة الحالات المتأخرة.",
  },
  {
    title: "اعتماد عهد الأجهزة المسلمة",
    description: "مراجعة توقيعات استلام الأجهزة والبصمات للموظفين الجدد.",
    priority: "urgent",
    status: "pending",
    dueOffset: 0,
    assigneeEmail: "abdalla.test@tatwir.sa",
    progress: 0,
    note: "بانتظار مراجعة الإقرارات الإلكترونية قبل الإغلاق.",
  },
  {
    title: "تحديث بيانات مواقع الرياض",
    description: "مطابقة المواقع الجديدة مع نطاقات الحضور الجغرافي.",
    priority: "medium",
    status: "completed",
    dueOffset: -1,
    assigneeEmail: "manager.test@tatwir.sa",
    progress: 100,
    note: "تم تحديث المواقع واعتماد نطاقات الحضور.",
  },
  {
    title: "متابعة طلبات السلف المعلقة",
    description: "مراجعة الطلبات المفتوحة وتجهيز قرارات الموافقة الجزئية.",
    priority: "high",
    status: "delayed",
    dueOffset: -2,
    assigneeEmail: "hr@tatwir.sa",
    progress: 35,
    note: "يوجد طلبان بانتظار مستندات إضافية من الموظفين.",
  },
  {
    title: "مراجعة ملفات الموظفين الجدد",
    description: "التأكد من اكتمال العقد والتأمينات والهوية لكل موظف جديد.",
    priority: "medium",
    status: "in_progress",
    dueOffset: 3,
    assigneeEmail: "gawdat.test@tatwir.sa",
    progress: 45,
    note: "تمت مراجعة العقود ويتبقى رفع ملفات التأمينات.",
  },
  {
    title: "تجهيز كشف الرواتب التجريبي",
    description: "مطابقة أيام الحضور والخصومات قبل تشغيل رواتب الشهر.",
    priority: "high",
    status: "rejected",
    dueOffset: 2,
    assigneeEmail: "employee.test@tatwir.sa",
    progress: 0,
    note: "تم رفض النسخة الأولى بسبب اختلاف بيانات التأخير.",
  },
  {
    title: "مطابقة أرصدة الإجازات",
    description: "مراجعة رصيد الإجازات السنوي بعد آخر تعديلات يدوية.",
    priority: "medium",
    status: "completed",
    dueOffset: 4,
    assigneeEmail: "hr@tatwir.sa",
    progress: 100,
    note: "تمت مطابقة الرصيد مع سجل الحركات.",
  },
  {
    title: "تجهيز تقرير مبيعات الأسبوع",
    description: "تلخيص مبيعات الشركات حسب الموقع والموظف للأسبوع الحالي.",
    priority: "low",
    status: "pending",
    dueOffset: 5,
    assigneeEmail: "t1@tatwir.sa",
    progress: 0,
    note: "ابدأ بتجميع أرقام المبيعات من السجلات اليومية.",
  },
];

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
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

async function getCreator(orgId) {
  const rows = await runSql(`
    select e.id as employee_id, e.user_id, e.full_name, e.email
    from public.employees e
    left join public.org_members om
      on om.org_id = e.org_id
     and om.user_id = e.user_id
    where e.org_id = ${sqlLiteral(orgId)}::uuid
      and e.user_id is not null
      and (lower(e.email) = 'hr@tatwir.sa' or om.role = 'hr_admin')
    order by case when lower(e.email) = 'hr@tatwir.sa' then 0 else 1 end, e.created_at
    limit 1;
  `);
  if (!rows.length) throw new Error("No HR creator account was found.");
  return rows[0];
}

async function getAssignees(orgId) {
  const rows = await runSql(`
    select distinct on (lower(coalesce(e.email, '')), e.user_id)
      e.id as employee_id,
      e.user_id,
      e.full_name,
      lower(e.email) as email,
      e.employee_code
    from public.employees e
    where e.org_id = ${sqlLiteral(orgId)}::uuid
      and e.user_id is not null
      and lower(e.email) in (${seedTasks.map((task) => sqlLiteral(task.assigneeEmail.toLowerCase())).join(", ")})
    order by lower(coalesce(e.email, '')), e.user_id, e.employee_code nulls last, e.created_at;
  `);

  const byEmail = new Map(rows.map((row) => [String(row.email || "").toLowerCase(), row]));
  const fallbackRows = await runSql(`
    select e.id as employee_id, e.user_id, e.full_name, lower(e.email) as email, e.employee_code
    from public.employees e
    where e.org_id = ${sqlLiteral(orgId)}::uuid
      and e.user_id is not null
    order by e.created_at
    limit 10;
  `);

  for (const task of seedTasks) {
    const key = task.assigneeEmail.toLowerCase();
    if (!byEmail.has(key)) {
      const fallback = fallbackRows[byEmail.size % Math.max(1, fallbackRows.length)];
      if (!fallback) throw new Error(`No employee found for task assignee ${task.assigneeEmail}.`);
      byEmail.set(key, fallback);
    }
  }

  return byEmail;
}

function buildDeleteSql(orgId, titles) {
  return `
    create temp table if not exists seed_demo_task_ids(id uuid primary key) on commit drop;
    truncate table seed_demo_task_ids;

    insert into seed_demo_task_ids(id)
    select id
    from public.tasks
    where org_id = ${sqlLiteral(orgId)}::uuid
      and title in (${titles.map(sqlLiteral).join(", ")});

    delete from public.notifications n
    using seed_demo_task_ids s
    where n.org_id = ${sqlLiteral(orgId)}::uuid
      and n.type = 'task'
      and coalesce(n.link, '') like '%' || s.id::text || '%';

    delete from public.notifications n
    where n.org_id = ${sqlLiteral(orgId)}::uuid
      and n.type = 'task'
      and (
        ${titles.map((title) => `coalesce(n.title, '') ilike '%' || ${sqlLiteral(title)} || '%' or coalesce(n.body, '') ilike '%' || ${sqlLiteral(title)} || '%'`).join(" or ")}
      );

    delete from public.tasks t
    using seed_demo_task_ids s
    where t.id = s.id;
  `;
}

function buildInsertSql({ orgId, creator, task, assignee, dueDate, createdAt }) {
  return `
    with inserted_task as (
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
      values (
        ${sqlLiteral(orgId)}::uuid,
        ${sqlLiteral(task.title)},
        ${sqlLiteral(task.description)},
        ${sqlLiteral(task.priority)},
        ${sqlLiteral(task.status)}::public.task_status,
        ${sqlLiteral(dueDate)}::date,
        null,
        ${sqlLiteral(creator.user_id)}::uuid,
        ${sqlLiteral(createdAt)}::timestamptz,
        ${sqlLiteral(createdAt)}::timestamptz
      )
      returning id
    ),
    inserted_assignment as (
      insert into public.task_assignments (
        org_id,
        task_id,
        employee_id,
        status,
        assigned_at
      )
      select
        ${sqlLiteral(orgId)}::uuid,
        id,
        ${sqlLiteral(assignee.employee_id)}::uuid,
        ${sqlLiteral(task.status)}::public.task_status,
        ${sqlLiteral(createdAt)}::timestamptz
      from inserted_task
      returning task_id
    )
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
      ${sqlLiteral(orgId)}::uuid,
      task_id,
      ${sqlLiteral(creator.employee_id)}::uuid,
      ${sqlLiteral(task.status)}::public.task_status,
      ${Number(task.progress || 0)},
      ${sqlLiteral(task.note)},
      (${sqlLiteral(createdAt)}::timestamptz + interval '10 minutes')
    from inserted_assignment;
  `;
}

async function main() {
  const organization = await getOrganization();
  const creator = await getCreator(organization.id);
  const assignees = await getAssignees(organization.id);
  const baseDate = dateInTimeZone("Africa/Cairo");
  const allSeedTitles = [...staleTitles, ...seedTasks.map((task) => task.title)];

  const insertStatements = seedTasks.map((task, index) => {
    const assignee = assignees.get(task.assigneeEmail.toLowerCase());
    const dueDate = addDays(baseDate, task.dueOffset);
    const createdAt = `${addDays(baseDate, -index)}T09:${String(10 + index).padStart(2, "0")}:00+03:00`;
    return buildInsertSql({ orgId: organization.id, creator, task, assignee, dueDate, createdAt });
  });

  await runSql(`
    begin;
    ${buildDeleteSql(organization.id, allSeedTitles)}
    ${insertStatements.join("\n")}
    commit;
  `);

  const rows = await runSql(`
    select t.title, t.status, t.priority, t.due_date::text, e.full_name as assignee
    from public.tasks t
    join public.task_assignments ta on ta.task_id = t.id
    join public.employees e on e.id = ta.employee_id
    where t.org_id = ${sqlLiteral(organization.id)}::uuid
      and t.title in (${seedTasks.map((task) => sqlLiteral(task.title)).join(", ")})
    order by t.created_at desc;
  `);

  console.log(`Organization: ${organization.name || organization.id}`);
  console.log(`Creator: ${creator.full_name || creator.email}`);
  console.log(`Deleted stale demo titles: ${staleTitles.join(", ")}`);
  console.log(`Seeded realistic demo tasks: ${rows.length}`);
  rows.forEach((row) => {
    console.log(`- ${row.title} | ${row.status} | ${row.priority} | ${row.due_date} | ${row.assignee}`);
  });
}

main().catch((error) => {
  console.error("Demo task seed failed:", error.message);
  process.exit(1);
});
