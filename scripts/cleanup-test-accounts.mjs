import https from "node:https";
import process from "node:process";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
const dryRun = process.env.DRY_RUN === "1";

const targetEmails = ["abdalla.test@tatwir.sa", "gawdat.test@tatwir.sa"];
const targetLocationNames = ["abdalla test", "gawdat test"];
const targetNameNeedles = ["abdalla", "gawdat", "abdalla.test", "gawdat.test"];

if (!supabaseUrl || !serviceRoleKey || !accessToken) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or SUPABASE_ACCESS_TOKEN in .env.local");
  process.exit(1);
}

const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function sqlLiteral(value) {
  if (value === null || value === undefined) return "null";
  return `'${String(value).replace(/'/g, "''")}'`;
}

function sqlList(values) {
  return values.map(sqlLiteral).join(", ");
}

function postJson(url, payload, headers = {}) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const request = https.request(
      url,
      {
        method: "POST",
        timeout: 90000,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          ...headers,
        },
      },
      (response) => {
        let raw = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          raw += chunk;
        });
        response.on("end", () => {
          if (response.statusCode < 200 || response.statusCode >= 300) {
            reject(new Error(`Supabase API ${response.statusCode}: ${raw}`));
            return;
          }
          resolve(raw ? JSON.parse(raw) : null);
        });
      }
    );

    request.on("timeout", () => {
      request.destroy(new Error("Supabase API request timed out"));
    });
    request.on("error", reject);
    request.write(body);
    request.end();
  });
}

async function runSql(query) {
  const url = `https://api.supabase.com/v1/projects/${projectRef}/database/query`;
  const result = await postJson(
    url,
    { query },
    {
      Authorization: `Bearer ${accessToken}`,
    }
  );

  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.value)) return result.value;
  return result ? [result] : [];
}

async function listAuthTargets() {
  const users = [];
  let page = 1;
  const perPage = 100;
  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    for (const user of data.users) {
      if (user.email && targetEmails.includes(user.email.toLowerCase())) users.push(user);
    }
    if (data.users.length < perPage) return users;
    page += 1;
  }
}

const targetEmailsSql = sqlList(targetEmails);
const targetLocationsSql = sqlList(targetLocationNames);
const nameNeedleSql = sqlList(targetNameNeedles);

const summarySql = `
with target_auth as (
  select id::uuid as user_id, lower(email) as email
  from auth.users
  where lower(email) in (${targetEmailsSql})
),
target_profiles as (
  select user_id, lower(email) as email, full_name
  from public.profiles
  where lower(email) in (${targetEmailsSql})
     or user_id in (select user_id from target_auth)
),
target_employees as (
  select id as employee_id, user_id, lower(email) as email, full_name, employee_code
  from public.employees
  where lower(email) in (${targetEmailsSql})
     or user_id in (
       select user_id from target_auth
       union
       select user_id from target_profiles
     )
),
target_locations as (
  select id as location_id, name
  from public.locations
  where lower(name) in (${targetLocationsSql})
)
select
  (select count(*)::int from target_auth) as auth_users,
  (select count(*)::int from target_profiles) as profiles,
  (select count(*)::int from target_employees) as employees,
  (select count(*)::int from target_locations) as locations,
  (select count(*)::int from public.employees where location_id in (select location_id from target_locations)) as employees_using_test_locations,
  (select count(*)::int from public.shifts where location_id in (select location_id from target_locations)) as shifts_using_test_locations,
  (select count(*)::int from public.attendance_records where employee_id in (select employee_id from target_employees)) as attendance_records,
  (select count(*)::int from public.leave_requests where employee_id in (select employee_id from target_employees)) as leave_requests,
  (select count(*)::int from public.employee_assets where employee_id in (select employee_id from target_employees)) as employee_assets,
  (select count(*)::int from public.notifications where user_id in (select user_id from target_auth union select user_id from target_profiles)) as notifications,
  (select count(*)::int from public.chat_participants where user_id in (select user_id from target_auth union select user_id from target_profiles) or employee_id in (select employee_id from target_employees)) as chat_participants,
  (select count(*)::int from public.chat_messages where sender_user_id in (select user_id from target_auth union select user_id from target_profiles) or sender_employee_id in (select employee_id from target_employees)) as chat_messages;
`;

