import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import dotenv from "dotenv";
import pg from "pg";

const envPath = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) dotenv.config({ path: envPath });

const connectionString = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || process.env.POSTGRES_URL;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
const projectRef = supabaseUrl?.match(/^https:\/\/([^.]+)\./)?.[1];

const requiredTables = [
  "lms_categories",
  "lms_courses",
  "lms_course_instructors",
  "lms_course_sections",
  "lms_lessons",
  "lms_lesson_attachments",
  "lms_quizzes",
  "lms_quiz_questions",
  "lms_enrollments",
  "lms_lesson_progress",
  "lms_quiz_attempts",
  "lms_tasks",
  "lms_task_submissions",
  "lms_task_reviews",
  "lms_learning_paths",
  "lms_learning_path_courses",
  "lms_assignment_rules",
  "lms_certificates",
  "lms_course_feedback",
  "lms_course_announcements",
  "lms_community_posts",
  "lms_community_comments",
  "lms_community_reactions",
  "lms_community_post_reads",
  "lms_project_rubrics",
  "lms_project_rubric_items",
  "lms_project_review_items",
  "lms_learner_workspace_state",
  "lms_learner_notes",
  "lms_learner_bookmarks",
  "lms_learning_deadlines",
  "lms_learner_activity_events",
  "lms_workspace_configs",
  "lms_course_resources",
];

const requiredIndexes = [
  "idx_lms_courses_org_status",
  "idx_lms_enrollments_employee",
  "idx_lms_attempts_enrollment_quiz",
  "idx_lms_submissions_task_employee",
  "idx_lms_posts_course_created",
  "uq_lms_active_enrollment",
  "idx_lms_rubric_items_rubric_sort",
  "idx_lms_notes_enrollment",
  "idx_lms_course_resources_course",
];

const requiredPolicies = [
  "lms_courses_select",
  "lms_enrollments_select",
  "lms_progress_write",
  "lms_attempts_insert",
  "lms_submissions_write",
  "lms_certificates_select",
  "lms_posts_insert",
  "lms_posts_update",
  "lms_comments_insert",
  "lms_comments_update",
  "lms_rubrics_write",
  "lms_learner_notes_rw",
  "lms_review_items_write",
  "lms_course_resources_write",
];

const requiredStoragePolicies = [
  "lms_content_select",
  "lms_content_insert",
  "lms_content_update",
  "lms_content_delete",
];

function assert(condition, label) {
  if (!condition) throw new Error(label);
  console.log(`✓ ${label}`);
}

function sqlLiteral(value) {
  if (Array.isArray(value)) return `array[${value.map(sqlLiteral).join(", ")}]`;
  if (value === null || value === undefined) return "null";
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return `'${String(value).replaceAll("'", "''")}'`;
}

function inlineParams(sql, params = []) {
  return sql.replace(/\$(\d+)(::[a-zA-Z0-9_[\].]+)?/g, (_match, index, cast = "") => {
    const value = params[Number(index) - 1];
    return `${sqlLiteral(value)}${cast}`;
  });
}

async function createQueryClient() {
  if (connectionString) {
    const pgClient = new pg.Client({
      connectionString,
      ssl: connectionString.includes("supabase") ? { rejectUnauthorized: false } : false,
    });
    try {
      await pgClient.connect();
      console.log("Using direct PostgreSQL connection for LMS verification.");
      return {
        query: (sql, params) => pgClient.query(sql, params),
        end: () => pgClient.end(),
      };
    } catch (error) {
      await pgClient.end().catch(() => {});
      console.warn(`Direct PostgreSQL verification connection failed (${error.code || "ERROR"}).`);
    }
  }

  if (!projectRef || !accessToken) {
    throw new Error("Missing reachable database URL and missing NEXT_PUBLIC_SUPABASE_URL/SUPABASE_ACCESS_TOKEN fallback.");
  }

  console.log("Using Supabase Management API fallback for LMS verification.");
  return {
    query: async (sql, params = []) => {
      const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: inlineParams(sql, params) }),
      });
      const text = await response.text();
      if (!response.ok) {
        throw new Error(`Supabase Management API query failed (${response.status}): ${text}`);
      }
      const rows = text ? JSON.parse(text) : [];
      return {
        rows: Array.isArray(rows) ? rows : [],
        rowCount: Array.isArray(rows) ? rows.length : 0,
      };
    },
    end: async () => {},
  };
}

let client;