const cleanupSql = `
begin;

create temp table cleanup_counts(entity text primary key, affected integer default 0);

create temp table cleanup_target_users as
select distinct user_id
from (
  select id::uuid as user_id
  from auth.users
  where lower(email) in (${targetEmailsSql})
  union
  select user_id
  from public.profiles
  where lower(email) in (${targetEmailsSql})
  union
  select user_id
  from public.employees
  where lower(email) in (${targetEmailsSql})
) source
where user_id is not null;

create temp table cleanup_target_employees as
select distinct id as employee_id
from public.employees
where lower(email) in (${targetEmailsSql})
   or user_id in (select user_id from cleanup_target_users);

create temp table cleanup_target_locations as
select distinct id as location_id
from public.locations
where lower(name) in (${targetLocationsSql});

create temp table cleanup_target_shifts as
select distinct id as shift_id
from public.shifts
where location_id in (select location_id from cleanup_target_locations);

create temp table cleanup_target_tasks as
select distinct task_id
from (
  select id as task_id
  from public.tasks
  where created_by in (select user_id from cleanup_target_users)
  union
  select task_id
  from public.task_assignments
  where employee_id in (select employee_id from cleanup_target_employees)
  union
  select task_id
  from public.task_updates
  where employee_id in (select employee_id from cleanup_target_employees)
) source
where task_id is not null;

create temp table cleanup_target_direct_conversations as
select distinct cp.conversation_id
from public.chat_participants cp
join public.chat_conversations cc on cc.id = cp.conversation_id
where cc.type = 'direct'
  and (
    cp.user_id in (select user_id from cleanup_target_users)
    or cp.employee_id in (select employee_id from cleanup_target_employees)
  );

create temp table cleanup_target_job_applications as
select distinct id as job_application_id
from public.job_applications
where candidate_user_id in (select user_id from cleanup_target_users)
   or lower(email) in (${targetEmailsSql});

create temp table cleanup_target_sales_logs as
select distinct id as sales_log_id
from public.sales_logs
where sales_agent_id in (select user_id from cleanup_target_users);

with affected as (
  update public.advance_requests set reviewed_by = null where reviewed_by in (select user_id from cleanup_target_users) returning 1
) insert into cleanup_counts values ('advance_requests_reviewed_by_cleared', (select count(*) from affected));

with affected as (
  update public.employee_career_events set created_by = null where created_by in (select user_id from cleanup_target_users) returning 1
) insert into cleanup_counts values ('career_events_created_by_cleared', (select count(*) from affected));

with affected as (
  update public.sales_logs set reviewed_by = null where reviewed_by in (select user_id from cleanup_target_users) returning 1
) insert into cleanup_counts values ('sales_logs_reviewed_by_cleared', (select count(*) from affected));

with affected as (
  update public.sales_products set created_by = null where created_by in (select user_id from cleanup_target_users) returning 1
) insert into cleanup_counts values ('sales_products_created_by_cleared', (select count(*) from affected));

with affected as (
  update public.job_templates set created_by = null where created_by in (select user_id from cleanup_target_users) returning 1
) insert into cleanup_counts values ('job_templates_created_by_cleared', (select count(*) from affected));

with affected as (
  update public.job_postings
  set created_by = null
  where created_by in (select user_id from cleanup_target_users)
  returning 1
) insert into cleanup_counts values ('job_postings_created_by_cleared', (select count(*) from affected));

with affected as (
  update public.job_postings
  set location_id = null
  where location_id in (select location_id from cleanup_target_locations)
  returning 1
) insert into cleanup_counts values ('job_postings_test_location_cleared', (select count(*) from affected));

with affected as (
  update public.interviews
  set interviewer_id = null
  where interviewer_id in (select employee_id from cleanup_target_employees)
  returning 1
) insert into cleanup_counts values ('interviews_interviewer_cleared', (select count(*) from affected));

with affected as (
  update public.interviews
  set created_by = null
  where created_by in (select user_id from cleanup_target_users)
  returning 1
) insert into cleanup_counts values ('interviews_created_by_cleared', (select count(*) from affected));

with affected as (
  update public.departments
  set manager_employee_id = null
  where manager_employee_id in (select employee_id from cleanup_target_employees)
  returning 1
) insert into cleanup_counts values ('departments_manager_cleared', (select count(*) from affected));

with affected as (
  update public.locations
  set manager_employee_id = null
  where manager_employee_id in (select employee_id from cleanup_target_employees)
  returning 1
) insert into cleanup_counts values ('locations_manager_cleared', (select count(*) from affected));

with affected as (
  update public.employees
  set manager_id = null
  where manager_id in (select employee_id from cleanup_target_employees)
  returning 1
) insert into cleanup_counts values ('employees_manager_cleared', (select count(*) from affected));

with affected as (
  update public.employees
  set location_id = null
  where location_id in (select location_id from cleanup_target_locations)
  returning 1
) insert into cleanup_counts values ('employees_test_location_cleared', (select count(*) from affected));

with affected as (
  update public.chat_conversations
  set created_by = null
  where created_by in (select user_id from cleanup_target_users)
  returning 1
) insert into cleanup_counts values ('chat_conversations_created_by_cleared', (select count(*) from affected));

with affected as (
  update public.chat_participants
  set added_by = null
  where added_by in (select user_id from cleanup_target_users)
  returning 1
) insert into cleanup_counts values ('chat_participants_added_by_cleared', (select count(*) from affected));

with affected as (
  delete from public.chat_conversations
  where id in (select conversation_id from cleanup_target_direct_conversations)
  returning 1
) insert into cleanup_counts values ('direct_chats_deleted', (select count(*) from affected));

with affected as (
  delete from public.chat_messages
  where sender_user_id in (select user_id from cleanup_target_users)
     or sender_employee_id in (select employee_id from cleanup_target_employees)
  returning 1
) insert into cleanup_counts values ('chat_messages_deleted', (select count(*) from affected));

with affected as (
  delete from public.chat_participants
  where user_id in (select user_id from cleanup_target_users)
     or employee_id in (select employee_id from cleanup_target_employees)
  returning 1
) insert into cleanup_counts values ('chat_participants_deleted', (select count(*) from affected));

with affected as (
  delete from public.chat_conversations cc
  where not exists (select 1 from public.chat_participants cp where cp.conversation_id = cc.id)
  returning 1
) insert into cleanup_counts values ('empty_chats_deleted', (select count(*) from affected));

with affected as (
  delete from public.recruitment_messages
  where job_application_id in (select job_application_id from cleanup_target_job_applications)
     or sender_user_id in (select user_id from cleanup_target_users)
     or candidate_user_id in (select user_id from cleanup_target_users)
  returning 1
) insert into cleanup_counts values ('recruitment_messages_deleted', (select count(*) from affected));

with affected as (
  delete from public.interviews
  where job_application_id in (select job_application_id from cleanup_target_job_applications)
  returning 1
) insert into cleanup_counts values ('target_application_interviews_deleted', (select count(*) from affected));

with affected as (
  delete from public.job_applications
  where id in (select job_application_id from cleanup_target_job_applications)
  returning 1
) insert into cleanup_counts values ('job_applications_deleted', (select count(*) from affected));

with affected as (
  update public.sales_log_edit_requests set resolved_by = null where resolved_by in (select user_id from cleanup_target_users) returning 1
) insert into cleanup_counts values ('sales_edit_requests_resolved_by_cleared', (select count(*) from affected));

with affected as (
  delete from public.sales_log_edit_requests
  where sales_agent_id in (select user_id from cleanup_target_users)
     or sales_log_id in (select sales_log_id from cleanup_target_sales_logs)
  returning 1
) insert into cleanup_counts values ('sales_edit_requests_deleted', (select count(*) from affected));

with affected as (
  delete from public.sales_logs
  where id in (select sales_log_id from cleanup_target_sales_logs)
  returning 1
) insert into cleanup_counts values ('sales_logs_deleted', (select count(*) from affected));

with affected as (
  delete from public.sales_company_assignments
  where user_id in (select user_id from cleanup_target_users)
  returning 1
) insert into cleanup_counts values ('sales_company_assignments_deleted', (select count(*) from affected));

with affected as (
  delete from public.task_attachments
  where task_id in (select task_id from cleanup_target_tasks)
     or uploaded_by in (select user_id from cleanup_target_users)
  returning 1
) insert into cleanup_counts values ('task_attachments_deleted', (select count(*) from affected));

with affected as (
  delete from public.task_updates
  where task_id in (select task_id from cleanup_target_tasks)
     or employee_id in (select employee_id from cleanup_target_employees)
  returning 1
) insert into cleanup_counts values ('task_updates_deleted', (select count(*) from affected));

with affected as (
  delete from public.task_assignments
  where task_id in (select task_id from cleanup_target_tasks)
     or employee_id in (select employee_id from cleanup_target_employees)
  returning 1
) insert into cleanup_counts values ('task_assignments_deleted', (select count(*) from affected));

with affected as (
  delete from public.tasks
  where id in (select task_id from cleanup_target_tasks)
  returning 1
) insert into cleanup_counts values ('tasks_deleted', (select count(*) from affected));

with affected as (
  delete from public.notifications
  where user_id in (select user_id from cleanup_target_users)
     or lower(coalesce(title, '') || ' ' || coalesce(body, '')) like any (
       select '%' || value || '%'
       from unnest(array[${nameNeedleSql}]) as value
     )
  returning 1
) insert into cleanup_counts values ('notifications_deleted', (select count(*) from affected));

with affected as (
  delete from public.platform_audit_logs
  where actor_user_id in (select user_id from cleanup_target_users)
     or target_user_id in (select user_id from cleanup_target_users)
  returning 1
) insert into cleanup_counts values ('platform_audit_logs_deleted', (select count(*) from affected));

with affected as (
  delete from public.audit_logs
  where actor_user_id in (select user_id from cleanup_target_users)
  returning 1
) insert into cleanup_counts values ('audit_logs_deleted', (select count(*) from affected));

with affected as (
  delete from public.employee_locations
  where employee_id in (select employee_id from cleanup_target_employees)
     or location_id in (select location_id from cleanup_target_locations)
  returning 1
) insert into cleanup_counts values ('employee_locations_deleted', (select count(*) from affected));

with affected as (
  delete from public.employee_shifts
  where employee_id in (select employee_id from cleanup_target_employees)
     or shift_id in (select shift_id from cleanup_target_shifts)
  returning 1
) insert into cleanup_counts values ('employee_shifts_deleted', (select count(*) from affected));

with affected as (
  delete from public.shifts
  where id in (select shift_id from cleanup_target_shifts)
  returning 1
) insert into cleanup_counts values ('test_location_shifts_deleted', (select count(*) from affected));

with affected as (
  delete from public.attendance_records where employee_id in (select employee_id from cleanup_target_employees) returning 1
) insert into cleanup_counts values ('attendance_records_deleted', (select count(*) from affected));

with affected as (
  delete from public.advance_requests where employee_id in (select employee_id from cleanup_target_employees) returning 1
) insert into cleanup_counts values ('advance_requests_deleted', (select count(*) from affected));

with affected as (
  delete from public.leave_balance_transactions where employee_id in (select employee_id from cleanup_target_employees) returning 1
) insert into cleanup_counts values ('leave_balance_transactions_deleted', (select count(*) from affected));

with affected as (
  delete from public.leave_requests where employee_id in (select employee_id from cleanup_target_employees) returning 1
) insert into cleanup_counts values ('leave_requests_deleted', (select count(*) from affected));

with affected as (
  delete from public.leave_balances where employee_id in (select employee_id from cleanup_target_employees) returning 1
) insert into cleanup_counts values ('leave_balances_deleted', (select count(*) from affected));

with affected as (
  delete from public.employee_assets where employee_id in (select employee_id from cleanup_target_employees) returning 1
) insert into cleanup_counts values ('employee_assets_deleted', (select count(*) from affected));

with affected as (
  delete from public.financial_balances where employee_id in (select employee_id from cleanup_target_employees) returning 1
) insert into cleanup_counts values ('financial_balances_deleted', (select count(*) from affected));

with affected as (
  delete from public.payslips where employee_id in (select employee_id from cleanup_target_employees) returning 1
) insert into cleanup_counts values ('payslips_deleted', (select count(*) from affected));

with affected as (
  delete from public.personnel_files where employee_id in (select employee_id from cleanup_target_employees) returning 1
) insert into cleanup_counts values ('personnel_files_deleted', (select count(*) from affected));

with affected as (
  delete from public.employee_documents where employee_id in (select employee_id from cleanup_target_employees) returning 1
) insert into cleanup_counts values ('employee_documents_deleted', (select count(*) from affected));

with affected as (
  delete from public.employee_contracts where employee_id in (select employee_id from cleanup_target_employees) returning 1
) insert into cleanup_counts values ('employee_contracts_deleted', (select count(*) from affected));

with affected as (
  delete from public.social_insurance where employee_id in (select employee_id from cleanup_target_employees) returning 1
) insert into cleanup_counts values ('social_insurance_deleted', (select count(*) from affected));

with affected as (
  delete from public.salary_history where employee_id in (select employee_id from cleanup_target_employees) returning 1
) insert into cleanup_counts values ('salary_history_deleted', (select count(*) from affected));

with affected as (
  delete from public.employee_kpis where employee_id in (select employee_id from cleanup_target_employees) returning 1
) insert into cleanup_counts values ('employee_kpis_deleted', (select count(*) from affected));

with affected as (
  delete from public.employee_reviews where employee_id in (select employee_id from cleanup_target_employees) returning 1
) insert into cleanup_counts values ('employee_reviews_deleted', (select count(*) from affected));

with affected as (
  delete from public.employee_actions where employee_id in (select employee_id from cleanup_target_employees) returning 1
) insert into cleanup_counts values ('employee_actions_deleted', (select count(*) from affected));

with affected as (
  delete from public.employee_career_events where employee_id in (select employee_id from cleanup_target_employees) returning 1
) insert into cleanup_counts values ('employee_career_events_deleted', (select count(*) from affected));

with affected as (
  delete from public.employees where id in (select employee_id from cleanup_target_employees) returning 1
) insert into cleanup_counts values ('employees_deleted', (select count(*) from affected));

with affected as (
  delete from public.locations where id in (select location_id from cleanup_target_locations) returning 1
) insert into cleanup_counts values ('test_locations_deleted', (select count(*) from affected));

with affected as (
  delete from public.platform_admins where user_id in (select user_id from cleanup_target_users) returning 1
) insert into cleanup_counts values ('platform_admins_deleted', (select count(*) from affected));

with affected as (
  delete from public.org_members where user_id in (select user_id from cleanup_target_users) returning 1
) insert into cleanup_counts values ('org_members_deleted', (select count(*) from affected));

with affected as (
  delete from public.profiles where user_id in (select user_id from cleanup_target_users) returning 1
) insert into cleanup_counts values ('profiles_deleted', (select count(*) from affected));

commit;

select entity, affected
from cleanup_counts
where affected > 0
order by entity;
`;