try {
  client = await createQueryClient();

  const tables = await client.query(
    `select table_name
     from information_schema.tables
     where table_schema = 'public' and table_name = any($1::text[])`,
    [requiredTables]
  );
  const tableSet = new Set(tables.rows.map((row) => row.table_name));
  for (const table of requiredTables) assert(tableSet.has(table), `table exists: ${table}`);

  const rls = await client.query(
    `select relname, relrowsecurity
     from pg_class
     join pg_namespace on pg_namespace.oid = pg_class.relnamespace
     where nspname = 'public' and relname = any($1::text[])`,
    [requiredTables]
  );
  for (const row of rls.rows) assert(row.relrowsecurity === true, `RLS enabled: ${row.relname}`);

  const features = await client.query(
    `select column_name
     from information_schema.columns
     where table_schema = 'public'
       and table_name = 'organization_features'
       and column_name = 'lms_enabled'`
  );
  assert(features.rowCount === 1, "organization_features.lms_enabled exists");

  const enabledModules = await client.query(
    `select column_default
     from information_schema.columns
     where table_schema = 'public'
       and table_name = 'organization_features'
       and column_name = 'enabled_modules'`
  );
  assert(String(enabledModules.rows[0]?.column_default || "").includes("lms"), "organization_features.enabled_modules default includes lms");

  const enumValue = await client.query(
    `select 1
     from pg_enum
     join pg_type on pg_type.oid = pg_enum.enumtypid
     where pg_type.typname = 'notification_type' and enumlabel = 'lms'`
  );
  assert(enumValue.rowCount === 1, "notification_type includes lms");

  const bucket = await client.query(`select public from storage.buckets where id = 'lms-content'`);
  assert(bucket.rowCount === 1, "lms-content bucket exists");
  assert(bucket.rows[0].public === false, "lms-content bucket is private");

  const indexes = await client.query(
    `select indexname from pg_indexes where schemaname = 'public' and indexname = any($1::text[])`,
    [requiredIndexes]
  );
  const indexSet = new Set(indexes.rows.map((row) => row.indexname));
  for (const index of requiredIndexes) assert(indexSet.has(index), `index exists: ${index}`);

  const policies = await client.query(
    `select policyname
     from pg_policies
     where schemaname = 'public' and tablename = any($1::text[])`,
    [requiredTables]
  );
  const policySet = new Set(policies.rows.map((row) => row.policyname));
  for (const policy of requiredPolicies) assert(policySet.has(policy), `policy exists: ${policy}`);
  assert(policySet.size >= requiredTables.length, "LMS RLS policies exist");

  const storagePolicies = await client.query(
    `select policyname, qual, with_check
     from pg_policies
     where schemaname = 'storage'
       and tablename = 'objects'
       and policyname = any($1::text[])`,
    [requiredStoragePolicies]
  );
  const storagePolicySet = new Set(storagePolicies.rows.map((row) => row.policyname));
  for (const policy of requiredStoragePolicies) assert(storagePolicySet.has(policy), `storage policy exists: ${policy}`);
  const selectPolicy = storagePolicies.rows.find((row) => row.policyname === "lms_content_select");
  assert(String(selectPolicy?.qual || "").includes("service_role"), "lms-content select policy is service-role gated");
  assert(!String(selectPolicy?.qual || "").includes("current_org_id"), "lms-content select policy does not expose org-wide browser reads");

  const constraints = await client.query(
    `select conrelid::regclass::text as table_name, conname, pg_get_constraintdef(oid) as definition
     from pg_constraint
     where conrelid in (
       'public.lms_certificates'::regclass,
       'public.lms_task_submissions'::regclass,
       'public.lms_lesson_progress'::regclass,
       'public.lms_quiz_attempts'::regclass
     )`
  );
  const certificateEnrollmentUnique = constraints.rows.some((row) =>
    row.table_name === "lms_certificates"
    && String(row.definition).includes("UNIQUE")
    && String(row.definition).includes("enrollment_id")
  );
  assert(certificateEnrollmentUnique, "certificate uniqueness by enrollment exists");

  const taskSubmissionUnique = constraints.rows.some((row) =>
    row.table_name === "lms_task_submissions"
    && String(row.definition).includes("UNIQUE")
    && String(row.definition).includes("task_id")
    && String(row.definition).includes("enrollment_id")
    && String(row.definition).includes("employee_id")
  );
  assert(taskSubmissionUnique, "task submission uniqueness includes task/enrollment/employee");

  const activeEnrollment = await client.query(
    `select indexdef
     from pg_indexes
     where schemaname = 'public'
       and indexname = 'uq_lms_active_enrollment'`
  );
  assert(String(activeEnrollment.rows[0]?.indexdef || "").includes("employee_id") && String(activeEnrollment.rows[0]?.indexdef || "").includes("course_id"), "duplicate active enrollment protection exists");

  console.log("LMS module verification passed.");
} catch (error) {
  console.error("LMS module verification failed:", error);
  process.exit(1);
} finally {
  await client?.end();
}