const verifySql = `
select
  (select count(*)::int from auth.users where lower(email) in (${targetEmailsSql})) as auth_users,
  (select count(*)::int from public.profiles where lower(email) in (${targetEmailsSql})) as profiles,
  (select count(*)::int from public.employees where lower(email) in (${targetEmailsSql})) as employees,
  (select count(*)::int from public.locations where lower(name) in (${targetLocationsSql})) as locations,
  (select count(*)::int from public.notifications where lower(coalesce(title, '') || ' ' || coalesce(body, '')) like any (
    select '%' || value || '%'
    from unnest(array[${nameNeedleSql}]) as value
  )) as named_notifications;
`;

function printRows(title, rows) {
  console.log(`\n${title}`);
  if (!rows.length) {
    console.log("No rows.");
    return;
  }
  console.table(rows);
}

const authTargets = await listAuthTargets();
const before = await runSql(summarySql);
printRows("Before cleanup", before);

if (dryRun) {
  console.log("\nDRY_RUN=1, no data was deleted.");
  process.exit(0);
}

const cleanupRows = await runSql(cleanupSql);
printRows("Cleanup counts", cleanupRows);

for (const user of authTargets) {
  const { error } = await supabase.auth.admin.deleteUser(user.id);
  if (error && !String(error.message || "").toLowerCase().includes("not found")) {
    throw error;
  }
  console.log(`Deleted auth user: ${user.email}`);
}

const after = await runSql(verifySql);
printRows("After cleanup verification", after);
