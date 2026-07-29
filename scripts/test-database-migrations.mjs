import { execFileSync, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import pg from "pg";

const { Client } = pg;

const containerName = `hrms-migration-test-${process.pid}-${crypto.randomBytes(3).toString("hex")}`;
const postgresPassword = crypto.randomBytes(18).toString("hex");
let containerStarted = false;

function docker(args, options = {}) {
  return execFileSync("docker", args, { encoding: "utf8", ...options }).trim();
}

function psql(sql) {
  return docker([
    "exec",
    "-i",
    containerName,
    "psql",
    "-U",
    "postgres",
    "-v",
    "ON_ERROR_STOP=1",
  ], { input: sql });
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForPostgres() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const result = spawnSync(
      "docker",
      ["exec", containerName, "pg_isready", "-U", "postgres"],
      { encoding: "utf8" }
    );
    if (result.status === 0) return;
    await delay(250);
  }
  throw new Error("Disposable PostgreSQL did not become ready within 15 seconds.");
}

async function waitForHostPostgres(connectionString) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const client = new Client({ connectionString, connectionTimeoutMillis: 1_000 });
    try {
      await client.connect();
      await client.query("SELECT 1");
      await client.end();
      return;
    } catch {
      await client.end().catch(() => undefined);
      await delay(250);
    }
  }
  throw new Error("Disposable PostgreSQL host port did not become ready within 10 seconds.");
}

async function testConcurrentAccountingNumbers(connectionString) {
  const clients = Array.from({ length: 12 }, () => new Client({ connectionString }));
  try {
    await Promise.all(clients.map(async (client) => {
      await client.connect();
      await client.query("SELECT set_config('request.jwt.claim.role', 'service_role', false)");
    }));
    const values = await Promise.all(clients.map(async (client) => {
      const result = await client.query(
        "SELECT public.next_accounting_document_number($1, 'payment', 'PAY', $2::date) AS value",
        ["11111111-1111-4111-8111-111111111111", "2099-05-01"]
      );
      return result.rows[0]?.value;
    }));
    if (values.some((value) => typeof value !== "string") || new Set(values).size !== values.length) {
      throw new Error(`Concurrent accounting numbering produced duplicates: ${values.join(", ")}`);
    }
  } finally {
    await Promise.all(clients.map((client) => client.end().catch(() => undefined)));
  }
}

async function testConcurrentSimSale(connectionString) {
  const clients = [new Client({ connectionString }), new Client({ connectionString })];
  try {
    await Promise.all(clients.map(async (client) => {
      await client.connect();
      await client.query("SELECT set_config('request.jwt.claim.role', 'service_role', false)");
    }));
    const sql = `SELECT id FROM public.record_sim_sale(
      $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::uuid, 'agent', $7::jsonb
    )`;
    const common = [
      "11111111-1111-4111-8111-111111111111",
      "61616161-6161-4161-8161-616161616161",
    ];
    const attempts = await Promise.allSettled([
      clients[0].query(sql, [...common,
        "d3d3d3d3-d3d3-43d3-83d3-d3d3d3d3d3d3", "d4d4d4d4-d4d4-44d4-84d4-d4d4d4d4d4d4",
        "c3c3c3c3-c3c3-43c3-83c3-c3c3c3c3c3c3", "b2b2b2b2-b2b2-42b2-82b2-b2b2b2b2b2b2",
        JSON.stringify({ customer_name: "Concurrent winner A" })]),
      clients[1].query(sql, [...common,
        "d5d5d5d5-d5d5-45d5-85d5-d5d5d5d5d5d5", "d6d6d6d6-d6d6-46d6-86d6-d6d6d6d6d6d6",
        "c3c3c3c3-c3c3-43c3-83c3-c3c3c3c3c3c3", "b2b2b2b2-b2b2-42b2-82b2-b2b2b2b2b2b2",
        JSON.stringify({ customer_name: "Concurrent winner B" })]),
    ]);
    if (attempts.filter((attempt) => attempt.status === "fulfilled").length !== 1) {
      throw new Error(`Concurrent SIM sale did not produce exactly one winner: ${attempts.map((attempt) => attempt.status).join(", ")}`);
    }
    const check = await clients[0].query(
      `SELECT
        (SELECT count(*)::integer FROM public.sim_sales WHERE organization_id = $1 AND sim_unit_id = $2 AND status = 'active') AS sales,
        (SELECT status::text FROM public.sim_units WHERE organization_id = $1 AND id = $2) AS status`,
      ["11111111-1111-4111-8111-111111111111", "c3c3c3c3-c3c3-43c3-83c3-c3c3c3c3c3c3"]
    );
    if (check.rows[0]?.sales !== 1 || check.rows[0]?.status !== "sold") {
      throw new Error(`Concurrent SIM sale control failed: ${JSON.stringify(check.rows[0])}`);
    }
  } finally {
    await Promise.all(clients.map((client) => client.end().catch(() => undefined)));
  }
}

async function testConcurrentProductSale(connectionString) {
  const clients = [new Client({ connectionString }), new Client({ connectionString })];
  try {
    await Promise.all(clients.map(async (client) => {
      await client.connect();
      await client.query("SELECT set_config('request.jwt.claim.role', 'service_role', false)");
    }));
    const unitResult = await clients[0].query(
      "SELECT id FROM public.product_inventory_units WHERE raw_serial_number = 'VG-PHASE3-0003'"
    );
    const unitId = unitResult.rows[0]?.id;
    if (!unitId) throw new Error("Concurrent product-sale test unit was not prepared.");
    const sql = `SELECT public.execute_product_commerce_command(
      $1::uuid, $2::uuid, $3::uuid, $4::uuid, 'sale', $5::jsonb
    ) AS value`;
    const common = [
      "11111111-1111-4111-8111-111111111111",
      "71717171-7171-4171-8171-717171717171",
    ];
    const attempts = await Promise.allSettled([
      clients[0].query(sql, [...common,
        "ae400101-0000-4000-8000-000000000101",
        "ae400102-0000-4000-8000-000000000102",
        JSON.stringify({
          sale_id: "ae400103-0000-4000-8000-000000000103",
          unit_id: unitId,
          actual_sale_price: 110,
          sale_date: "2099-07-14",
          payment_method: "cash",
          customer_name: "Concurrent product buyer A",
        })]),
      clients[1].query(sql, [...common,
        "ae400104-0000-4000-8000-000000000104",
        "ae400105-0000-4000-8000-000000000105",
        JSON.stringify({
          sale_id: "ae400106-0000-4000-8000-000000000106",
          unit_id: unitId,
          actual_sale_price: 110,
          sale_date: "2099-07-14",
          payment_method: "cash",
          customer_name: "Concurrent product buyer B",
        })]),
    ]);
    if (attempts.filter((attempt) => attempt.status === "fulfilled").length !== 1) {
      throw new Error(`Concurrent product sale did not produce exactly one winner: ${attempts.map((attempt) => attempt.status).join(", ")}`);
    }
    const check = await clients[0].query(
      `SELECT
        (SELECT count(*)::integer FROM public.agent_product_sale_lines line
          JOIN public.agent_product_sales sale ON sale.id = line.sale_id
          WHERE line.unit_id = $1 AND sale.status = 'active') AS sales,
        (SELECT status FROM public.product_inventory_units WHERE id = $1) AS status`,
      [unitId]
    );
    if (check.rows[0]?.sales !== 1 || check.rows[0]?.status !== "sold") {
      throw new Error(`Concurrent product sale control failed: ${JSON.stringify(check.rows[0])}`);
    }
  } finally {
    await Promise.all(clients.map((client) => client.end().catch(() => undefined)));
  }
}

async function testConcurrentProductReceiptConfirmation(connectionString) {
  const clients = [new Client({ connectionString }), new Client({ connectionString })];
  try {
    await Promise.all(clients.map(async (client) => {
      await client.connect();
      await client.query("SELECT set_config('request.jwt.claim.role', 'service_role', false)");
    }));
    const warehouseResult = await clients[0].query(
      `SELECT id FROM public.inventory_warehouses
       WHERE organization_id = $1 AND is_default = true LIMIT 1`,
      ["11111111-1111-4111-8111-111111111111"]
    );
    const warehouseId = warehouseResult.rows[0]?.id;
    if (!warehouseId) throw new Error("Concurrent receipt test warehouse was not prepared.");

    const saveSql = `SELECT public.execute_product_receipt_command(
      $1::uuid, $2::uuid, $3::uuid, $4::uuid, 'receipt_draft_save', $5::jsonb
    ) AS value`;
    const common = [
      "11111111-1111-4111-8111-111111111111",
      "61616161-6161-4161-8161-616161616161",
    ];
    const payload = (receiptId) => JSON.stringify({
      receipt_id: receiptId,
      expected_version: 0,
      supplier_company_id: "e1e1e1e1-e1e1-41e1-81e1-e1e1e1e1e1e1",
      warehouse_id: warehouseId,
      ownership_type: "purchased",
      receipt_date: "2099-07-20",
      currency: "SAR",
      groups: [{
        product_id: "e2e2e2e2-e2e2-42e2-82e2-e2e2e2e2e2e2",
        unit_cost: 60,
        planned_sale_price: 100,
        currency: "SAR",
        tax_included: true,
        condition: "new",
        serial_numbers: ["VG-PHASE6-CONCURRENT-0001"],
      }],
    });
    await Promise.all([
      clients[0].query(saveSql, [...common,
        "af600001-0000-4000-8000-000000000001",
        "af600002-0000-4000-8000-000000000002",
        payload("af600003-0000-4000-8000-000000000003")]),
      clients[1].query(saveSql, [...common,
        "af600004-0000-4000-8000-000000000004",
        "af600005-0000-4000-8000-000000000005",
        payload("af600006-0000-4000-8000-000000000006")]),
    ]);

    const confirmSql = `SELECT public.execute_product_receipt_command(
      $1::uuid, $2::uuid, $3::uuid, $4::uuid, 'receipt_confirm', $5::jsonb
    ) AS value`;
    const attempts = await Promise.allSettled([
      clients[0].query(confirmSql, [...common,
        "af600007-0000-4000-8000-000000000007",
        "af600008-0000-4000-8000-000000000008",
        JSON.stringify({
          receipt_id: "af600003-0000-4000-8000-000000000003",
          expected_version: 1,
        })]),
      clients[1].query(confirmSql, [...common,
        "af600009-0000-4000-8000-000000000009",
        "af600010-0000-4000-8000-000000000010",
        JSON.stringify({
          receipt_id: "af600006-0000-4000-8000-000000000006",
          expected_version: 1,
        })]),
    ]);
    if (attempts.filter((attempt) => attempt.status === "fulfilled").length !== 1) {
      throw new Error(
        `Concurrent receipt confirmation did not produce exactly one winner: ${
          attempts.map((attempt) => attempt.status).join(", ")
        }`
      );
    }
    const check = await clients[0].query(
      `SELECT
        (SELECT count(*)::integer FROM public.product_inventory_units
          WHERE organization_id = $1
            AND normalized_serial_number = 'VG-PHASE6-CONCURRENT-0001') AS units,
        (SELECT count(*)::integer FROM public.product_receipts
          WHERE id IN ($2::uuid, $3::uuid) AND status = 'confirmed') AS confirmed,
        (SELECT count(*)::integer FROM public.product_receipts
          WHERE id IN ($2::uuid, $3::uuid) AND status = 'ready_to_confirm') AS retryable`,
      [
        "11111111-1111-4111-8111-111111111111",
        "af600003-0000-4000-8000-000000000003",
        "af600006-0000-4000-8000-000000000006",
      ]
    );
    if (
      check.rows[0]?.units !== 1
      || check.rows[0]?.confirmed !== 1
      || check.rows[0]?.retryable !== 1
    ) {
      throw new Error(`Concurrent receipt confirmation control failed: ${JSON.stringify(check.rows[0])}`);
    }
  } finally {
    await Promise.all(clients.map((client) => client.end().catch(() => undefined)));
  }
}

async function testConcurrentLmsQuizAttempt(connectionString) {
  const clients = [new Client({ connectionString }), new Client({ connectionString })];
  try {
    await Promise.all(clients.map(async (client) => {
      await client.connect();
      await client.query("SELECT set_config('request.jwt.claim.role', 'service_role', false)");
    }));
    const sql = `SELECT public.submit_lms_quiz_attempt(
      $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::jsonb
    )`;
    const common = [
      "11111111-1111-4111-8111-111111111111",
      "99999999-9999-4999-8999-999999999999",
    ];
    const answers = JSON.stringify({ "74747474-7474-4474-8474-747474747474": "yes" });
    const attempts = await Promise.allSettled([
      clients[0].query(sql, [...common, "75757575-7575-4575-8575-757575757575",
        "71717171-7171-4171-8171-717171717171", "73737373-7373-4373-8373-737373737373", answers]),
      clients[1].query(sql, [...common, "76767676-7676-4676-8676-767676767676",
        "71717171-7171-4171-8171-717171717171", "73737373-7373-4373-8373-737373737373", answers]),
    ]);
    if (attempts.filter((attempt) => attempt.status === "fulfilled").length !== 1) {
      throw new Error(`Concurrent LMS attempt limit did not produce exactly one winner: ${attempts.map((attempt) => attempt.status).join(", ")}`);
    }
    const check = await clients[0].query(
      "SELECT count(*)::integer AS attempts FROM public.lms_quiz_attempts WHERE enrollment_id = $1 AND quiz_id = $2",
      ["71717171-7171-4171-8171-717171717171", "73737373-7373-4373-8373-737373737373"]
    );
    if (check.rows[0]?.attempts !== 1) throw new Error(`LMS concurrent attempt count was ${check.rows[0]?.attempts}.`);
  } finally {
    await Promise.all(clients.map((client) => client.end().catch(() => undefined)));
  }
}

const supabaseStubs = `
  CREATE ROLE anon NOLOGIN;
  CREATE ROLE authenticated NOLOGIN;
  CREATE ROLE service_role NOLOGIN BYPASSRLS;
  CREATE SCHEMA auth;
  CREATE TABLE auth.users (
    id uuid PRIMARY KEY,
    email text,
    raw_user_meta_data jsonb DEFAULT '{}'::jsonb
  );
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
    'SELECT NULLIF(current_setting(''request.jwt.claim.sub'', true), '''')::uuid';
  CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
    'SELECT COALESCE(NULLIF(current_setting(''request.jwt.claim.role'', true), ''''), ''authenticated'')';
  CREATE SCHEMA storage;
  CREATE TABLE storage.buckets (
    id text PRIMARY KEY,
    name text NOT NULL,
    public boolean DEFAULT false,
    file_size_limit bigint,
    allowed_mime_types text[]
  );
  CREATE TABLE storage.objects (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    bucket_id text REFERENCES storage.buckets(id),
    name text NOT NULL,
    owner uuid,
    metadata jsonb DEFAULT '{}'::jsonb
  );
  ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
  CREATE FUNCTION storage.foldername(path text) RETURNS text[] LANGUAGE sql IMMUTABLE AS
    'SELECT string_to_array(path, ''/'')';
`;

const launchAssertions = `
  SET request.jwt.claim.role = 'service_role';

  INSERT INTO public.organizations (id, name, status) VALUES
    ('11111111-1111-4111-8111-111111111111', 'Tenant A', 'Active'),
    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Tenant B', 'Active');
  SELECT public.create_organization_defaults('11111111-1111-4111-8111-111111111111', NULL);
  SELECT public.create_organization_defaults('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', NULL);

  INSERT INTO auth.users (id, email) VALUES
    ('22222222-2222-4222-8222-222222222222', 'hr-a@example.test'),
    ('45454545-4545-4545-8545-454545454545', 'finance-a@example.test'),
    ('61616161-6161-4161-8161-616161616161', 'sales-manager-a@example.test'),
    ('99999999-9999-4999-8999-999999999999', 'employee-a@example.test'),
    ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'employee-b@example.test');
  INSERT INTO public.org_members (org_id, user_id, role) VALUES
    ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'hr_admin'),
    ('11111111-1111-4111-8111-111111111111', '45454545-4545-4545-8545-454545454545', 'finance_manager'),
    ('11111111-1111-4111-8111-111111111111', '61616161-6161-4161-8161-616161616161', 'sales_manager'),
    ('11111111-1111-4111-8111-111111111111', '99999999-9999-4999-8999-999999999999', 'employee'),
    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'employee');
  UPDATE public.profiles SET org_id = '11111111-1111-4111-8111-111111111111'
    WHERE user_id = '22222222-2222-4222-8222-222222222222';
  UPDATE public.profiles SET org_id = '11111111-1111-4111-8111-111111111111'
    WHERE user_id = '45454545-4545-4545-8545-454545454545';
  UPDATE public.profiles SET org_id = '11111111-1111-4111-8111-111111111111'
    WHERE user_id = '61616161-6161-4161-8161-616161616161';
  UPDATE public.profiles SET org_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    WHERE user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  UPDATE public.profiles SET org_id = '11111111-1111-4111-8111-111111111111'
    WHERE user_id = '99999999-9999-4999-8999-999999999999';
  INSERT INTO public.employees (id, org_id, user_id, full_name) VALUES
    ('33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'Tenant A HR'),
    ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Tenant B Employee');
  INSERT INTO public.employees (
    id, org_id, user_id, full_name, manager_id, hiring_date, leave_accrual_start_date
  ) VALUES (
    '12121212-1212-4212-8212-121212121212',
    '11111111-1111-4111-8111-111111111111',
    '99999999-9999-4999-8999-999999999999',
    'Tenant A Employee',
    '33333333-3333-4333-8333-333333333333',
    '2098-01-01',
    '2098-01-01'
  );
  INSERT INTO public.locations (id, org_id, name, latitude, longitude, radius_meters) VALUES
    ('55555555-5555-4555-8555-555555555555', '11111111-1111-4111-8111-111111111111', 'Tenant A Office', 30.0444, 31.2357, 100);
  UPDATE public.employees
  SET location_id = '55555555-5555-4555-8555-555555555555'
  WHERE id = '33333333-3333-4333-8333-333333333333';
  INSERT INTO public.leave_balances (
    org_id, employee_id, vacation_remaining, sick_remaining, emergency_remaining
  ) VALUES (
    '11111111-1111-4111-8111-111111111111',
    '12121212-1212-4212-8212-121212121212',
    10,
    5,
    2
  );
  INSERT INTO public.leave_requests (
    id, org_id, employee_id, leave_type, start_date, end_date, days_count,
    status, current_step, total_steps, manager_approval_status, hr_approval_status
  ) VALUES (
    '13131313-1313-4313-8313-131313131313',
    '11111111-1111-4111-8111-111111111111',
    '12121212-1212-4212-8212-121212121212',
    'vacation',
    '2099-01-10',
    '2099-01-12',
    3,
    'pending',
    1,
    2,
    'pending',
    'pending'
  );

  GRANT USAGE ON SCHEMA public, auth TO authenticated;
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
  GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public, auth TO authenticated;

  SET ROLE authenticated;
  SELECT set_config('request.jwt.claim.role', 'authenticated', false);
  SELECT set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', false);

  DO $test$
  DECLARE
    visible_employees integer;
    visible_organizations integer;
    affected_rows integer;
  BEGIN
    SELECT count(*) INTO visible_employees FROM public.employees;
    SELECT count(*) INTO visible_organizations FROM public.organizations;
    IF visible_employees <> 2 OR visible_organizations <> 1 THEN
      RAISE EXCEPTION 'Cross-tenant RLS isolation failed: employees %, organizations %',
        visible_employees, visible_organizations;
    END IF;
    IF NOT public.can_manage_people() OR public.is_admin() THEN
      RAISE EXCEPTION 'HR-admin capability matrix is inconsistent.';
    END IF;
    IF public.organization_business_date(
      '11111111-1111-4111-8111-111111111111',
      '2026-07-17 21:00:00+00'
    ) <> DATE '2026-07-18' THEN
      RAISE EXCEPTION 'Organization business date is incorrect.';
    END IF;
    BEGIN
      INSERT INTO public.departments (org_id, name)
      VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Forbidden cross-tenant department');
      RAISE EXCEPTION 'Cross-tenant insert unexpectedly succeeded.';
    EXCEPTION WHEN insufficient_privilege THEN
      NULL;
    END;
    BEGIN
      INSERT INTO public.attendance_records (org_id, employee_id)
      VALUES ('11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333');
      RAISE EXCEPTION 'Direct browser attendance insert unexpectedly succeeded.';
    EXCEPTION WHEN insufficient_privilege THEN
      NULL;
    END;
    UPDATE public.leave_requests SET status = 'approved'
    WHERE id = '13131313-1313-4313-8313-131313131313';
    GET DIAGNOSTICS affected_rows = ROW_COUNT;
    IF affected_rows <> 0 THEN
      RAISE EXCEPTION 'Direct browser leave update unexpectedly succeeded.';
    END IF;
    UPDATE public.leave_balances SET vacation_remaining = 999
    WHERE employee_id = '12121212-1212-4212-8212-121212121212';
    GET DIAGNOSTICS affected_rows = ROW_COUNT;
    IF affected_rows <> 0 THEN
      RAISE EXCEPTION 'Direct browser leave balance update unexpectedly succeeded.';
    END IF;
  END
  $test$;

  RESET ROLE;
  SET request.jwt.claim.role = 'service_role';
  DO $test$
  DECLARE
    checked_in public.attendance_records;
    retried_check_in public.attendance_records;
    checked_out public.attendance_records;
    retried_check_out public.attendance_records;
  BEGIN
    SELECT * INTO checked_in FROM public.attendance_check_in(
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      '66666666-6666-4666-8666-666666666666',
      30.0444,
      31.2357,
      5,
      'test browser',
      'forgeable-device-signal',
      NULL
    );
    SELECT * INTO retried_check_in FROM public.attendance_check_in(
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      '66666666-6666-4666-8666-666666666666',
      30.0444,
      31.2357,
      5,
      'test browser',
      'forgeable-device-signal',
      NULL
    );
    SELECT * INTO checked_out FROM public.attendance_check_out(
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      checked_in.id,
      '77777777-7777-4777-8777-777777777777',
      30.0444,
      31.2357,
      5,
      'test browser',
      'forgeable-device-signal'
    );
    SELECT * INTO retried_check_out FROM public.attendance_check_out(
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      checked_in.id,
      '77777777-7777-4777-8777-777777777777',
      30.0444,
      31.2357,
      5,
      'test browser',
      'forgeable-device-signal'
    );
    IF checked_in.id IS NULL
       OR checked_in.id <> retried_check_in.id
       OR NOT checked_in.within_geofence
       OR checked_in.employee_id <> '33333333-3333-4333-8333-333333333333'
       OR checked_in.check_in_at IS NULL
       OR checked_in.device_risk_metadata->>'device_signal_trusted' <> 'false' THEN
      RAISE EXCEPTION 'Authoritative/idempotent check-in failed.';
    END IF;
    IF checked_out.id <> retried_check_out.id OR checked_out.check_out_at IS NULL THEN
      RAISE EXCEPTION 'Authoritative/idempotent check-out failed.';
    END IF;
    IF (SELECT count(*) FROM public.attendance_records WHERE employee_id = checked_in.employee_id) <> 1 THEN
      RAISE EXCEPTION 'Attendance retry created a duplicate row.';
    END IF;
    BEGIN
      PERFORM * FROM public.attendance_check_in(
        '11111111-1111-4111-8111-111111111111',
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        '88888888-8888-4888-8888-888888888888',
        30.0444,
        31.2357,
        NULL,
        NULL,
        NULL,
        NULL
      );
      RAISE EXCEPTION 'Cross-tenant attendance unexpectedly succeeded.';
    EXCEPTION WHEN insufficient_privilege THEN
      NULL;
    END;
  END
  $test$;

  DO $test$
  DECLARE
    manager_review public.leave_requests;
    final_review public.leave_requests;
    retried_review public.leave_requests;
    remaining_balance numeric;
    ledger_rows integer;
    notification_rows integer;
  BEGIN
    SELECT * INTO manager_review FROM public.review_leave_request(
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      '13131313-1313-4313-8313-131313131313',
      '14141414-1414-4414-8414-141414141414',
      'approved',
      'Manager approval'
    );
    IF manager_review.status <> 'pending' OR manager_review.current_step <> 2 THEN
      RAISE EXCEPTION 'Leave manager step was not advanced atomically.';
    END IF;

    SELECT * INTO final_review FROM public.review_leave_request(
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      '13131313-1313-4313-8313-131313131313',
      '15151515-1515-4515-8515-151515151515',
      'approved',
      'HR approval'
    );
    SELECT * INTO retried_review FROM public.review_leave_request(
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      '13131313-1313-4313-8313-131313131313',
      '15151515-1515-4515-8515-151515151515',
      'approved',
      'HR approval retry'
    );
    SELECT vacation_remaining INTO remaining_balance
    FROM public.leave_balances
    WHERE employee_id = '12121212-1212-4212-8212-121212121212';
    SELECT count(*) INTO ledger_rows
    FROM public.leave_balance_transactions
    WHERE leave_request_id = '13131313-1313-4313-8313-131313131313'
      AND transaction_type = 'leave_deduction';
    SELECT count(*) INTO notification_rows
    FROM public.event_outbox outbox
    JOIN public.business_events event ON event.id = outbox.business_event_id
    WHERE event.source_type = 'leave.reviewed'
      AND event.business_key = '13131313-1313-4313-8313-131313131313:approved';
    IF final_review.status <> 'approved'
       OR final_review.id <> retried_review.id
       OR remaining_balance <> 7
       OR ledger_rows <> 1
       OR notification_rows <> 1 THEN
      RAISE EXCEPTION
        'Atomic/idempotent leave approval failed: status %, balance %, ledger %, notifications %',
        final_review.status, remaining_balance, ledger_rows, notification_rows;
    END IF;

    BEGIN
      INSERT INTO public.leave_requests (
        org_id, employee_id, leave_type, start_date, end_date, status
      ) VALUES (
        '11111111-1111-4111-8111-111111111111',
        '12121212-1212-4212-8212-121212121212',
        'vacation',
        '2099-01-11',
        '2099-01-13',
        'pending'
      );
      RAISE EXCEPTION 'Overlapping leave unexpectedly succeeded.';
    EXCEPTION WHEN exclusion_violation THEN
      NULL;
    END;
  END
  $test$;

  DO $test$
  DECLARE
    refreshed_balance public.leave_balances;
    replayed_refresh public.leave_balances;
    cancelled_request public.leave_requests;
    replayed_cancellation public.leave_requests;
    adjusted_balance public.leave_balances;
    replayed_adjustment public.leave_balances;
    remaining_balance numeric;
    refresh_commands integer;
    reversal_rows integer;
    adjustment_rows integer;
    cancellation_events integer;
    cancellation_notifications integer;
    cancellation_previous_status text;
  BEGIN
    SELECT * INTO refreshed_balance FROM public.refresh_employee_leave_balance(
      '11111111-1111-4111-8111-111111111111',
      '12121212-1212-4212-8212-121212121212',
      '99999999-9999-4999-8999-999999999999',
      '17171717-1717-4717-8717-171717171717'
    );
    SELECT * INTO replayed_refresh FROM public.refresh_employee_leave_balance(
      '11111111-1111-4111-8111-111111111111',
      '12121212-1212-4212-8212-121212121212',
      '99999999-9999-4999-8999-999999999999',
      '17171717-1717-4717-8717-171717171717'
    );
    SELECT count(*) INTO refresh_commands FROM public.leave_commands
    WHERE org_id = '11111111-1111-4111-8111-111111111111'
      AND idempotency_key = '17171717-1717-4717-8717-171717171717'
      AND action = 'refresh_balance' AND status = 'completed';
    IF refreshed_balance.id IS NULL OR refreshed_balance.id <> replayed_refresh.id OR refresh_commands <> 1 THEN
      RAISE EXCEPTION 'Self-service/idempotent balance refresh failed.';
    END IF;

    SELECT * INTO cancelled_request FROM public.cancel_leave_request(
      '11111111-1111-4111-8111-111111111111',
      '13131313-1313-4313-8313-131313131313',
      '22222222-2222-4222-8222-222222222222',
      '18181818-1818-4818-8818-181818181818',
      'Approved leave no longer required'
    );
    SELECT * INTO replayed_cancellation FROM public.cancel_leave_request(
      '11111111-1111-4111-8111-111111111111',
      '13131313-1313-4313-8313-131313131313',
      '22222222-2222-4222-8222-222222222222',
      '18181818-1818-4818-8818-181818181818',
      'Approved leave no longer required'
    );
    SELECT vacation_remaining INTO remaining_balance FROM public.leave_balances
    WHERE employee_id = '12121212-1212-4212-8212-121212121212';
    SELECT count(*) INTO reversal_rows FROM public.leave_balance_transactions
    WHERE leave_request_id = '13131313-1313-4313-8313-131313131313'
      AND transaction_type = 'leave_reversal';
    SELECT count(*), max(event.payload->>'previous_status')
      INTO cancellation_events, cancellation_previous_status
    FROM public.business_events event
    WHERE event.org_id = '11111111-1111-4111-8111-111111111111'
      AND event.source_type = 'leave.cancelled'
      AND event.business_key = '13131313-1313-4313-8313-131313131313';
    SELECT count(*) INTO cancellation_notifications
    FROM public.event_outbox outbox
    JOIN public.business_events event ON event.id = outbox.business_event_id
    WHERE event.source_type = 'leave.cancelled'
      AND event.business_key = '13131313-1313-4313-8313-131313131313';
    IF cancelled_request.status <> 'cancelled'
       OR replayed_cancellation.id <> cancelled_request.id
       OR remaining_balance <> 10
       OR reversal_rows <> 1
       OR cancellation_events <> 1
       OR cancellation_notifications <> 1
       OR cancellation_previous_status <> 'approved' THEN
      RAISE EXCEPTION
        'Atomic/idempotent leave cancellation failed: status %, balance %, reversals %, events %, notifications %, previous %',
        cancelled_request.status, remaining_balance, reversal_rows, cancellation_events,
        cancellation_notifications, cancellation_previous_status;
    END IF;

    SELECT * INTO adjusted_balance FROM public.adjust_employee_leave_balance(
      '11111111-1111-4111-8111-111111111111',
      '12121212-1212-4212-8212-121212121212',
      '22222222-2222-4222-8222-222222222222',
      '19191919-1919-4919-8919-191919191919',
      'vacation', 2, 'Launch smoke adjustment'
    );
    SELECT * INTO replayed_adjustment FROM public.adjust_employee_leave_balance(
      '11111111-1111-4111-8111-111111111111',
      '12121212-1212-4212-8212-121212121212',
      '22222222-2222-4222-8222-222222222222',
      '19191919-1919-4919-8919-191919191919',
      'vacation', 2, 'Launch smoke adjustment'
    );
    SELECT count(*) INTO adjustment_rows FROM public.leave_balance_transactions
    WHERE org_id = '11111111-1111-4111-8111-111111111111'
      AND command_id = '19191919-1919-4919-8919-191919191919'
      AND transaction_type = 'manual_adjustment';
    IF adjusted_balance.vacation_remaining <> 12
       OR replayed_adjustment.id <> adjusted_balance.id
       OR adjustment_rows <> 1 THEN
      RAISE EXCEPTION 'Atomic/idempotent leave adjustment failed: balance %, ledger %',
        adjusted_balance.vacation_remaining, adjustment_rows;
    END IF;
  END
  $test$;

  INSERT INTO auth.users (id, email) VALUES
    ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'platform-admin@example.test'),
    ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'invited-org-admin@example.test');
  INSERT INTO public.platform_admins (user_id, role, status) VALUES
    ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'superadmin', 'active');

  CREATE OR REPLACE FUNCTION public.test_reject_atomic_tenant_defaults()
  RETURNS trigger LANGUAGE plpgsql AS $testfn$
  BEGIN
    IF (SELECT name FROM public.organizations WHERE id = NEW.org_id) = 'Rollback Tenant' THEN
      RAISE EXCEPTION 'Injected tenant-default failure.';
    END IF;
    RETURN NEW;
  END
  $testfn$;
  CREATE TRIGGER test_reject_atomic_tenant_defaults_trigger
    BEFORE INSERT ON public.organization_features
    FOR EACH ROW EXECUTE FUNCTION public.test_reject_atomic_tenant_defaults();

  DO $test$
  DECLARE
    created jsonb;
    replayed jsonb;
    updated jsonb;
    update_replay jsonb;
    created_org_id uuid;
    create_conflict boolean := false;
    update_conflict boolean := false;
    rollback_failed boolean := false;
  BEGIN
    BEGIN
      PERFORM public.execute_organization_command(
        'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        'a9900000-0000-4000-8000-000000000001',
        'a9900000-0000-4000-8000-000000000002',
        'platform_create', NULL, 0, 0,
        '{"name":"Rollback Tenant","slug":"rollback-tenant","status":"Active"}'::jsonb
      );
    EXCEPTION WHEN OTHERS THEN
      rollback_failed := true;
    END;
    IF NOT rollback_failed
       OR EXISTS (SELECT 1 FROM public.organizations WHERE slug = 'rollback-tenant')
       OR EXISTS (SELECT 1 FROM public.organization_commands
         WHERE id = 'a9900000-0000-4000-8000-000000000002') THEN
      RAISE EXCEPTION 'Failed tenant provisioning left a partial organization or command.';
    END IF;

    created := public.execute_organization_command(
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      'a9900000-0000-4000-8000-000000000003',
      'a9900000-0000-4000-8000-000000000004',
      'platform_create', NULL, 0, 0,
      '{"name":"Atomic Tenant","slug":"atomic-tenant","status":"Active"}'::jsonb
    );
    replayed := public.execute_organization_command(
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      'a9900000-0000-4000-8000-000000000005',
      'a9900000-0000-4000-8000-000000000004',
      'platform_create', NULL, 999, 999,
      '{"name":"Atomic Tenant","slug":"atomic-tenant","status":"Active"}'::jsonb
    );
    created_org_id := (created->>'id')::uuid;
    BEGIN
      PERFORM public.execute_organization_command(
        'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        'a9900000-0000-4000-8000-000000000006',
        'a9900000-0000-4000-8000-000000000004',
        'platform_create', NULL, 0, 0,
        '{"name":"Different Tenant","slug":"atomic-tenant","status":"Active"}'::jsonb
      );
    EXCEPTION WHEN unique_violation THEN
      create_conflict := true;
    END;

    updated := public.execute_organization_command(
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      'a9900000-0000-4000-8000-000000000007',
      'a9900000-0000-4000-8000-000000000008',
      'platform_update', created_org_id, 0, NULL,
      '{"name":"Atomic Tenant Updated","status":"Suspended"}'::jsonb
    );
    update_replay := public.execute_organization_command(
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      'a9900000-0000-4000-8000-000000000009',
      'a9900000-0000-4000-8000-000000000008',
      'platform_update', created_org_id, 999, NULL,
      '{"name":"Atomic Tenant Updated","status":"Suspended"}'::jsonb
    );
    BEGIN
      PERFORM public.execute_organization_command(
        'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        'a9900000-0000-4000-8000-000000000010',
        'a9900000-0000-4000-8000-000000000008',
        'platform_update', created_org_id, 1, NULL,
        '{"name":"Conflicting Tenant","status":"Suspended"}'::jsonb
      );
    EXCEPTION WHEN unique_violation THEN
      update_conflict := true;
    END;

    IF created IS DISTINCT FROM replayed OR updated IS DISTINCT FROM update_replay
       OR NOT create_conflict OR NOT update_conflict
       OR (SELECT count(*) FROM public.organizations WHERE slug = 'atomic-tenant') <> 1
       OR (SELECT count(*) FROM public.organization_settings WHERE org_id = created_org_id) <> 1
       OR (SELECT count(*) FROM public.organization_features WHERE org_id = created_org_id) <> 1
       OR (SELECT count(*) FROM public.organization_subscriptions WHERE org_id = created_org_id) <> 1
       OR (SELECT count(*) FROM public.organization_usage WHERE org_id = created_org_id) <> 1
       OR (SELECT count(*) FROM public.approval_workflows WHERE org_id = created_org_id) <> 2
       OR (SELECT count(*) FROM public.organization_quota_events
         WHERE org_id = created_org_id AND quota_key = 'tenant_defaults') <> 1
       OR (SELECT count(*) FROM public.platform_audit_logs
         WHERE target_org_id = created_org_id
           AND action IN ('organization.created', 'organization.suspended')) <> 2
       OR (SELECT count(*) FROM public.event_outbox
         WHERE org_id = created_org_id
           AND topic IN ('platform.organization_created', 'platform.organization_updated')) <> 2
       OR updated->>'name' <> 'Atomic Tenant Updated'
       OR updated->>'status' <> 'Suspended'
       OR (updated->>'version')::integer <> 1 THEN
      RAISE EXCEPTION 'Atomic organization create/update replay, defaults, audit, or event proof failed.';
    END IF;
  END
  $test$;

  DROP TRIGGER test_reject_atomic_tenant_defaults_trigger ON public.organization_features;
  DROP FUNCTION public.test_reject_atomic_tenant_defaults();

  CREATE OR REPLACE FUNCTION public.test_reject_atomic_settings_update()
  RETURNS trigger LANGUAGE plpgsql AS $testfn$
  BEGIN
    IF NEW.tagline = 'force-rollback' THEN
      RAISE EXCEPTION 'Injected organization-settings failure.';
    END IF;
    RETURN NEW;
  END
  $testfn$;
  CREATE TRIGGER test_reject_atomic_settings_update_trigger
    BEFORE UPDATE ON public.organization_settings
    FOR EACH ROW EXECUTE FUNCTION public.test_reject_atomic_settings_update();

  DO $test$
  DECLARE
    saved jsonb;
    replayed jsonb;
    conflict_denied boolean := false;
    cross_tenant_denied boolean := false;
    rollback_failed boolean := false;
    original_name text;
    original_org_version integer;
    original_settings_version integer;
  BEGIN
    SELECT name, version INTO original_name, original_org_version
    FROM public.organizations WHERE id = '11111111-1111-4111-8111-111111111111';
    SELECT version INTO original_settings_version FROM public.organization_settings
    WHERE org_id = '11111111-1111-4111-8111-111111111111';

    BEGIN
      PERFORM public.execute_organization_command(
        '22222222-2222-4222-8222-222222222222',
        'a9900000-0000-4000-8000-000000000011',
        'a9900000-0000-4000-8000-000000000012',
        'tenant_settings_update', '11111111-1111-4111-8111-111111111111',
        original_org_version, original_settings_version,
        '{"name":"Must Roll Back","settings":{"tagline":"force-rollback"}}'::jsonb
      );
    EXCEPTION WHEN OTHERS THEN
      rollback_failed := true;
    END;
    IF NOT rollback_failed
       OR (SELECT name FROM public.organizations
         WHERE id = '11111111-1111-4111-8111-111111111111') <> original_name
       OR (SELECT version FROM public.organizations
         WHERE id = '11111111-1111-4111-8111-111111111111') <> original_org_version
       OR EXISTS (SELECT 1 FROM public.organization_commands
         WHERE id = 'a9900000-0000-4000-8000-000000000012') THEN
      RAISE EXCEPTION 'Failed two-table settings update left a partial organization change.';
    END IF;

    saved := public.execute_organization_command(
      '22222222-2222-4222-8222-222222222222',
      'a9900000-0000-4000-8000-000000000013',
      'a9900000-0000-4000-8000-000000000014',
      'tenant_settings_update', '11111111-1111-4111-8111-111111111111',
      original_org_version, original_settings_version,
      '{"name":"Tenant A Configured","settings":{"brand_name":"Tenant A Brand","primary_color":"#123abc"}}'::jsonb
    );
    replayed := public.execute_organization_command(
      '22222222-2222-4222-8222-222222222222',
      'a9900000-0000-4000-8000-000000000015',
      'a9900000-0000-4000-8000-000000000014',
      'tenant_settings_update', '11111111-1111-4111-8111-111111111111',
      999, 999,
      '{"name":"Tenant A Configured","settings":{"brand_name":"Tenant A Brand","primary_color":"#123abc"}}'::jsonb
    );
    BEGIN
      PERFORM public.execute_organization_command(
        '22222222-2222-4222-8222-222222222222',
        'a9900000-0000-4000-8000-000000000016',
        'a9900000-0000-4000-8000-000000000014',
        'tenant_settings_update', '11111111-1111-4111-8111-111111111111',
        original_org_version + 1, original_settings_version + 1,
        '{"name":"Different Name","settings":{"brand_name":"Other Brand"}}'::jsonb
      );
    EXCEPTION WHEN unique_violation THEN
      conflict_denied := true;
    END;
    BEGIN
      PERFORM public.execute_organization_command(
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        'a9900000-0000-4000-8000-000000000017',
        'a9900000-0000-4000-8000-000000000018',
        'tenant_settings_update', '11111111-1111-4111-8111-111111111111',
        original_org_version + 1, original_settings_version + 1,
        '{"name":"Cross Tenant Name"}'::jsonb
      );
    EXCEPTION WHEN insufficient_privilege THEN
      cross_tenant_denied := true;
    END;

    IF saved IS DISTINCT FROM replayed OR NOT conflict_denied OR NOT cross_tenant_denied
       OR (SELECT name FROM public.organizations
         WHERE id = '11111111-1111-4111-8111-111111111111') <> 'Tenant A Configured'
       OR (SELECT brand_name FROM public.organization_settings
         WHERE org_id = '11111111-1111-4111-8111-111111111111') <> 'Tenant A Brand'
       OR (SELECT primary_color FROM public.organization_settings
         WHERE org_id = '11111111-1111-4111-8111-111111111111') <> '#123abc'
       OR (SELECT version FROM public.organizations
         WHERE id = '11111111-1111-4111-8111-111111111111') <> original_org_version + 1
       OR (SELECT version FROM public.organization_settings
         WHERE org_id = '11111111-1111-4111-8111-111111111111') <> original_settings_version + 1
       OR (SELECT count(*) FROM public.operational_audit_logs
         WHERE action = 'organization.settings_updated'
           AND target_id = '11111111-1111-4111-8111-111111111111') <> 1
       OR (SELECT count(*) FROM public.event_outbox
         WHERE org_id = '11111111-1111-4111-8111-111111111111'
           AND topic = 'organization.settings_updated') <> 1 THEN
      RAISE EXCEPTION 'Atomic tenant settings replay, isolation, audit, or event proof failed.';
    END IF;
  END
  $test$;

  DROP TRIGGER test_reject_atomic_settings_update_trigger ON public.organization_settings;
  DROP FUNCTION public.test_reject_atomic_settings_update();

  SELECT public.provision_organization_admin_identity(
    '11111111-1111-4111-8111-111111111111',
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    'invited-org-admin@example.test',
    'Invited Organization Admin'
  );
  SELECT public.provision_organization_admin_identity(
    '11111111-1111-4111-8111-111111111111',
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    'invited-org-admin@example.test',
    'Invited Organization Admin'
  );
  DO $test$
  BEGIN
    IF (SELECT count(*) FROM public.org_members
        WHERE org_id = '11111111-1111-4111-8111-111111111111'
          AND user_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
          AND role = 'admin') <> 1
       OR (SELECT account_status FROM public.profiles
           WHERE user_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee') <> 'Active'
       OR EXISTS (SELECT 1 FROM public.employees
                  WHERE user_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee') THEN
      RAISE EXCEPTION 'Invitation-based organization admin provisioning is inconsistent.';
    END IF;
  END
  $test$;

  SET ROLE authenticated;
  SELECT set_config('request.jwt.claim.role', 'authenticated', false);
  SELECT set_config('request.jwt.claim.sub', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', false);
  DO $test$
  DECLARE affected_rows integer;
  BEGIN
    UPDATE public.organizations SET name = 'Browser Bypass'
    WHERE id = '11111111-1111-4111-8111-111111111111';
    GET DIAGNOSTICS affected_rows = ROW_COUNT;
    IF affected_rows <> 0 THEN
      RAISE EXCEPTION 'Direct browser organization update unexpectedly succeeded.';
    END IF;
    UPDATE public.organization_settings SET brand_name = 'Browser Bypass'
    WHERE org_id = '11111111-1111-4111-8111-111111111111';
    GET DIAGNOSTICS affected_rows = ROW_COUNT;
    IF affected_rows <> 0 THEN
      RAISE EXCEPTION 'Direct browser organization settings update unexpectedly succeeded.';
    END IF;
  END
  $test$;
  RESET ROLE;
  SET request.jwt.claim.role = 'service_role';

  DO $test$
  DECLARE role_updated jsonb; role_replay jsonb; suspended jsonb; conflict_denied boolean:=false;
  BEGIN
    role_updated:=public.execute_platform_user_command(
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd','ad100000-0000-4000-8000-000000000001',
      'ad100000-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111',
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','update_role','hr_admin',NULL);
    role_replay:=public.execute_platform_user_command(
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd','ad100000-0000-4000-8000-000000000001',
      'ad100000-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111',
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','update_role','hr_admin',NULL);
    suspended:=public.execute_platform_user_command(
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd','ad100000-0000-4000-8000-000000000003',
      'ad100000-0000-4000-8000-000000000004','11111111-1111-4111-8111-111111111111',
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','suspend',NULL,NULL);
    BEGIN
      PERFORM public.execute_platform_user_command(
        'dddddddd-dddd-4ddd-8ddd-dddddddddddd','ad100000-0000-4000-8000-000000000005',
        'ad100000-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111',
        'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','update_role','admin',NULL);
    EXCEPTION WHEN unique_violation THEN conflict_denied:=true;
    END;
    IF role_updated IS DISTINCT FROM role_replay OR NOT conflict_denied
       OR role_updated->>'role'<>'hr_admin' OR suspended->>'account_status'<>'suspended'
       OR (SELECT role::text FROM public.org_members WHERE user_id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee')<>'hr_admin'
       OR (SELECT account_status FROM public.profiles WHERE user_id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee')<>'suspended'
       OR (SELECT count(*) FROM public.platform_audit_logs
         WHERE target_user_id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
           AND action IN('organization_user.role_updated','organization_user.suspended'))<>2
       OR (SELECT count(*) FROM public.event_outbox WHERE topic='platform.organization_user_controlled'
         AND payload->>'target_user_id'='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee')<>2 THEN
      RAISE EXCEPTION 'Platform user proof failed: replay %, conflict %, returned role %, returned status %, db role %, db status %, audits %, events %.',
        role_updated IS NOT DISTINCT FROM role_replay, conflict_denied, role_updated->>'role', suspended->>'account_status',
        (SELECT role::text FROM public.org_members WHERE user_id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'),
        (SELECT account_status FROM public.profiles WHERE user_id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'),
        (SELECT count(*) FROM public.platform_audit_logs WHERE target_user_id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
          AND action IN('organization_user.role_updated','organization_user.suspended')),
        (SELECT count(*) FROM public.event_outbox WHERE topic='platform.organization_user_controlled'
          AND payload->>'target_user_id'='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
    END IF;
  END
  $test$;

  INSERT INTO auth.users (id, email) VALUES
    ('16161616-1616-4616-8616-161616161616', 'lifecycle-employee@example.test');

  DO $test$
  DECLARE
    onboarding public.employees;
    replayed_onboarding public.employees;
    linked public.employees;
    finalized public.employees;
    replayed_finalized public.employees;
    offboarded public.employees;
    replayed_offboarded public.employees;
    lifecycle_balance_count integer;
    lifecycle_initial_count integer;
    membership_count integer;
    browser_rows integer;
  BEGIN
    SELECT * INTO onboarding FROM public.begin_employee_onboarding(
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      '17171717-1717-4717-8717-171717171717',
      jsonb_build_object(
        'full_name', 'Lifecycle Employee',
        'email', 'lifecycle-employee@example.test',
        'hiring_date', '2098-01-01',
        'employment_type', 'full_time',
        'status', 'Active',
        'location_id', '55555555-5555-4555-8555-555555555555'
      ),
      'hr',
      NULL
    );
    SELECT * INTO replayed_onboarding FROM public.begin_employee_onboarding(
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      '17171717-1717-4717-8717-171717171717',
      jsonb_build_object(
        'full_name', 'Lifecycle Employee',
        'email', 'lifecycle-employee@example.test',
        'hiring_date', '2098-01-01',
        'employment_type', 'full_time',
        'status', 'Active',
        'location_id', '55555555-5555-4555-8555-555555555555'
      ),
      'hr',
      NULL
    );
    SELECT count(*) INTO lifecycle_balance_count FROM public.leave_balances WHERE employee_id = onboarding.id;
    SELECT count(*) INTO lifecycle_initial_count FROM public.leave_balance_transactions
      WHERE employee_id = onboarding.id AND transaction_type = 'initial';
    IF onboarding.id IS NULL OR onboarding.id <> replayed_onboarding.id
       OR onboarding.lifecycle_status <> 'onboarding'
       OR lifecycle_balance_count <> 1 OR lifecycle_initial_count <> 1 THEN
      RAISE EXCEPTION 'Idempotent employee onboarding did not create exactly one coherent draft.';
    END IF;

    SELECT * INTO linked FROM public.link_employee_identity(
      '11111111-1111-4111-8111-111111111111', onboarding.id,
      '22222222-2222-4222-8222-222222222222',
      '18181818-1818-4818-8818-181818181818',
      '16161616-1616-4616-8616-161616161616',
      'lifecycle-employee@example.test', 'Lifecycle Employee', 'hr_recruitment'
    );
    IF linked.user_id <> '16161616-1616-4616-8616-161616161616'
       OR (SELECT role FROM public.org_members
           WHERE org_id = '11111111-1111-4111-8111-111111111111'
             AND user_id = '16161616-1616-4616-8616-161616161616') <> 'hr_recruitment' THEN
      RAISE EXCEPTION 'Employee identity was not linked atomically.';
    END IF;

    INSERT INTO public.personnel_files (org_id, employee_id, category, file_name, file_path)
    VALUES ('11111111-1111-4111-8111-111111111111', onboarding.id, 'official', 'official.pdf', 'smoke/official.pdf');
    INSERT INTO public.employee_contracts (org_id, employee_id, start_date, status)
    VALUES ('11111111-1111-4111-8111-111111111111', onboarding.id, '2098-01-01', 'active');
    PERFORM public.configure_employee_social_insurance(
      '11111111-1111-4111-8111-111111111111', onboarding.id,
      '22222222-2222-4222-8222-222222222222',
      '38383838-3838-4838-8838-383838383838',
      '39393939-3939-4939-8939-393939393939',
      jsonb_build_object(
        'registered', true, 'gosiNumber', 'SMOKE-GOSI',
        'registrationDate', '2098-01-01', 'schemeCode', 'verified-lifecycle-smoke',
        'contributoryWage', 1000, 'maximumContributoryWage', 45000,
        'employeeRateBasisPoints', 975, 'employerRateBasisPoints', 1175,
        'proratePartialMonth', false, 'effectiveFrom', '2098-01-01', 'effectiveTo', ''
      )
    );
    PERFORM public.set_employee_locations(
      '11111111-1111-4111-8111-111111111111', onboarding.id,
      ARRAY['55555555-5555-4555-8555-555555555555'::uuid],
      '55555555-5555-4555-8555-555555555555'
    );

    SELECT * INTO finalized FROM public.finalize_employee_onboarding(
      '11111111-1111-4111-8111-111111111111', onboarding.id,
      '22222222-2222-4222-8222-222222222222',
      '19191919-1919-4919-8919-191919191919'
    );
    SELECT * INTO replayed_finalized FROM public.finalize_employee_onboarding(
      '11111111-1111-4111-8111-111111111111', onboarding.id,
      '22222222-2222-4222-8222-222222222222',
      '19191919-1919-4919-8919-191919191919'
    );
    IF finalized.lifecycle_status <> 'active' OR replayed_finalized.id <> finalized.id THEN
      RAISE EXCEPTION 'Employee finalization is not idempotent.';
    END IF;

    SELECT * INTO offboarded FROM public.offboard_employee(
      '11111111-1111-4111-8111-111111111111', onboarding.id,
      '22222222-2222-4222-8222-222222222222',
      '20202020-2020-4020-8020-202020202020',
      '2099-01-01', 'Lifecycle smoke-test offboarding', 'end_of_contract'
    );
    SELECT * INTO replayed_offboarded FROM public.offboard_employee(
      '11111111-1111-4111-8111-111111111111', onboarding.id,
      '22222222-2222-4222-8222-222222222222',
      '20202020-2020-4020-8020-202020202020',
      '2099-01-01', 'Lifecycle smoke-test offboarding', 'end_of_contract'
    );
    SELECT count(*) INTO membership_count FROM public.org_members
      WHERE user_id = '16161616-1616-4616-8616-161616161616';
    IF offboarded.lifecycle_status <> 'offboarded'
       OR replayed_offboarded.id <> offboarded.id
       OR membership_count <> 0
       OR (SELECT account_status FROM public.profiles WHERE user_id = '16161616-1616-4616-8616-161616161616') <> 'Inactive'
       OR (SELECT assigned_to FROM public.employee_locations WHERE employee_id = onboarding.id) <> DATE '2099-01-01' THEN
      RAISE EXCEPTION 'Employee offboarding did not revoke access and close assignments atomically.';
    END IF;

    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
    PERFORM set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
    DELETE FROM public.employees WHERE id = onboarding.id;
    GET DIAGNOSTICS browser_rows = ROW_COUNT;
    RESET ROLE;
    IF browser_rows <> 0 OR NOT EXISTS (SELECT 1 FROM public.employees WHERE id = onboarding.id) THEN
      RAISE EXCEPTION 'Browser hard-delete of an employee was not blocked.';
    END IF;
  END
  $test$;

  INSERT INTO auth.users(id,email) VALUES
    ('ab400000-0000-4000-8000-000000000001','atomic-finance-team@example.test');
  UPDATE public.profiles SET org_id='11111111-1111-4111-8111-111111111111',
    full_name='Atomic Finance Team Member',email='atomic-finance-team@example.test',account_status='Active'
  WHERE user_id='ab400000-0000-4000-8000-000000000001';
  INSERT INTO public.org_members(org_id,user_id,role)
  VALUES('11111111-1111-4111-8111-111111111111','ab400000-0000-4000-8000-000000000001','finance_viewer');
  INSERT INTO public.employees(id,org_id,user_id,full_name,email,job_title,status,lifecycle_status)
  VALUES('ab400000-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111',
    'ab400000-0000-4000-8000-000000000001','Atomic Finance Team Member','atomic-finance-team@example.test',
    'Finance Viewer','Active','active');
  DO $test$
  DECLARE configured jsonb; replayed jsonb; conflict_denied boolean:=false; permission_denied boolean:=false;
  BEGIN
    configured:=public.execute_finance_team_command(
      '11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',
      'ab400000-0000-4000-8000-000000000004','ab400000-0000-4000-8000-000000000003',
      'ab400000-0000-4000-8000-000000000001','ab400000-0000-4000-8000-000000000002',1,
      '{"role_touched":true,"role":"accountant","full_name_touched":true,"full_name":"Atomic Finance Configured","phone_touched":true,"phone":"0507654321"}'::jsonb);
    replayed:=public.execute_finance_team_command(
      '11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',
      'ab400000-0000-4000-8000-000000000004','ab400000-0000-4000-8000-000000000003',
      'ab400000-0000-4000-8000-000000000001','ab400000-0000-4000-8000-000000000002',1,
      '{"role_touched":true,"role":"accountant","full_name_touched":true,"full_name":"Atomic Finance Configured","phone_touched":true,"phone":"0507654321"}'::jsonb);
    BEGIN
      PERFORM public.execute_finance_team_command(
        '11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',
        'ab400000-0000-4000-8000-000000000005','ab400000-0000-4000-8000-000000000003',
        'ab400000-0000-4000-8000-000000000001','ab400000-0000-4000-8000-000000000002',1,
        '{"role_touched":true,"role":"finance_manager"}'::jsonb);
    EXCEPTION WHEN unique_violation THEN conflict_denied:=true;
    END;
    BEGIN
      PERFORM public.execute_finance_team_command(
        '11111111-1111-4111-8111-111111111111','ab400000-0000-4000-8000-000000000001',
        'ab400000-0000-4000-8000-000000000006','ab400000-0000-4000-8000-000000000007',
        'ab400000-0000-4000-8000-000000000001','ab400000-0000-4000-8000-000000000002',2,
        '{"phone_touched":true,"phone":"0500000000"}'::jsonb);
    EXCEPTION WHEN insufficient_privilege THEN permission_denied:=true;
    END;
    IF configured IS DISTINCT FROM replayed OR NOT conflict_denied OR NOT permission_denied
       OR configured->>'role'<>'accountant' OR (configured->>'lifecycle_version')::integer<>2
       OR (SELECT role::text FROM public.org_members
         WHERE user_id='ab400000-0000-4000-8000-000000000001')<>'accountant'
       OR (SELECT full_name FROM public.profiles
         WHERE user_id='ab400000-0000-4000-8000-000000000001')<>'Atomic Finance Configured'
       OR (SELECT job_title FROM public.employees
         WHERE id='ab400000-0000-4000-8000-000000000002')<>'Accountant'
       OR (SELECT count(*) FROM public.employee_career_events
         WHERE employee_id='ab400000-0000-4000-8000-000000000002' AND event_type='role_change')<>1
       OR (SELECT count(*) FROM public.event_outbox
         WHERE topic='finance.team_configured' AND payload->>'employee_id'='ab400000-0000-4000-8000-000000000002')<>1
       OR (SELECT count(*) FROM public.operational_audit_logs
         WHERE action='finance.team_configured' AND target_id='ab400000-0000-4000-8000-000000000002')<>1 THEN
      RAISE EXCEPTION 'Finance-team configuration was not atomic, versioned, authorized, and replay-safe.';
    END IF;
  END
  $test$;

  SET request.jwt.claim.role = 'service_role';

  SELECT public.initialize_accounting_defaults(
    '11111111-1111-4111-8111-111111111111',
    '45454545-4545-4545-8545-454545454545'
  );

  SELECT set_config('app.sales_identity_command', 'trusted', false);
  INSERT INTO public.field_agents (
    id, organization_id, user_id, full_name, phone, national_id, status, created_by
  ) VALUES (
    'b1b1b1b1-b1b1-41b1-81b1-b1b1b1b1b1b1',
    '11111111-1111-4111-8111-111111111111',
    '61616161-6161-4161-8161-616161616161',
    'Atomic Sales Agent', '0500000000', 'SIM-SMOKE-AGENT', 'active',
    '61616161-6161-4161-8161-616161616161'
  );
  SELECT set_config('app.sales_identity_command', '', false);
  INSERT INTO public.sim_packages (
    id, organization_id, provider, package_name, base_price, sale_price,
    total_commission_type, total_commission_value,
    agent_chain_commission_type, agent_chain_commission_value,
    merchant_commission_type, merchant_commission_value,
    direct_agent_commission_type, direct_agent_commission_value,
    agent_commission_type, agent_commission_value, status
  ) VALUES (
    'b2b2b2b2-b2b2-42b2-82b2-b2b2b2b2b2b2',
    '11111111-1111-4111-8111-111111111111', 'virgin', 'Atomic Sale Package',
    50, 100, 'flat', 15, 'flat', 5, 'flat', 10, 'flat', 15, 'flat', 5, 'active'
  );
  INSERT INTO public.sim_units (
    id, organization_id, iccid, provider, status, current_agent_id, assigned_at, added_by
  ) VALUES
    ('b3b3b3b3-b3b3-43b3-83b3-b3b3b3b3b3b3', '11111111-1111-4111-8111-111111111111', 'SIM-ATOMIC-1', 'virgin', 'with_agent', 'b1b1b1b1-b1b1-41b1-81b1-b1b1b1b1b1b1', now(), '61616161-6161-4161-8161-616161616161'),
    ('b4b4b4b4-b4b4-44b4-84b4-b4b4b4b4b4b4', '11111111-1111-4111-8111-111111111111', 'SIM-ATOMIC-2', 'virgin', 'with_agent', 'b1b1b1b1-b1b1-41b1-81b1-b1b1b1b1b1b1', now(), '61616161-6161-4161-8161-616161616161'),
    ('b5b5b5b5-b5b5-45b5-85b5-b5b5b5b5b5b5', '11111111-1111-4111-8111-111111111111', 'SIM-RETURN-1', 'virgin', 'with_agent', 'b1b1b1b1-b1b1-41b1-81b1-b1b1b1b1b1b1', now(), '61616161-6161-4161-8161-616161616161'),
    ('c3c3c3c3-c3c3-43c3-83c3-c3c3c3c3c3c3', '11111111-1111-4111-8111-111111111111', 'SIM-CONCURRENT-1', 'virgin', 'with_agent', 'b1b1b1b1-b1b1-41b1-81b1-b1b1b1b1b1b1', now(), '61616161-6161-4161-8161-616161616161');

  DO $test$
  DECLARE
    first_sale public.sim_sales;
    replayed_sale public.sim_sales;
    voided_sale public.sim_sales;
    settled_sale public.sim_sales;
    returned_sim public.sim_units;
    batch public.commission_settlement_batches;
    agent_commission_id uuid;
    bank_id uuid;
    browser_rows integer := 0;
  BEGIN
    SELECT * INTO first_sale FROM public.record_sim_sale(
      '11111111-1111-4111-8111-111111111111', '61616161-6161-4161-8161-616161616161',
      'b6b6b6b6-b6b6-46b6-86b6-b6b6b6b6b6b6', 'b7b7b7b7-b7b7-47b7-87b7-b7b7b7b7b7b7',
      'b3b3b3b3-b3b3-43b3-83b3-b3b3b3b3b3b3', 'b2b2b2b2-b2b2-42b2-82b2-b2b2b2b2b2b2',
      'agent', '{"customer_name":"Atomic Customer"}'::jsonb
    );
    SELECT * INTO replayed_sale FROM public.record_sim_sale(
      '11111111-1111-4111-8111-111111111111', '61616161-6161-4161-8161-616161616161',
      'b6b6b6b6-b6b6-46b6-86b6-b6b6b6b6b6b6', 'b7b7b7b7-b7b7-47b7-87b7-b7b7b7b7b7b7',
      'b3b3b3b3-b3b3-43b3-83b3-b3b3b3b3b3b3', 'b2b2b2b2-b2b2-42b2-82b2-b2b2b2b2b2b2',
      'agent', '{"customer_name":"Atomic Customer"}'::jsonb
    );
    IF first_sale.id IS NULL OR replayed_sale.id <> first_sale.id
       OR (SELECT status::text FROM public.sim_units WHERE id = first_sale.sim_unit_id) <> 'sold'
       OR (SELECT count(*) FROM public.sim_sales WHERE sim_unit_id = first_sale.sim_unit_id AND status = 'active') <> 1
       OR (SELECT count(*) FROM public.agent_commissions WHERE sale_id = first_sale.id AND status = 'accrued' AND commission_amount = 15) <> 1
       OR (SELECT count(*) FROM public.sim_transfers WHERE sim_unit_id = first_sale.sim_unit_id AND transfer_type::text = 'sold') <> 1
       OR (SELECT count(*) FROM public.event_outbox WHERE topic = 'sim.sale_recorded' AND payload->>'sale_id' = first_sale.id::text) <> 1 THEN
      RAISE EXCEPTION 'Atomic/idempotent SIM sale did not create one coherent commerce event.';
    END IF;
    BEGIN
      PERFORM * FROM public.record_sim_sale(
        '11111111-1111-4111-8111-111111111111', '61616161-6161-4161-8161-616161616161',
        'b8b8b8b8-b8b8-48b8-88b8-b8b8b8b8b8b8', 'b9b9b9b9-b9b9-49b9-89b9-b9b9b9b9b9b9',
        'b3b3b3b3-b3b3-43b3-83b3-b3b3b3b3b3b3', 'b2b2b2b2-b2b2-42b2-82b2-b2b2b2b2b2b2',
        'agent', '{}'::jsonb
      );
      RAISE EXCEPTION 'A second active sale for one SIM unexpectedly succeeded.';
    EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
    END;
    SELECT * INTO voided_sale FROM public.void_sim_sale(
      '11111111-1111-4111-8111-111111111111', '61616161-6161-4161-8161-616161616161',
      'c1c1c1c1-c1c1-41c1-81c1-c1c1c1c1c1c1', 'c2c2c2c2-c2c2-42c2-82c2-c2c2c2c2c2c2',
      first_sale.id, 1, 'Customer activation was cancelled'
    );
    IF voided_sale.status <> 'voided' OR voided_sale.version <> 2
       OR (SELECT status::text FROM public.sim_units WHERE id = first_sale.sim_unit_id) <> 'with_agent'
       OR (SELECT status FROM public.agent_commissions WHERE sale_id = first_sale.id) <> 'reversed'
       OR (SELECT count(*) FROM public.event_outbox WHERE topic = 'sim.sale_voided' AND payload->>'sale_id' = first_sale.id::text) <> 1 THEN
      RAISE EXCEPTION 'SIM sale void did not restore inventory and reverse accruals.';
    END IF;

    SELECT * INTO returned_sim FROM public.return_sim_unit(
      '11111111-1111-4111-8111-111111111111', '61616161-6161-4161-8161-616161616161',
      'c4c4c4c4-c4c4-44c4-84c4-c4c4c4c4c4c4', 'c5c5c5c5-c5c5-45c5-85c5-c5c5c5c5c5c5',
      'b5b5b5b5-b5b5-45b5-85b5-b5b5b5b5b5b5', 'Return to central stock'
    );
    IF returned_sim.status::text <> 'in_stock' OR returned_sim.current_agent_id IS NOT NULL
       OR (SELECT count(*) FROM public.sim_transfers WHERE sim_unit_id = returned_sim.id AND transfer_type::text = 'return_to_stock') <> 1 THEN
      RAISE EXCEPTION 'Atomic SIM return did not reconcile inventory and transfer history.';
    END IF;

    SELECT * INTO settled_sale FROM public.record_sim_sale(
      '11111111-1111-4111-8111-111111111111', '61616161-6161-4161-8161-616161616161',
      'c6c6c6c6-c6c6-46c6-86c6-c6c6c6c6c6c6', 'c7c7c7c7-c7c7-47c7-87c7-c7c7c7c7c7c7',
      'b4b4b4b4-b4b4-44b4-84b4-b4b4b4b4b4b4', 'b2b2b2b2-b2b2-42b2-82b2-b2b2b2b2b2b2',
      'agent', '{"customer_name":"Settlement Customer"}'::jsonb
    );
    SELECT id INTO agent_commission_id FROM public.agent_commissions WHERE sale_id = settled_sale.id;
    SELECT default_bank_account_id INTO bank_id FROM public.accounting_settings
      WHERE organization_id = '11111111-1111-4111-8111-111111111111';
    SELECT * INTO batch FROM public.settle_sim_commissions(
      '11111111-1111-4111-8111-111111111111', '45454545-4545-4545-8545-454545454545',
      'c8c8c8c8-c8c8-48c8-88c8-c8c8c8c8c8c8', 'c9c9c9c9-c9c9-49c9-89c9-c9c9c9c9c9c9',
      'agent', jsonb_build_array(agent_commission_id), '2099-07-02', bank_id,
      'bank_transfer', 'COMMISSION-SMOKE-1', 'Atomic settlement smoke test'
    );
    IF batch.status <> 'posted' OR batch.commission_count <> 1 OR batch.total_amount <> 15
       OR (SELECT status FROM public.accounting_payments WHERE id = batch.accounting_payment_id) <> 'posted'
       OR (SELECT status FROM public.accounting_journal_entries WHERE id = batch.accounting_journal_entry_id) <> 'posted'
       OR (SELECT status FROM public.agent_commissions WHERE id = agent_commission_id) <> 'settled'
       OR (SELECT settlement_batch_id FROM public.agent_commissions WHERE id = agent_commission_id) <> batch.id
       OR (SELECT count(*) FROM public.commission_settlement_lines WHERE settlement_batch_id = batch.id) <> 1 THEN
      RAISE EXCEPTION 'Commission settlement did not atomically reconcile commissions, payment, and GL.';
    END IF;
    BEGIN
      PERFORM * FROM public.void_sim_sale(
        '11111111-1111-4111-8111-111111111111', '61616161-6161-4161-8161-616161616161',
        'd1d1d1d1-d1d1-41d1-81d1-d1d1d1d1d1d1', 'd2d2d2d2-d2d2-42d2-82d2-d2d2d2d2d2d2',
        settled_sale.id, 1, 'Attempt to void settled sale'
      );
      RAISE EXCEPTION 'A sale with settled commission unexpectedly voided.';
    EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
    END;

    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
    PERFORM set_config('request.jwt.claim.sub', '61616161-6161-4161-8161-616161616161', true);
    BEGIN
      UPDATE public.sim_units SET status = 'sold' WHERE id = 'c3c3c3c3-c3c3-43c3-83c3-c3c3c3c3c3c3';
      GET DIAGNOSTICS browser_rows = ROW_COUNT;
    EXCEPTION WHEN insufficient_privilege THEN browser_rows := 0;
    END;
    RESET ROLE;
    IF browser_rows <> 0 THEN RAISE EXCEPTION 'Direct browser SIM mutation was not denied.'; END IF;
  END
  $test$;

  SET request.jwt.claim.role = 'service_role';

  INSERT INTO public.sales_companies (id, organization_id, name, slug, code)
  VALUES (
    'e1e1e1e1-e1e1-41e1-81e1-e1e1e1e1e1e1',
    '11111111-1111-4111-8111-111111111111',
    'Atomic Sales Company', 'atomic-sales-company', 'ASC'
  );
  INSERT INTO public.sales_products (id, organization_id, company_id, name, price, created_by)
  VALUES (
    'e2e2e2e2-e2e2-42e2-82e2-e2e2e2e2e2e2',
    '11111111-1111-4111-8111-111111111111',
    'e1e1e1e1-e1e1-41e1-81e1-e1e1e1e1e1e1',
    'Atomic Sales Product', 100, '61616161-6161-4161-8161-616161616161'
  );
  INSERT INTO public.sales_company_assignments (
    id, organization_id, company_id, user_id, assignment_role, start_date, created_by
  ) VALUES (
    'e3e3e3e3-e3e3-43e3-83e3-e3e3e3e3e3e3',
    '11111111-1111-4111-8111-111111111111',
    'e1e1e1e1-e1e1-41e1-81e1-e1e1e1e1e1e1',
    '61616161-6161-4161-8161-616161616161', 'manager', '2000-01-01',
    '61616161-6161-4161-8161-616161616161'
  );

  CREATE FUNCTION pg_temp.reject_shift_prompt_outbox()
  RETURNS trigger LANGUAGE plpgsql AS $failure$
  BEGIN
    IF NEW.topic='sales.shift_prompt_created' THEN
      RAISE EXCEPTION 'Injected shift-prompt outbox failure';
    END IF;
    RETURN NEW;
  END
  $failure$;
  CREATE TRIGGER reject_shift_prompt_outbox
    BEFORE INSERT ON public.event_outbox
    FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_shift_prompt_outbox();
  DO $test$
  DECLARE business_date_value date:=public.organization_business_date(
    '11111111-1111-4111-8111-111111111111',now());
  BEGIN
    BEGIN
      PERFORM public.ensure_sales_shift_prompt_atomic(
        '11111111-1111-4111-8111-111111111111','61616161-6161-4161-8161-616161616161',
        'ac400000-0000-4000-8000-000000000001','e1e1e1e1-e1e1-41e1-81e1-e1e1e1e1e1e1',
        NULL,NULL,business_date_value,'end_shift','injected-end',1000,100,100);
      RAISE EXCEPTION 'Shift prompt survived an injected outbox failure.';
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM<>'Injected shift-prompt outbox failure' THEN RAISE; END IF;
    END;
    IF EXISTS(SELECT 1 FROM public.sales_shift_prompts WHERE prompt_key='injected-end') THEN
      RAISE EXCEPTION 'Shift prompt source row did not roll back with its outbox.';
    END IF;
  END
  $test$;
  DROP TRIGGER reject_shift_prompt_outbox ON public.event_outbox;

  DO $test$
  DECLARE business_date_value date:=public.organization_business_date(
      '11111111-1111-4111-8111-111111111111',now());
    mid_prompt jsonb; mid_replay jsonb; end_prompt jsonb; responded jsonb; response_replay jsonb;
    conflict_denied boolean:=false; stale_denied boolean:=false; cross_tenant_denied boolean:=false;
    insert_denied boolean:=false; update_rows integer:=0;
  BEGIN
    mid_prompt:=public.ensure_sales_shift_prompt_atomic(
      '11111111-1111-4111-8111-111111111111','61616161-6161-4161-8161-616161616161',
      'ac400000-0000-4000-8000-000000000002','e1e1e1e1-e1e1-41e1-81e1-e1e1e1e1e1e1',
      NULL,NULL,business_date_value,'mid_shift','atomic-mid',1000,100,40);
    mid_replay:=public.ensure_sales_shift_prompt_atomic(
      '11111111-1111-4111-8111-111111111111','61616161-6161-4161-8161-616161616161',
      'ac400000-0000-4000-8000-000000000003','e1e1e1e1-e1e1-41e1-81e1-e1e1e1e1e1e1',
      NULL,NULL,business_date_value,'mid_shift','atomic-mid',1000,100,40);
    end_prompt:=public.ensure_sales_shift_prompt_atomic(
      '11111111-1111-4111-8111-111111111111','61616161-6161-4161-8161-616161616161',
      'ac400000-0000-4000-8000-000000000004','e1e1e1e1-e1e1-41e1-81e1-e1e1e1e1e1e1',
      NULL,NULL,business_date_value,'end_shift','atomic-end',1000,100,100);
    responded:=public.respond_sales_shift_prompt_atomic(
      '11111111-1111-4111-8111-111111111111','61616161-6161-4161-8161-616161616161',
      'ac400000-0000-4000-8000-000000000005','ac400000-0000-4000-8000-000000000006',
      (end_prompt->>'id')::uuid,1,'submit_reason','Customer traffic was below forecast',15);
    response_replay:=public.respond_sales_shift_prompt_atomic(
      '11111111-1111-4111-8111-111111111111','61616161-6161-4161-8161-616161616161',
      'ac400000-0000-4000-8000-000000000005','ac400000-0000-4000-8000-000000000006',
      (end_prompt->>'id')::uuid,1,'submit_reason','Customer traffic was below forecast',15);
    BEGIN
      PERFORM public.respond_sales_shift_prompt_atomic(
        '11111111-1111-4111-8111-111111111111','61616161-6161-4161-8161-616161616161',
        'ac400000-0000-4000-8000-000000000007','ac400000-0000-4000-8000-000000000006',
        (end_prompt->>'id')::uuid,1,'submit_reason','Changed retry reason',15);
    EXCEPTION WHEN unique_violation THEN conflict_denied:=true;
    END;
    BEGIN
      PERFORM public.respond_sales_shift_prompt_atomic(
        '11111111-1111-4111-8111-111111111111','61616161-6161-4161-8161-616161616161',
        'ac400000-0000-4000-8000-000000000008','ac400000-0000-4000-8000-000000000009',
        (end_prompt->>'id')::uuid,1,'snooze',NULL,15);
    EXCEPTION WHEN serialization_failure THEN stale_denied:=true;
    END;
    BEGIN
      PERFORM public.ensure_sales_shift_prompt_atomic(
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','61616161-6161-4161-8161-616161616161',
        'ac400000-0000-4000-8000-000000000010','e1e1e1e1-e1e1-41e1-81e1-e1e1e1e1e1e1',
        NULL,NULL,public.organization_business_date('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',now()),
        'mid_shift','cross-tenant',1000,100,40);
    EXCEPTION WHEN insufficient_privilege THEN cross_tenant_denied:=true;
    END;
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claim.role','authenticated',true);
    PERFORM set_config('request.jwt.claim.sub','61616161-6161-4161-8161-616161616161',true);
    BEGIN
      INSERT INTO public.sales_shift_prompts(
        organization_id,company_id,sales_agent_id,prompt_date,prompt_type,prompt_key
      ) VALUES(
        '11111111-1111-4111-8111-111111111111','e1e1e1e1-e1e1-41e1-81e1-e1e1e1e1e1e1',
        '61616161-6161-4161-8161-616161616161',business_date_value,'hourly','browser-insert'
      );
    EXCEPTION WHEN insufficient_privilege THEN insert_denied:=true;
    END;
    BEGIN
      UPDATE public.sales_shift_prompts SET achieved_amount=999 WHERE id=(mid_prompt->>'id')::uuid;
      GET DIAGNOSTICS update_rows=ROW_COUNT;
    EXCEPTION WHEN insufficient_privilege THEN update_rows:=0;
    END;
    RESET ROLE;
    IF mid_prompt->>'id' IS DISTINCT FROM mid_replay->>'id'
       OR responded IS DISTINCT FROM response_replay OR NOT conflict_denied OR NOT stale_denied
       OR NOT cross_tenant_denied OR NOT insert_denied OR update_rows<>0
       OR responded->>'action'<>'submitted_reason' OR (responded->>'version')::integer<>2
       OR (SELECT count(*) FROM public.sales_shift_prompts WHERE prompt_key IN('atomic-mid','atomic-end'))<>2
       OR (SELECT count(*) FROM public.event_outbox WHERE topic='sales.shift_prompt_created'
         AND payload->>'sales_agent_id'='61616161-6161-4161-8161-616161616161')<>2
       OR (SELECT count(*) FROM public.event_outbox WHERE topic='sales.shift_reason_submitted'
         AND payload->>'prompt_id'=end_prompt->>'id')<>1
       OR (SELECT count(*) FROM public.sales_shift_prompt_commands WHERE prompt_id=(end_prompt->>'id')::uuid)<>1
       OR (SELECT count(*) FROM public.operational_audit_logs WHERE target_id=end_prompt->>'id'
         AND action='sales.shift_prompt_submit_reason')<>1 THEN
      RAISE EXCEPTION 'Sales shift prompts were not atomic, replay-safe, versioned, scoped, and durable.';
    END IF;
  END
  $test$;

  DO $test$
  DECLARE
    captured public.promoter_leads;
    capture_replay public.promoter_leads;
    updated public.promoter_leads;
    update_replay public.promoter_leads;
    conflict_denied boolean := false;
    cross_tenant_denied boolean := false;
    browser_rows integer := 0;
  BEGIN
    SELECT * INTO captured FROM public.save_promoter_lead_atomic(
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      'ab200000-0000-4000-8000-000000000001',
      'ab200000-0000-4000-8000-000000000002',
      NULL, 0,
      jsonb_build_object(
        'company_id', 'e1e1e1e1-e1e1-41e1-81e1-e1e1e1e1e1e1',
        'full_name', 'Atomic Promoter Lead',
        'mobile', '+966500000001',
        'assigned_agent_id', '61616161-6161-4161-8161-616161616161',
        'consent_given', true,
        'marketing_consent', false,
        'consent_version', 'v1',
        'language', 'ar',
        'recommendation_snapshot', '{}'::jsonb
      )
    );
    SELECT * INTO capture_replay FROM public.save_promoter_lead_atomic(
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      'ab200000-0000-4000-8000-000000000003',
      'ab200000-0000-4000-8000-000000000002',
      NULL, 999,
      jsonb_build_object(
        'company_id', 'e1e1e1e1-e1e1-41e1-81e1-e1e1e1e1e1e1',
        'full_name', 'Atomic Promoter Lead',
        'mobile', '+966500000001',
        'assigned_agent_id', '61616161-6161-4161-8161-616161616161',
        'consent_given', true,
        'marketing_consent', false,
        'consent_version', 'v1',
        'language', 'ar',
        'recommendation_snapshot', '{}'::jsonb
      )
    );
    BEGIN
      PERFORM * FROM public.save_promoter_lead_atomic(
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
        'ab200000-0000-4000-8000-000000000004',
        'ab200000-0000-4000-8000-000000000002',
        NULL, 0,
        '{"full_name":"Conflicting Lead","mobile":"+966500000002","consent_given":true}'::jsonb
      );
    EXCEPTION WHEN unique_violation THEN
      conflict_denied := true;
    END;

    SELECT * INTO updated FROM public.save_promoter_lead_atomic(
      '11111111-1111-4111-8111-111111111111',
      '61616161-6161-4161-8161-616161616161',
      'ab200000-0000-4000-8000-000000000005',
      'ab200000-0000-4000-8000-000000000006',
      captured.id, 0,
      '{"status":"not_interested"}'::jsonb
    );
    SELECT * INTO update_replay FROM public.save_promoter_lead_atomic(
      '11111111-1111-4111-8111-111111111111',
      '61616161-6161-4161-8161-616161616161',
      'ab200000-0000-4000-8000-000000000007',
      'ab200000-0000-4000-8000-000000000006',
      captured.id, 999,
      '{"status":"not_interested"}'::jsonb
    );
    BEGIN
      PERFORM * FROM public.save_promoter_lead_atomic(
        '11111111-1111-4111-8111-111111111111',
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        'ab200000-0000-4000-8000-000000000008',
        'ab200000-0000-4000-8000-000000000009',
        captured.id, 1,
        '{"status":"invalid"}'::jsonb
      );
    EXCEPTION WHEN insufficient_privilege THEN
      cross_tenant_denied := true;
    END;

    IF captured.id IS NULL OR captured.id <> capture_replay.id
       OR updated.id <> update_replay.id OR updated.status <> 'not_interested'
       OR updated.version <> 1 OR NOT conflict_denied OR NOT cross_tenant_denied
       OR (SELECT count(*) FROM public.promoter_leads
         WHERE organization_id = '11111111-1111-4111-8111-111111111111'
           AND mobile = '+966500000001') <> 1
       OR (SELECT count(*) FROM public.promoter_lead_events WHERE lead_id = captured.id) <> 3
       OR (SELECT count(*) FROM public.event_outbox
         WHERE topic = 'promoter.lead_saved' AND payload->>'lead_id' = captured.id::text) <> 2
       OR (SELECT count(*) FROM public.operational_audit_logs
         WHERE target_type = 'promoter_lead' AND target_id = captured.id::text) <> 2 THEN
      RAISE EXCEPTION 'Atomic promoter lead replay, history, tenant isolation, audit, or event proof failed.';
    END IF;

    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
    PERFORM set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
    BEGIN
      UPDATE public.promoter_leads SET status = 'invalid' WHERE id = captured.id;
      GET DIAGNOSTICS browser_rows = ROW_COUNT;
    EXCEPTION WHEN insufficient_privilege THEN browser_rows := 0;
    END;
    RESET ROLE;
    IF browser_rows <> 0 THEN
      RAISE EXCEPTION 'Direct browser promoter lead mutation was not denied.';
    END IF;
  END
  $test$;

  SET request.jwt.claim.role = 'service_role';

  DO $test$
  DECLARE
    submitted public.sales_logs;
    replayed public.sales_logs;
    edit_request public.sales_log_edit_requests;
    replayed_edit_request public.sales_log_edit_requests;
    corrected_request public.sales_log_edit_requests;
    rejected_request public.sales_log_edit_requests;
    replayed_rejected_request public.sales_log_edit_requests;
    voided public.sales_logs;
    edit_request_id uuid;
    original_revision_id uuid;
    corrected_revision_id uuid;
    browser_rows integer := 0;
  BEGIN
    SELECT * INTO submitted FROM public.submit_sales_log(
      '11111111-1111-4111-8111-111111111111', '61616161-6161-4161-8161-616161616161',
      'e5e5e5e5-e5e5-45e5-85e5-e5e5e5e5e5e5', 'e6e6e6e6-e6e6-46e6-86e6-e6e6e6e6e6e6',
      'e1e1e1e1-e1e1-41e1-81e1-e1e1e1e1e1e1',
      '[{"product_id":"e2e2e2e2-e2e2-42e2-82e2-e2e2e2e2e2e2","quantity":2,"discount_percent":10}]'::jsonb,
      'Original immutable sales log'
    );
    SELECT * INTO replayed FROM public.submit_sales_log(
      '11111111-1111-4111-8111-111111111111', '61616161-6161-4161-8161-616161616161',
      'e5e5e5e5-e5e5-45e5-85e5-e5e5e5e5e5e5', 'e6e6e6e6-e6e6-46e6-86e6-e6e6e6e6e6e6',
      'e1e1e1e1-e1e1-41e1-81e1-e1e1e1e1e1e1',
      '[{"product_id":"e2e2e2e2-e2e2-42e2-82e2-e2e2e2e2e2e2","quantity":2,"discount_percent":10}]'::jsonb,
      'Original immutable sales log'
    );
    original_revision_id := submitted.current_revision_id;
    IF submitted.id IS NULL OR replayed.id <> submitted.id OR submitted.version <> 1
       OR submitted.subtotal <> 200 OR submitted.total_discount <> 20 OR submitted.grand_total <> 180
       OR (SELECT count(*) FROM public.sales_log_revisions WHERE sales_log_id = submitted.id) <> 1
       OR (SELECT count(*) FROM public.event_outbox WHERE topic = 'sales_log.submitted'
            AND payload->>'sales_log_id' = submitted.id::text) <> 1 THEN
      RAISE EXCEPTION 'Sales log submission was not canonical, immutable, or idempotent.';
    END IF;

    SELECT * INTO edit_request FROM public.submit_sales_log_edit_request(
      '11111111-1111-4111-8111-111111111111', '61616161-6161-4161-8161-616161616161',
      'e4e4e4e4-e4e4-44e4-84e4-e4e4e4e4e4e4', 'e4e4e4e4-e4e4-44e4-84e4-e4e4e4e4e4e5',
      submitted.id, 'Increase quantity to three'
    );
    SELECT * INTO replayed_edit_request FROM public.submit_sales_log_edit_request(
      '11111111-1111-4111-8111-111111111111', '61616161-6161-4161-8161-616161616161',
      'e4e4e4e4-e4e4-44e4-84e4-e4e4e4e4e4e4', 'e4e4e4e4-e4e4-44e4-84e4-e4e4e4e4e4e5',
      submitted.id, 'Increase quantity to three'
    );
    edit_request_id := edit_request.id;
    IF replayed_edit_request.id <> edit_request.id
       OR (SELECT count(*) FROM public.sales_log_edit_requests WHERE sales_log_id = submitted.id AND status = 'pending') <> 1
       OR (SELECT count(*) FROM public.event_outbox WHERE topic = 'sales_log.edit_requested'
            AND payload->>'edit_request_id' = edit_request.id::text) <> 1 THEN
      RAISE EXCEPTION 'Sales-log edit request submission was not atomic and replay-safe.';
    END IF;
    SELECT * INTO corrected_request FROM public.resolve_sales_log_edit(
      '11111111-1111-4111-8111-111111111111', '61616161-6161-4161-8161-616161616161',
      'e7e7e7e7-e7e7-47e7-87e7-e7e7e7e7e7e7', 'e8e8e8e8-e8e8-48e8-88e8-e8e8e8e8e8e8',
      edit_request_id, 1, 'applied',
      '[{"product_id":"e2e2e2e2-e2e2-42e2-82e2-e2e2e2e2e2e2","quantity":3,"discount_percent":0}]'::jsonb,
      'Corrected immutable sales log', 'Manager verified supporting evidence'
    );
    SELECT current_revision_id INTO corrected_revision_id FROM public.sales_logs WHERE id = submitted.id;
    IF corrected_request.status <> 'applied'
       OR (SELECT version FROM public.sales_logs WHERE id = submitted.id) <> 2
       OR (SELECT grand_total FROM public.sales_logs WHERE id = submitted.id) <> 300
       OR (SELECT count(*) FROM public.sales_log_revisions WHERE sales_log_id = submitted.id) <> 2
       OR (SELECT accounting_status FROM public.sales_log_revisions WHERE id = original_revision_id) <> 'reversed'
       OR (SELECT event_type FROM public.sales_log_revisions WHERE id = corrected_revision_id) <> 'correction'
       OR (SELECT count(*) FROM public.event_outbox WHERE topic = 'sales_log.corrected'
            AND payload->>'sales_log_id' = submitted.id::text) <> 1
       OR (SELECT count(*) FROM public.event_outbox WHERE topic = 'sales_log.edit_resolved'
            AND payload->>'edit_request_id' = edit_request.id::text
            AND payload->>'resolution_status' = 'applied') <> 1 THEN
      RAISE EXCEPTION 'Sales log correction did not preserve revisions and publish one accounting event.';
    END IF;

    BEGIN
      PERFORM * FROM public.resolve_sales_log_edit(
        '11111111-1111-4111-8111-111111111111', '61616161-6161-4161-8161-616161616161',
        'e9e9e9e9-e9e9-49e9-89e9-e9e9e9e9e9e9', 'eaeaeaea-eaea-4aea-8aea-eaeaeaeaeaea',
        edit_request_id, 1, 'applied', '[]'::jsonb, NULL, 'Stale correction'
      );
      RAISE EXCEPTION 'A stale sales-log correction unexpectedly succeeded.';
    EXCEPTION WHEN serialization_failure THEN NULL;
    END;

    SELECT * INTO rejected_request FROM public.submit_sales_log_edit_request(
      '11111111-1111-4111-8111-111111111111', '61616161-6161-4161-8161-616161616161',
      'edededed-eded-4ded-8ded-edededededed', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1',
      submitted.id, 'Request a second reviewed correction'
    );
    SELECT * INTO rejected_request FROM public.resolve_sales_log_edit(
      '11111111-1111-4111-8111-111111111111', '61616161-6161-4161-8161-616161616161',
      'efefefef-efef-4fef-8fef-efefefefefef', 'f0f0f0f0-f0f0-40f0-80f0-f0f0f0f0f0f0',
      rejected_request.id, 2, 'rejected', '[]'::jsonb, NULL, 'Supporting evidence was insufficient'
    );
    SELECT * INTO replayed_rejected_request FROM public.resolve_sales_log_edit(
      '11111111-1111-4111-8111-111111111111', '61616161-6161-4161-8161-616161616161',
      'efefefef-efef-4fef-8fef-efefefefefef', 'f0f0f0f0-f0f0-40f0-80f0-f0f0f0f0f0f0',
      rejected_request.id, 2, 'rejected', '[]'::jsonb, NULL, 'Supporting evidence was insufficient'
    );
    IF rejected_request.status <> 'rejected' OR replayed_rejected_request.id <> rejected_request.id
       OR (SELECT count(*) FROM public.event_outbox WHERE topic = 'sales_log.edit_resolved'
            AND payload->>'edit_request_id' = rejected_request.id::text
            AND payload->>'resolution_status' = 'rejected') <> 1 THEN
      RAISE EXCEPTION 'Rejected sales-log edit request did not replay and publish exactly once.';
    END IF;

    SELECT * INTO voided FROM public.void_sales_log(
      '11111111-1111-4111-8111-111111111111', '61616161-6161-4161-8161-616161616161',
      'ebebebeb-ebeb-4beb-8beb-ebebebebebeb', 'ecececec-ecec-4cec-8cec-ecececececec',
      submitted.id, 2, 'Customer order was cancelled after review'
    );
    IF voided.status <> 'voided' OR voided.version <> 3 OR voided.grand_total <> 300
       OR (SELECT count(*) FROM public.sales_log_revisions WHERE sales_log_id = submitted.id) <> 3
       OR (SELECT accounting_status FROM public.sales_log_revisions WHERE id = corrected_revision_id) <> 'reversed'
       OR (SELECT event_type FROM public.sales_log_revisions WHERE id = voided.current_revision_id) <> 'void'
       OR (SELECT count(*) FROM public.event_outbox WHERE topic = 'sales_log.voided'
            AND payload->>'sales_log_id' = submitted.id::text) <> 1 THEN
      RAISE EXCEPTION 'Sales log void did not retain the projection, append a void event, and publish reversal work.';
    END IF;

    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
    PERFORM set_config('request.jwt.claim.sub', '61616161-6161-4161-8161-616161616161', true);
    BEGIN
      UPDATE public.sales_logs SET grand_total = 1 WHERE id = submitted.id;
      GET DIAGNOSTICS browser_rows = ROW_COUNT;
    EXCEPTION WHEN insufficient_privilege THEN browser_rows := 0;
    END;
    RESET ROLE;
    IF browser_rows <> 0 OR (SELECT grand_total FROM public.sales_logs WHERE id = submitted.id) <> 300 THEN
      RAISE EXCEPTION 'Direct browser sales-log mutation was not denied.';
    END IF;
  END
  $test$;

  SET request.jwt.claim.role = 'service_role';

  INSERT INTO public.employees (id, org_id, user_id, full_name, hiring_date)
  VALUES (
    'f1f1f1f1-f1f1-41f1-81f1-f1f1f1f1f1f1',
    '11111111-1111-4111-8111-111111111111',
    '61616161-6161-4161-8161-616161616161', 'Carrier Sales Employee', '2100-01-01'
  );
  INSERT INTO public.employee_dealer_codes (
    id, organization_id, employee_id, dealer_code, start_date, assigned_by
  ) VALUES (
    'f2f2f2f2-f2f2-42f2-82f2-f2f2f2f2f2f2',
    '11111111-1111-4111-8111-111111111111',
    'f1f1f1f1-f1f1-41f1-81f1-f1f1f1f1f1f1', 'DEALER-ATOMIC', '2000-01-01',
    '61616161-6161-4161-8161-616161616161'
  );
  INSERT INTO public.carrier_product_mappings (
    id, organization_id, sales_product_id, segment_brand, segment_group,
    fpe_multiplier, ibr_source, effective_from, created_by
  ) VALUES (
    'f3f3f3f3-f3f3-43f3-83f3-f3f3f3f3f3f3',
    '11111111-1111-4111-8111-111111111111',
    'e2e2e2e2-e2e2-42e2-82e2-e2e2e2e2e2e2',
    'Virgin Mobile', 'Virgin Prepaid', 1, 'line_total', '2000-01-01',
    '61616161-6161-4161-8161-616161616161'
  );
  INSERT INTO public.sales_products (
    id, organization_id, company_id, name, price, created_by
  ) VALUES (
    'f4f4f4f4-f4f4-44f4-84f4-f4f4f4f4f4f4',
    '11111111-1111-4111-8111-111111111111',
    'e1e1e1e1-e1e1-41e1-81e1-e1e1e1e1e1e1', 'Unmapped Carrier Product', 50,
    '61616161-6161-4161-8161-616161616161'
  );

  INSERT INTO public.sales_logs (
    organization_id, company_id, sales_agent_id, log_date, items,
    subtotal, total_discount, grand_total, status
  ) VALUES
    ('11111111-1111-4111-8111-111111111111', 'e1e1e1e1-e1e1-41e1-81e1-e1e1e1e1e1e1',
      '61616161-6161-4161-8161-616161616161', '2099-07-01',
      '[{"product_id":"e2e2e2e2-e2e2-42e2-82e2-e2e2e2e2e2e2","quantity":1,"line_total":100}]', 100, 0, 100, 'submitted'),
    ('11111111-1111-4111-8111-111111111111', 'e1e1e1e1-e1e1-41e1-81e1-e1e1e1e1e1e1',
      '61616161-6161-4161-8161-616161616161', '2099-07-01',
      '[{"product_id":"e2e2e2e2-e2e2-42e2-82e2-e2e2e2e2e2e2","quantity":2,"line_total":200}]', 200, 0, 200, 'submitted'),
    ('11111111-1111-4111-8111-111111111111', 'e1e1e1e1-e1e1-41e1-81e1-e1e1e1e1e1e1',
      '61616161-6161-4161-8161-616161616161', '2099-07-03',
      '[{"product_id":"e2e2e2e2-e2e2-42e2-82e2-e2e2e2e2e2e2","quantity":1,"line_total":100}]', 100, 0, 100, 'submitted'),
    ('11111111-1111-4111-8111-111111111111', 'e1e1e1e1-e1e1-41e1-81e1-e1e1e1e1e1e1',
      '61616161-6161-4161-8161-616161616161', '2099-07-04',
      '[{"product_id":"e2e2e2e2-e2e2-42e2-82e2-e2e2e2e2e2e2","quantity":1,"line_total":100},{"product_id":"f4f4f4f4-f4f4-44f4-84f4-f4f4f4f4f4f4","quantity":1,"line_total":50}]', 150, 0, 150, 'submitted'),
    ('11111111-1111-4111-8111-111111111111', 'e1e1e1e1-e1e1-41e1-81e1-e1e1e1e1e1e1',
      '61616161-6161-4161-8161-616161616161', '2099-07-05',
      '[{"product_id":"e2e2e2e2-e2e2-42e2-82e2-e2e2e2e2e2e2","quantity":103,"line_total":10300}]', 10300, 0, 10300, 'submitted');

  DO $test$
  DECLARE
    carrier_import public.carrier_activation_imports;
    published_import public.carrier_activation_imports;
    verification_run public.carrier_verification_runs;
    verification public.carrier_sales_verifications;
    snapshot jsonb;
    base_payload jsonb := jsonb_build_object(
      'activation_count', 1, 'bundle_type', 'Prepaid', 'activation_month', '2099-07-01',
      'region', 'Central', 'city', 'Riyadh', 'distributor_name', 'Atomic Distributor',
      'channel', 'Direct Sales', 'dealer_name', 'Atomic Dealer', 'dealer_code', 'DEALER-ATOMIC',
      'key_account_manager', NULL, 'account_manager', NULL, 'team_leader', NULL,
      'sales_champion', NULL, 'segment_brand', 'Virgin Mobile', 'segment_group', 'Virgin Prepaid',
      'customer_nationality', NULL, 'customer_id_type', NULL, 'latitude', 24.7, 'longitude', 46.7,
      'cas_location_id', 'LOC-1', 'cas_location_name', 'Atomic Location', 'bundle_description', 'Atomic',
      'ibr_value_excl_vat', 100, 'first_recharge_value', 0, 'second_recharge_value', 0,
      'uid_percent', 0, 'first_bundle_qty', 1, 'first_bundle_revenue', 100,
      'lifetime_recharge', 0, 'initial_balance_total', 0, 'dealer_partner', NULL,
      'subscription_type', 'prepaid', 'bundle_category', '+90', 'shift_type', 'morning'
    );
    browser_rows integer := 0;
  BEGIN
    SELECT * INTO carrier_import FROM public.begin_carrier_import(
      '11111111-1111-4111-8111-111111111111', '61616161-6161-4161-8161-616161616161',
      'f5f5f5f5-f5f5-45f5-85f5-f5f5f5f5f5f5', 'f6f6f6f6-f6f6-46f6-86f6-f6f6f6f6f6f6',
      'carrier-atomic.xlsx', repeat('a', 64), 'virgin-friendi-activation-v1',
      '2099-07-01', '2099-07-01', '2099-07-05', 6
    );
    INSERT INTO public.carrier_import_staging (
      organization_id, import_id, row_number, source_row_hash, payload, validation_errors,
      matched_employee_id
    ) VALUES
      ('11111111-1111-4111-8111-111111111111', carrier_import.id, 2, repeat('1', 64),
        base_payload || jsonb_build_object('activation_date', '2099-07-01', 'activated_at', '2099-07-01T09:00:00Z', 'fpe_count', 3, 'ibr_value', 300), '[]',
        'f1f1f1f1-f1f1-41f1-81f1-f1f1f1f1f1f1'),
      ('11111111-1111-4111-8111-111111111111', carrier_import.id, 3, repeat('2', 64),
        base_payload || jsonb_build_object('activation_date', '2099-07-02', 'activated_at', '2099-07-02T09:00:00Z', 'fpe_count', 1, 'ibr_value', 100), '[]',
        'f1f1f1f1-f1f1-41f1-81f1-f1f1f1f1f1f1'),
      ('11111111-1111-4111-8111-111111111111', carrier_import.id, 4, repeat('3', 64),
        base_payload || jsonb_build_object('activation_date', '2099-07-04', 'activated_at', '2099-07-04T09:00:00Z', 'fpe_count', 1, 'ibr_value', 100), '[]',
        'f1f1f1f1-f1f1-41f1-81f1-f1f1f1f1f1f1'),
      ('11111111-1111-4111-8111-111111111111', carrier_import.id, 5, repeat('4', 64),
        base_payload || jsonb_build_object('activation_date', '2099-07-05', 'activated_at', '2099-07-05T09:00:00Z', 'fpe_count', 100, 'ibr_value', 10000), '[]',
        'f1f1f1f1-f1f1-41f1-81f1-f1f1f1f1f1f1'),
      ('11111111-1111-4111-8111-111111111111', carrier_import.id, 6, repeat('4', 64),
        base_payload || jsonb_build_object('activation_date', '2099-07-05', 'activated_at', '2099-07-05T09:00:00Z', 'fpe_count', 100, 'ibr_value', 10000), '[]',
        'f1f1f1f1-f1f1-41f1-81f1-f1f1f1f1f1f1'),
      ('11111111-1111-4111-8111-111111111111', carrier_import.id, 7, repeat('5', 64),
        base_payload || jsonb_build_object('activation_date', '', 'activated_at', NULL, 'fpe_count', -1, 'ibr_value', 0),
        '["activation_date is required","fpe_count must be nonnegative"]', NULL);
    SELECT * INTO published_import FROM public.publish_carrier_import(
      '11111111-1111-4111-8111-111111111111', '61616161-6161-4161-8161-616161616161',
      'f7f7f7f7-f7f7-47f7-87f7-f7f7f7f7f7f7', 'f8f8f8f8-f8f8-48f8-88f8-f8f8f8f8f8f8', carrier_import.id
    );
    IF published_import.status <> 'partial' OR published_import.total_rows <> 6
       OR published_import.new_rows <> 4 OR published_import.duplicate_rows <> 1
       OR published_import.rejected_rows <> 1 OR published_import.matched_rows <> 4
       OR (SELECT count(*) FROM public.carrier_activations WHERE import_id = carrier_import.id) <> 4
       OR (SELECT count(*) FROM public.carrier_import_rejections WHERE import_id = carrier_import.id) <> 1 THEN
      RAISE EXCEPTION 'Carrier staged publication counts are not atomic or exact.';
    END IF;
    snapshot := public.carrier_dashboard_snapshot(
      '11111111-1111-4111-8111-111111111111', '{"month":"2099-07"}'::jsonb
    );
    IF (snapshot->'kpis'->>'activationsTotal')::integer <> 4
       OR (snapshot->'kpis'->>'fpe')::numeric <> 105
       OR (snapshot->'kpis'->>'ibr')::numeric <> 10500
       OR (snapshot->'completeness'->>'sourceTotalRows')::integer <> 6
       OR (snapshot->'completeness'->>'duplicateRows')::integer <> 1
       OR (snapshot->'completeness'->>'rejectedRows')::integer <> 1 THEN
      RAISE EXCEPTION 'Carrier SQL dashboard does not reconcile to import control totals: %', snapshot;
    END IF;
    SELECT * INTO verification_run FROM public.run_carrier_verification(
      '11111111-1111-4111-8111-111111111111', '61616161-6161-4161-8161-616161616161',
      'f9f9f9f9-f9f9-49f9-89f9-f9f9f9f9f9f9', carrier_import.id
    );
    IF verification_run.status <> 'completed' OR verification_run.checked_count <> 5
       OR verification_run.discrepancy_count <> 3
       OR (SELECT count(*) FROM public.carrier_sales_verifications WHERE run_id = verification_run.id AND discrepancy_type = 'missing_log') <> 1
       OR (SELECT count(*) FROM public.carrier_sales_verifications WHERE run_id = verification_run.id AND discrepancy_type = 'extra_log') <> 1
       OR (SELECT count(*) FROM public.carrier_sales_verifications WHERE run_id = verification_run.id AND discrepancy_type = 'mapping_missing') <> 1
       OR (SELECT count(*) FROM public.carrier_sales_verifications WHERE run_id = verification_run.id AND NOT has_discrepancy) <> 2 THEN
      RAISE EXCEPTION 'Carrier verification did not full-outer reconcile hand-calculated fixtures: %', row_to_json(verification_run);
    END IF;
    SELECT * INTO verification FROM public.carrier_sales_verifications
    WHERE run_id = verification_run.id AND discrepancy_type = 'missing_log';
    BEGIN
      PERFORM * FROM public.update_carrier_verification(
        '11111111-1111-4111-8111-111111111111', '99999999-9999-4999-8999-999999999999',
        'fafafafa-fafa-4afa-8afa-fafafafafafa', verification.id, 1,
        '{"seen_by_employee":true,"status":"acknowledged"}'::jsonb
      );
      RAISE EXCEPTION 'An employee updated another employee Carrier verification.';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    SELECT * INTO verification FROM public.update_carrier_verification(
      '11111111-1111-4111-8111-111111111111', '61616161-6161-4161-8161-616161616161',
      'fbfbfbfb-fbfb-4bfb-8bfb-fbfbfbfbfbfb', verification.id, 1,
      '{"seen_by_hr":true,"status":"resolved"}'::jsonb
    );
    IF verification.version <> 2 OR verification.status <> 'resolved' OR NOT verification.seen_by_hr THEN
      RAISE EXCEPTION 'Manager Carrier verification command was not atomic.';
    END IF;
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
    PERFORM set_config('request.jwt.claim.sub', '99999999-9999-4999-8999-999999999999', true);
    UPDATE public.carrier_sales_verifications SET employee_note = 'forbidden' WHERE id = verification.id;
    GET DIAGNOSTICS browser_rows = ROW_COUNT;
    RESET ROLE;
    IF browser_rows <> 0 THEN RAISE EXCEPTION 'Direct browser Carrier verification mutation was not denied.'; END IF;
  END
  $test$;

  INSERT INTO public.carrier_activation_imports (
    id, organization_id, file_name, file_sha256, contract_version, activation_month,
    date_range_start, date_range_end, total_rows, staged_rows, new_rows, status,
    uploaded_by, published_at
  ) VALUES (
    'fcfcfcfc-fcfc-4cfc-8cfc-fcfcfcfcfcfc', '11111111-1111-4111-8111-111111111111',
    'carrier-load-25001.xlsx', repeat('c', 64), 'virgin-friendi-activation-v1',
    '2099-08-01', '2099-08-01', '2099-08-31', 25001, 25001, 25001, 'completed',
    '61616161-6161-4161-8161-616161616161', now()
  );
  INSERT INTO public.carrier_activations (
    organization_id, import_id, source_row_hash, source_contract_version, source_row_number,
    activation_count, activation_month, activation_date, channel, dealer_code,
    segment_brand, segment_group, activated_at, fpe_count, ibr_value, ibr_value_excl_vat,
    first_recharge_value, second_recharge_value, uid_percent, first_bundle_qty,
    first_bundle_revenue, lifetime_recharge, initial_balance_total, shift_type
  ) SELECT
    '11111111-1111-4111-8111-111111111111', 'fcfcfcfc-fcfc-4cfc-8cfc-fcfcfcfcfcfc',
    encode(digest('carrier-load-' || value::text, 'sha256'), 'hex'), 'virgin-friendi-activation-v1', value + 1,
    1, '2099-08-01', ('2099-08-01'::date + ((value - 1) % 31))::date,
    'Direct Sales', 'LOAD-' || ((value - 1) % 1000)::text, 'Virgin Mobile', 'Virgin Prepaid',
    ('2099-08-01'::date + ((value - 1) % 31))::timestamp + INTERVAL '9 hours',
    1, 10, 10, 0, 0, 0, 1, 10, 0, 0, 'morning'
  FROM generate_series(1, 25001) value;
  DO $test$
  DECLARE snapshot jsonb;
  BEGIN
    snapshot := public.carrier_dashboard_snapshot(
      '11111111-1111-4111-8111-111111111111', '{"month":"2099-08"}'::jsonb
    );
    IF (snapshot->'kpis'->>'activationsTotal')::integer <> 25001
       OR (snapshot->'kpis'->>'fpe')::integer <> 25001
       OR (snapshot->'completeness'->>'filteredRowCount')::integer <> 25001
       OR (snapshot->'completeness'->>'publishedRows')::integer <> 25001 THEN
      RAISE EXCEPTION 'Carrier dashboard truncated the 25,001-row control dataset: %', snapshot->'completeness';
    END IF;
  END
  $test$;

  SET request.jwt.claim.role = 'service_role';

  UPDATE public.employees
  SET base_salary = 1000, gosi_registered = false
  WHERE id = '12121212-1212-4212-8212-121212121212';

  DO $test$
  DECLARE
    insurance public.social_insurance;
    replayed_insurance public.social_insurance;
    payslip public.payslips;
    replayed_payslip public.payslips;
    payroll_run public.payroll_runs;
    browser_rows integer;
    payroll_event_count integer;
    payroll_outbox_count integer;
    config jsonb := jsonb_build_object(
      'registered', true,
      'gosiNumber', 'GOSI-SMOKE-1',
      'registrationDate', '2098-01-01',
      'schemeCode', 'verified-smoke-scheme',
      'contributoryWage', 1000,
      'maximumContributoryWage', 45000,
      'employeeRateBasisPoints', 975,
      'employerRateBasisPoints', 1175,
      'proratePartialMonth', false,
      'effectiveFrom', '2098-01-01',
      'effectiveTo', ''
    );
    input_snapshot jsonb := jsonb_build_object(
      'month', '2099-02-01', 'calendarDays', 28, 'payableDays', 28,
      'monthlyBaseSalaryHalalas', 100000,
      'allowances', '[]'::jsonb, 'recurringDeductions', '[]'::jsonb,
      'lateDeductionHalalas', 0, 'absenceDeductionHalalas', 0,
      'advanceDeductionHalalas', 0, 'otherDeductionHalalas', 0,
      'manualAdjustments', '[]'::jsonb,
      'insurance', jsonb_build_object('registered', true, 'verified', true),
      'attendance', jsonb_build_object('attendanceDays', 22, 'approvedAbsentDays', 0, 'unapprovedAbsentDays', 0, 'lateMinutes', 0),
      'deductionRule', jsonb_build_object(
        'name', 'Smoke policy', 'lateGraceMinutes', 0,
        'deductionPerLateHourHalalas', 0, 'allowedAbsentDays', 0,
        'deductionPerAbsentDayHalalas', 0, 'deductionPerExcessApprovedDayHalalas', 0
      ),
      'notes', 'Atomic payroll smoke test'
    );
    result_snapshot jsonb := jsonb_build_object(
      'formulaVersion', 'sa-payroll-v1',
      'earnedBaseSalaryHalalas', 100000,
      'allowanceLines', '[]'::jsonb, 'recurringDeductionLines', '[]'::jsonb,
      'manualBonusHalalas', 0, 'manualDeductionHalalas', 0,
      'totalAllowancesHalalas', 0,
      'employeeInsuranceHalalas', 9750,
      'employerInsuranceHalalas', 11750,
      'totalDeductionsHalalas', 9750,
      'grossEarningsHalalas', 100000,
      'netPayHalalas', 90250,
      'totalEmployerCostHalalas', 111750
    );
  BEGIN
    SELECT * INTO insurance FROM public.configure_employee_social_insurance(
      '11111111-1111-4111-8111-111111111111',
      '12121212-1212-4212-8212-121212121212',
      '22222222-2222-4222-8222-222222222222',
      '30303030-3030-4030-8030-303030303030',
      '31313131-3131-4131-8131-313131313131',
      config
    );
    SELECT * INTO replayed_insurance FROM public.configure_employee_social_insurance(
      '11111111-1111-4111-8111-111111111111',
      '12121212-1212-4212-8212-121212121212',
      '22222222-2222-4222-8222-222222222222',
      '30303030-3030-4030-8030-303030303030',
      '31313131-3131-4131-8131-313131313131',
      config
    );
    IF insurance.configuration_status <> 'verified'
       OR replayed_insurance.id <> insurance.id
       OR NOT (SELECT gosi_registered FROM public.employees WHERE id = '12121212-1212-4212-8212-121212121212') THEN
      RAISE EXCEPTION 'Verified social-insurance configuration is not atomic or idempotent.';
    END IF;

    SELECT * INTO payslip FROM public.save_payroll_calculation(
      '11111111-1111-4111-8111-111111111111',
      '12121212-1212-4212-8212-121212121212',
      '2099-02-01',
      '22222222-2222-4222-8222-222222222222',
      '32323232-3232-4232-8232-323232323232',
      '33333333-3333-4333-8333-333333333330',
      0, 'calculate_payslip', input_snapshot, result_snapshot
    );
    SELECT * INTO replayed_payslip FROM public.save_payroll_calculation(
      '11111111-1111-4111-8111-111111111111',
      '12121212-1212-4212-8212-121212121212',
      '2099-02-01',
      '22222222-2222-4222-8222-222222222222',
      '32323232-3232-4232-8232-323232323232',
      '33333333-3333-4333-8333-333333333330',
      0, 'calculate_payslip', input_snapshot, result_snapshot
    );
    IF payslip.id <> replayed_payslip.id OR payslip.calculation_version <> 1
       OR payslip.net_salary <> 902.50 OR payslip.employee_gosi <> 97.50
       OR (SELECT version FROM public.payroll_runs WHERE id = payslip.payroll_run_id) <> 1 THEN
      RAISE EXCEPTION 'Payroll calculation is not exact or idempotent.';
    END IF;

    BEGIN
      PERFORM public.save_payroll_calculation(
        '11111111-1111-4111-8111-111111111111',
        'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        '2099-02-01',
        '22222222-2222-4222-8222-222222222222',
        '34343434-3434-4434-8434-343434343434',
        '35353535-3535-4535-8535-353535353535',
        0, 'calculate_payslip', input_snapshot, result_snapshot
      );
      RAISE EXCEPTION 'Cross-tenant payroll calculation unexpectedly succeeded.';
    EXCEPTION WHEN no_data_found THEN
      NULL;
    END;

    SELECT * INTO payroll_run FROM public.transition_payroll_run(
      '11111111-1111-4111-8111-111111111111', payslip.payroll_run_id,
      '22222222-2222-4222-8222-222222222222',
      '36363636-3636-4636-8636-363636363636',
      '37373737-3737-4737-8737-373737373737',
      1, 'approved', NULL
    );
    SELECT count(*) INTO payroll_event_count FROM public.business_events
      WHERE org_id = '11111111-1111-4111-8111-111111111111'
        AND source_type = 'payroll' AND business_key = payroll_run.id::text || ':approved:' || payroll_run.version::text;
    SELECT count(*) INTO payroll_outbox_count FROM public.event_outbox
      WHERE org_id = '11111111-1111-4111-8111-111111111111' AND topic = 'payroll.run_approved';
    IF payroll_run.status <> 'approved' OR payroll_run.version <> 2
       OR (SELECT status FROM public.payslips WHERE id = payslip.id) <> 'approved'
       OR payroll_event_count <> 1 OR payroll_outbox_count <> 1 THEN
      RAISE EXCEPTION 'Payroll approval did not freeze and publish the run atomically.';
    END IF;

    BEGIN
      UPDATE public.payslips SET base_salary = 999 WHERE id = payslip.id;
      RAISE EXCEPTION 'Frozen payroll mutation unexpectedly succeeded.';
    EXCEPTION WHEN object_not_in_prerequisite_state THEN
      NULL;
    END;

    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
    PERFORM set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
    UPDATE public.payslips SET net_salary = 1 WHERE id = payslip.id;
    GET DIAGNOSTICS browser_rows = ROW_COUNT;
    RESET ROLE;
    IF browser_rows <> 0 THEN
      RAISE EXCEPTION 'Direct browser payroll mutation was not denied.';
    END IF;
  END
  $test$;

  SET request.jwt.claim.role = 'service_role';

  SELECT public.initialize_accounting_defaults(
    '11111111-1111-4111-8111-111111111111',
    '45454545-4545-4545-8545-454545454545'
  );

  DO $test$
  DECLARE
    debit_account uuid;
    credit_account uuid;
    journal public.accounting_journal_entries;
    replayed_journal public.accounting_journal_entries;
    posted public.accounting_journal_entries;
    replayed_posted public.accounting_journal_entries;
    reversal public.accounting_journal_entries;
    replayed_reversal public.accounting_journal_entries;
    journal_payload jsonb;
    browser_rows integer;
    journal_audit_count integer;
    pending_event_count integer;
    posted_event_count integer;
    reversed_event_count integer;
    reversal_posted_event_count integer;
  BEGIN
    SELECT id INTO debit_account FROM public.accounting_accounts
      WHERE organization_id = '11111111-1111-4111-8111-111111111111' AND code = '1000';
    SELECT id INTO credit_account FROM public.accounting_accounts
      WHERE organization_id = '11111111-1111-4111-8111-111111111111' AND code = '3000';
    journal_payload := jsonb_build_object(
      'entryDate', '2099-03-01', 'description', 'Atomic journal smoke test',
      'notes', 'must commit as one unit', 'sourceModule', 'manual', 'sourceId', NULL,
      'status', 'pending_approval',
      'lines', jsonb_build_array(
        jsonb_build_object('account_id', debit_account, 'debit', 125.45, 'credit', 0),
        jsonb_build_object('account_id', credit_account, 'debit', 0, 'credit', 125.45)
      )
    );
    SELECT * INTO journal FROM public.accounting_save_journal(
      '11111111-1111-4111-8111-111111111111',
      '45454545-4545-4545-8545-454545454545',
      '46464646-4646-4646-8646-464646464646',
      '47474747-4747-4747-8747-474747474747',
      NULL, 0, journal_payload
    );
    SELECT * INTO replayed_journal FROM public.accounting_save_journal(
      '11111111-1111-4111-8111-111111111111',
      '45454545-4545-4545-8545-454545454545',
      '46464646-4646-4646-8646-464646464646',
      '47474747-4747-4747-8747-474747474747',
      NULL, 0, journal_payload
    );
    SELECT count(*) INTO pending_event_count FROM public.event_outbox
      WHERE org_id = '11111111-1111-4111-8111-111111111111'
        AND topic = 'accounting.journal_pending_approval'
        AND payload->>'journal_entry_id' = journal.id::text;
    IF journal.id IS NULL OR replayed_journal.id <> journal.id OR journal.status <> 'pending_approval'
       OR journal.version <> 1 OR journal.total_debit <> 125.45
       OR (SELECT count(*) FROM public.accounting_journal_lines WHERE journal_entry_id = journal.id) <> 2
       OR (SELECT count(*) FROM public.accounting_journal_entries WHERE description = 'Atomic journal smoke test') <> 1
       OR pending_event_count <> 1 THEN
      RAISE EXCEPTION 'Atomic journal creation is not exact or idempotent.';
    END IF;

    SELECT * INTO posted FROM public.accounting_post_journal(
      '11111111-1111-4111-8111-111111111111', journal.id,
      '45454545-4545-4545-8545-454545454545',
      '48484848-4848-4848-8848-484848484848',
      '49494949-4949-4949-8949-494949494949', 1
    );
    SELECT * INTO replayed_posted FROM public.accounting_post_journal(
      '11111111-1111-4111-8111-111111111111', journal.id,
      '45454545-4545-4545-8545-454545454545',
      '48484848-4848-4848-8848-484848484848',
      '49494949-4949-4949-8949-494949494949', 1
    );
    SELECT count(*) INTO posted_event_count FROM public.event_outbox
      WHERE org_id = '11111111-1111-4111-8111-111111111111'
        AND topic = 'accounting.journal_posted'
        AND payload->>'journal_entry_id' = journal.id::text;
    IF posted.status <> 'posted' OR posted.version <> 2 OR replayed_posted.id <> posted.id
       OR posted_event_count <> 1 THEN
      RAISE EXCEPTION 'Atomic journal posting is not idempotent.';
    END IF;

    BEGIN
      PERFORM public.accounting_post_journal(
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', journal.id,
        '45454545-4545-4545-8545-454545454545',
        '50505050-5050-4050-8050-505050505050',
        '51515151-5151-4151-8151-515151515151', 2
      );
      RAISE EXCEPTION 'Cross-tenant journal posting unexpectedly succeeded.';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;

    SELECT * INTO reversal FROM public.accounting_reverse_journal(
      '11111111-1111-4111-8111-111111111111', journal.id,
      '45454545-4545-4545-8545-454545454545',
      '52525252-5252-4252-8252-525252525252',
      '53535353-5353-4353-8353-535353535353', 2, 'Smoke reversal'
    );
    SELECT * INTO replayed_reversal FROM public.accounting_reverse_journal(
      '11111111-1111-4111-8111-111111111111', journal.id,
      '45454545-4545-4545-8545-454545454545',
      '52525252-5252-4252-8252-525252525252',
      '53535353-5353-4353-8353-535353535353', 2, 'Smoke reversal'
    );
    SELECT count(*) INTO journal_audit_count FROM public.operational_audit_logs
      WHERE org_id = '11111111-1111-4111-8111-111111111111'
        AND target_id IN (journal.id::text);
    SELECT count(*) INTO reversed_event_count FROM public.event_outbox
      WHERE org_id = '11111111-1111-4111-8111-111111111111'
        AND topic = 'accounting.journal_reversed'
        AND payload->>'journal_entry_id' = journal.id::text
        AND payload->>'reversal_entry_id' = reversal.id::text;
    SELECT count(*) INTO reversal_posted_event_count FROM public.event_outbox
      WHERE org_id = '11111111-1111-4111-8111-111111111111'
        AND topic = 'accounting.journal_posted'
        AND payload->>'journal_entry_id' = reversal.id::text;
    IF reversal.id IS NULL OR replayed_reversal.id <> reversal.id OR reversal.status <> 'posted'
       OR (SELECT status FROM public.accounting_journal_entries WHERE id = journal.id) <> 'reversed'
       OR (SELECT count(*) FROM public.accounting_journal_entries WHERE reversal_of = journal.id) <> 1
       OR journal_audit_count <> 3 OR reversed_event_count <> 1 OR reversal_posted_event_count <> 1 THEN
      RAISE EXCEPTION 'Atomic journal reversal or audit trail is inconsistent.';
    END IF;

    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
    PERFORM set_config('request.jwt.claim.sub', '45454545-4545-4545-8545-454545454545', true);
    browser_rows := 0;
    BEGIN
      INSERT INTO public.accounting_journal_entries (
        organization_id, entry_no, entry_date, description, total_debit, total_credit, created_by
      ) VALUES (
        '11111111-1111-4111-8111-111111111111', 'BROWSER-FORBIDDEN', '2099-03-01',
        'Forbidden browser journal', 1, 1, '45454545-4545-4545-8545-454545454545'
      ) ON CONFLICT DO NOTHING;
      GET DIAGNOSTICS browser_rows = ROW_COUNT;
    EXCEPTION WHEN insufficient_privilege THEN
      browser_rows := 0;
    END;
    RESET ROLE;
    IF browser_rows <> 0 OR EXISTS (SELECT 1 FROM public.accounting_journal_entries WHERE entry_no = 'BROWSER-FORBIDDEN') THEN
      RAISE EXCEPTION 'Direct browser journal mutation was not denied.';
    END IF;
  END
  $test$;

  SET request.jwt.claim.role = 'service_role';

  DO $test$
  DECLARE customer public.accounting_customers; replayed public.accounting_customers;
  BEGIN
    SELECT * INTO customer FROM public.accounting_save_customer(
      '11111111-1111-4111-8111-111111111111', '45454545-4545-4545-8545-454545454545',
      '60606060-6060-4060-8060-606060606061', '60606060-6060-4060-8060-606060606062',
      NULL, 0, jsonb_build_object('name_ar', 'Atomic Customer', 'sales_company_id',
        'e1e1e1e1-e1e1-41e1-81e1-e1e1e1e1e1e1', 'is_active', true)
    );
    SELECT * INTO replayed FROM public.accounting_save_customer(
      '11111111-1111-4111-8111-111111111111', '45454545-4545-4545-8545-454545454545',
      '60606060-6060-4060-8060-606060606061', '60606060-6060-4060-8060-606060606062',
      NULL, 0, jsonb_build_object('name_ar', 'Atomic Customer', 'sales_company_id',
        'e1e1e1e1-e1e1-41e1-81e1-e1e1e1e1e1e1', 'is_active', true)
    );
    IF replayed.id <> customer.id
       OR (SELECT sales_company_id FROM public.accounting_customers
            WHERE id = customer.id) <> 'e1e1e1e1-e1e1-41e1-81e1-e1e1e1e1e1e1'
       OR (SELECT accounting_customer_id FROM public.sales_companies
            WHERE id = 'e1e1e1e1-e1e1-41e1-81e1-e1e1e1e1e1e1') <> customer.id
       OR (SELECT count(*) FROM public.event_outbox WHERE topic = 'accounting.customer_saved'
            AND payload->>'customer_name' = 'Atomic Customer') <> 1 THEN
      RAISE EXCEPTION 'Sales-company/accounting-customer link was not atomic and replay-safe.';
    END IF;
  END
  $test$;

  UPDATE public.accounting_settings settings SET
    default_gosi_expense_id = expense.id,
    default_gosi_payable_id = payable.id
  FROM public.accounting_accounts expense, public.accounting_accounts payable
  WHERE settings.organization_id = '11111111-1111-4111-8111-111111111111'
    AND expense.organization_id = settings.organization_id AND expense.code = '5030'
    AND payable.organization_id = settings.organization_id AND payable.code = '2300';

  DO $test$
  DECLARE
    tax_id uuid;
    bank_id uuid;
    cash_id uuid;
    revenue_id uuid;
    expense_account_id uuid;
    salary_expense_id uuid;
    salary_payable_id uuid;
    gosi_expense_id uuid;
    gosi_payable_id uuid;
    invoice public.accounting_invoices;
    replayed_invoice public.accounting_invoices;
    issued public.accounting_invoices;
    invoice_payment_one public.accounting_payments;
    invoice_payment_two public.accounting_payments;
    expense public.accounting_expenses;
    approved_expense public.accounting_expenses;
    expense_payment_one public.accounting_payments;
    expense_payment_two public.accounting_payments;
    payroll_run public.payroll_runs;
    payroll_journal public.accounting_journal_entries;
    payroll_payment public.accounting_payments;
    period public.accounting_periods;
    closed_period public.accounting_periods;
    replayed_period public.accounting_periods;
    reopened_period public.accounting_periods;
    replayed_reopened_period public.accounting_periods;
    reclosed_period public.accounting_periods;
    budget public.accounting_budgets;
    replayed_budget public.accounting_budgets;
    updated_budget public.accounting_budgets;
    approved_budget public.accounting_budgets;
    invoice_payload jsonb;
    expense_payload jsonb;
    browser_rows integer;
    browser_budget_rows integer;
  BEGIN
    SELECT id INTO tax_id FROM public.accounting_tax_rates
      WHERE organization_id = '11111111-1111-4111-8111-111111111111' AND is_default LIMIT 1;
    SELECT id INTO bank_id FROM public.accounting_accounts WHERE organization_id = '11111111-1111-4111-8111-111111111111' AND code = '1010';
    SELECT id INTO cash_id FROM public.accounting_accounts WHERE organization_id = '11111111-1111-4111-8111-111111111111' AND code = '1000';
    SELECT id INTO revenue_id FROM public.accounting_accounts WHERE organization_id = '11111111-1111-4111-8111-111111111111' AND code = '4000';
    SELECT id INTO expense_account_id FROM public.accounting_accounts WHERE organization_id = '11111111-1111-4111-8111-111111111111' AND code = '5900';
    SELECT id INTO salary_expense_id FROM public.accounting_accounts WHERE organization_id = '11111111-1111-4111-8111-111111111111' AND code = '5000';
    SELECT id INTO salary_payable_id FROM public.accounting_accounts WHERE organization_id = '11111111-1111-4111-8111-111111111111' AND code = '2200';
    SELECT id INTO gosi_expense_id FROM public.accounting_accounts WHERE organization_id = '11111111-1111-4111-8111-111111111111' AND code = '5030';
    SELECT id INTO gosi_payable_id FROM public.accounting_accounts WHERE organization_id = '11111111-1111-4111-8111-111111111111' AND code = '2300';

    invoice_payload := jsonb_build_object(
      'customerId', (SELECT id FROM public.accounting_customers
        WHERE organization_id = '11111111-1111-4111-8111-111111111111'
          AND name_ar = 'Atomic Customer'),
      'invoiceDate', '2099-03-05', 'dueDate', '2099-03-31',
      'sourceModule', 'manual', 'sourceId', NULL, 'notes', 'Atomic invoice smoke',
      'lines', jsonb_build_array(jsonb_build_object(
        'description_ar', 'خدمة اختبار', 'quantity', 2, 'unit_price', 100,
        'discount_amount', 10, 'tax_rate_id', tax_id,
        'revenue_account_id', revenue_id
      ))
    );
    SELECT * INTO invoice FROM public.accounting_save_invoice(
      '11111111-1111-4111-8111-111111111111', '45454545-4545-4545-8545-454545454545',
      '61616161-6161-4161-8161-616161616161', '62626262-6262-4262-8262-626262626262',
      NULL, 0, invoice_payload
    );
    SELECT * INTO replayed_invoice FROM public.accounting_save_invoice(
      '11111111-1111-4111-8111-111111111111', '45454545-4545-4545-8545-454545454545',
      '61616161-6161-4161-8161-616161616161', '62626262-6262-4262-8262-626262626262',
      NULL, 0, invoice_payload
    );
    IF invoice.id IS NULL OR replayed_invoice.id <> invoice.id OR invoice.subtotal <> 200
       OR invoice.discount_amount <> 10 OR invoice.vat_amount <> 28.50 OR invoice.total_amount <> 218.50
       OR (SELECT count(*) FROM public.accounting_invoice_lines WHERE invoice_id = invoice.id) <> 1 THEN
      RAISE EXCEPTION 'Atomic invoice calculation or idempotency failed.';
    END IF;
    SELECT * INTO issued FROM public.accounting_issue_invoice(
      '11111111-1111-4111-8111-111111111111', invoice.id,
      '45454545-4545-4545-8545-454545454545',
      '63636363-6363-4363-8363-636363636363', '64646464-6464-4464-8464-646464646464', 0
    );
    IF issued.status <> 'issued' OR issued.journal_entry_id IS NULL
       OR (SELECT status FROM public.accounting_journal_entries WHERE id = issued.journal_entry_id) <> 'posted' THEN
      RAISE EXCEPTION 'Invoice issuance and ledger posting were not atomic.';
    END IF;

    SELECT * INTO invoice_payment_one FROM public.accounting_save_payment(
      '11111111-1111-4111-8111-111111111111', '45454545-4545-4545-8545-454545454545',
      '65656565-6565-4565-8565-656565656565', '66666666-6666-4666-8666-666666666666',
      NULL, 0, true, jsonb_build_object(
        'paymentDate', '2099-03-10', 'type', 'customer_receipt', 'direction', 'inbound',
        'amount', 100, 'accountId', bank_id, 'customerId', issued.customer_id,
        'invoiceId', issued.id, 'description', 'Partial invoice receipt'
      )
    );
    SELECT * INTO invoice_payment_two FROM public.accounting_save_payment(
      '11111111-1111-4111-8111-111111111111', '45454545-4545-4545-8545-454545454545',
      '67676767-6767-4767-8767-676767676767', '68686868-6868-4868-8868-686868686868',
      NULL, 0, true, jsonb_build_object(
        'paymentDate', '2099-03-11', 'type', 'customer_receipt', 'direction', 'inbound',
        'amount', 118.50, 'accountId', bank_id, 'customerId', issued.customer_id,
        'invoiceId', issued.id, 'description', 'Final invoice receipt'
      )
    );
    IF invoice_payment_one.status <> 'posted' OR invoice_payment_two.status <> 'posted'
       OR (SELECT status FROM public.accounting_invoices WHERE id = invoice.id) <> 'paid'
       OR (SELECT balance_due FROM public.accounting_invoices WHERE id = invoice.id) <> 0 THEN
      RAISE EXCEPTION 'Invoice receipt did not atomically settle the invoice.';
    END IF;

    expense_payload := jsonb_build_object(
      'expenseDate', '2099-03-12', 'categoryAccountId', expense_account_id,
      'description', 'Atomic expense smoke', 'amountBeforeVat', 200, 'vatAmount', 30,
      'status', 'pending_approval'
    );
    SELECT * INTO expense FROM public.accounting_save_expense(
      '11111111-1111-4111-8111-111111111111', '45454545-4545-4545-8545-454545454545',
      '69696969-6969-4969-8969-696969696969', '70707070-7070-4070-8070-707070707070',
      NULL, 0, expense_payload
    );
    SELECT * INTO approved_expense FROM public.accounting_transition_expense(
      '11111111-1111-4111-8111-111111111111', expense.id,
      '45454545-4545-4545-8545-454545454545',
      '71717171-7171-4171-8171-717171717171', '72727272-7272-4272-8272-727272727272',
      0, 'approve', NULL, false
    );
    IF approved_expense.status <> 'approved' OR approved_expense.journal_entry_id IS NULL THEN
      RAISE EXCEPTION 'Expense approval and posting were not atomic.';
    END IF;
    SELECT * INTO expense_payment_one FROM public.accounting_save_payment(
      '11111111-1111-4111-8111-111111111111', '45454545-4545-4545-8545-454545454545',
      '73737373-7373-4373-8373-737373737373', '74747474-7474-4474-8474-747474747474',
      NULL, 0, true, jsonb_build_object(
        'paymentDate', '2099-03-13', 'type', 'vendor_payment', 'direction', 'outbound',
        'amount', 100, 'accountId', cash_id, 'expenseId', expense.id, 'description', 'Partial expense payment'
      )
    );
    SELECT * INTO expense_payment_two FROM public.accounting_save_payment(
      '11111111-1111-4111-8111-111111111111', '45454545-4545-4545-8545-454545454545',
      '75757575-7575-4575-8575-757575757575', '76767676-7676-4676-8676-767676767676',
      NULL, 0, true, jsonb_build_object(
        'paymentDate', '2099-03-14', 'type', 'vendor_payment', 'direction', 'outbound',
        'amount', 130, 'accountId', cash_id, 'expenseId', expense.id, 'description', 'Final expense payment'
      )
    );
    IF expense_payment_one.status <> 'posted' OR expense_payment_two.status <> 'posted'
       OR (SELECT status FROM public.accounting_expenses WHERE id = expense.id) <> 'paid'
       OR (SELECT paid_status FROM public.accounting_expenses WHERE id = expense.id) <> 'paid' THEN
      RAISE EXCEPTION 'Expense payments did not atomically settle the expense.';
    END IF;

    SELECT * INTO payroll_run FROM public.payroll_runs
      WHERE org_id = '11111111-1111-4111-8111-111111111111' AND month = '2099-02-01';
    SELECT * INTO payroll_journal FROM public.accounting_save_journal(
      '11111111-1111-4111-8111-111111111111', '45454545-4545-4545-8545-454545454545',
      '77777777-7777-4777-8777-777777777777', '78787878-7878-4878-8878-787878787878',
      NULL, 0, jsonb_build_object(
        'entryDate', '2099-02-28', 'description', 'Approved payroll accrual',
        'sourceModule', 'payroll', 'sourceId', payroll_run.id, 'status', 'posted',
        'lines', jsonb_build_array(
          jsonb_build_object('account_id', salary_expense_id, 'debit', payroll_run.total_net + payroll_run.total_employee_gosi, 'credit', 0),
          jsonb_build_object('account_id', gosi_expense_id, 'debit', payroll_run.total_employer_gosi, 'credit', 0),
          jsonb_build_object('account_id', salary_payable_id, 'debit', 0, 'credit', payroll_run.total_net),
          jsonb_build_object('account_id', gosi_payable_id, 'debit', 0, 'credit', payroll_run.total_employee_gosi + payroll_run.total_employer_gosi)
        )
      )
    );
    SELECT * INTO payroll_payment FROM public.accounting_save_payment(
      '11111111-1111-4111-8111-111111111111', '45454545-4545-4545-8545-454545454545',
      '79797979-7979-4979-8979-797979797979', '80808080-8080-4080-8080-808080808080',
      NULL, 0, true, jsonb_build_object(
        'paymentDate', '2099-03-01', 'type', 'payroll_payment', 'direction', 'outbound',
        'amount', payroll_run.total_net, 'accountId', bank_id, 'payrollId', payroll_run.id,
        'description', 'Atomic payroll settlement'
      )
    );
    IF payroll_journal.status <> 'posted' OR payroll_payment.status <> 'posted'
       OR (SELECT status FROM public.payroll_runs WHERE id = payroll_run.id) <> 'paid'
       OR EXISTS (SELECT 1 FROM public.payslips WHERE payroll_run_id = payroll_run.id AND status <> 'paid')
       OR (SELECT count(*) FROM public.business_events WHERE source_type = 'payroll'
            AND business_key LIKE payroll_run.id::text || ':paid:%') <> 1
       OR (SELECT count(*) FROM public.event_outbox WHERE topic = 'payroll.run_paid') <> 1 THEN
      RAISE EXCEPTION 'Payroll payment did not atomically settle and publish the run.';
    END IF;

    INSERT INTO public.accounting_periods (id, organization_id, name, start_date, end_date)
    VALUES ('81818181-8181-4181-8181-818181818181', '11111111-1111-4111-8111-111111111111',
      'April 2099', '2099-04-01', '2099-04-30') RETURNING * INTO period;
    SELECT * INTO closed_period FROM public.accounting_close_period(
      '11111111-1111-4111-8111-111111111111', period.id,
      '45454545-4545-4545-8545-454545454545',
      '82828282-8282-4282-8282-828282828282', '83838383-8383-4383-8383-838383838383', 0
    );
    SELECT * INTO replayed_period FROM public.accounting_close_period(
      '11111111-1111-4111-8111-111111111111', period.id,
      '45454545-4545-4545-8545-454545454545',
      '82828282-8282-4282-8282-828282828282', '83838383-8383-4383-8383-838383838383', 0
    );
    IF closed_period.status <> 'closed' OR replayed_period.id <> closed_period.id OR closed_period.version <> 1 THEN
      RAISE EXCEPTION 'Accounting period close is not atomic or idempotent.';
    END IF;
    SELECT * INTO reopened_period FROM public.accounting_reopen_period(
      '11111111-1111-4111-8111-111111111111', period.id,
      '45454545-4545-4545-8545-454545454545',
      '98989898-9898-4898-8898-989898989898', '99999998-9998-4998-8998-999999999998',
      1, 'Correction required by smoke test'
    );
    SELECT * INTO replayed_reopened_period FROM public.accounting_reopen_period(
      '11111111-1111-4111-8111-111111111111', period.id,
      '45454545-4545-4545-8545-454545454545',
      '98989898-9898-4898-8898-989898989898', '99999998-9998-4998-8998-999999999998',
      1, 'Correction required by smoke test'
    );
    SELECT * INTO reclosed_period FROM public.accounting_close_period(
      '11111111-1111-4111-8111-111111111111', period.id,
      '45454545-4545-4545-8545-454545454545',
      'a0a0a0a0-a0a0-40a0-80a0-a0a0a0a0a0a0', 'a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1', 2
    );
    IF reopened_period.status <> 'open' OR reopened_period.version <> 2
       OR replayed_reopened_period.id <> reopened_period.id
       OR reclosed_period.status <> 'closed' OR reclosed_period.version <> 3 THEN
      RAISE EXCEPTION 'Accounting period reopen/reclose control is inconsistent.';
    END IF;
    IF (SELECT count(*) FROM public.event_outbox
          WHERE topic = 'accounting.record_changed'
            AND payload->>'record_id' = invoice.id::text) <> 3
       OR (SELECT count(*) FROM public.event_outbox
          WHERE topic = 'accounting.record_changed'
            AND payload->>'record_id' = expense.id::text) <> 4
       OR (SELECT count(*) FROM public.event_outbox
          WHERE topic = 'accounting.record_changed'
            AND payload->>'record_id' IN (
              invoice_payment_one.id::text, invoice_payment_two.id::text,
              expense_payment_one.id::text, expense_payment_two.id::text,
              payroll_payment.id::text
            )) <> 5
       OR (SELECT count(*) FROM public.event_outbox
          WHERE topic = 'accounting.record_changed'
            AND payload->>'record_id' = period.id::text) <> 3 THEN
      RAISE EXCEPTION 'Durable accounting record events were not emitted exactly once per committed transition.';
    END IF;

    SELECT * INTO budget FROM public.accounting_save_budget(
      '11111111-1111-4111-8111-111111111111', '45454545-4545-4545-8545-454545454545',
      'a2a2a2a2-a2a2-42a2-82a2-a2a2a2a2a2a2', 'a3a3a3a3-a3a3-43a3-83a3-a3a3a3a3a3a3',
      NULL, 0, jsonb_build_object('name', 'Atomic Budget', 'fiscalYear', 2099,
        'lines', jsonb_build_array(jsonb_build_object(
          'accountId', expense_account_id, 'costCenterId', NULL, 'month', 5, 'amount', 120.25, 'notes', 'May control'
        )))
    );
    SELECT * INTO replayed_budget FROM public.accounting_save_budget(
      '11111111-1111-4111-8111-111111111111', '45454545-4545-4545-8545-454545454545',
      'a2a2a2a2-a2a2-42a2-82a2-a2a2a2a2a2a2', 'a3a3a3a3-a3a3-43a3-83a3-a3a3a3a3a3a3',
      NULL, 0, jsonb_build_object('name', 'Atomic Budget', 'fiscalYear', 2099,
        'lines', jsonb_build_array(jsonb_build_object(
          'accountId', expense_account_id, 'costCenterId', NULL, 'month', 5, 'amount', 120.25, 'notes', 'May control'
        )))
    );
    SELECT * INTO updated_budget FROM public.accounting_save_budget(
      '11111111-1111-4111-8111-111111111111', '45454545-4545-4545-8545-454545454545',
      'a4a4a4a4-a4a4-44a4-84a4-a4a4a4a4a4a4', 'a5a5a5a5-a5a5-45a5-85a5-a5a5a5a5a5a5',
      budget.id, 0, jsonb_build_object('name', 'Atomic Budget', 'fiscalYear', 2099,
        'lines', jsonb_build_array(jsonb_build_object(
          'accountId', expense_account_id, 'costCenterId', NULL, 'month', 5, 'amount', 130.75, 'notes', 'Updated control'
        )))
    );
    SELECT * INTO approved_budget FROM public.accounting_approve_budget(
      '11111111-1111-4111-8111-111111111111', budget.id,
      '45454545-4545-4545-8545-454545454545',
      'a6a6a6a6-a6a6-46a6-86a6-a6a6a6a6a6a6', 'a7a7a7a7-a7a7-47a7-87a7-a7a7a7a7a7a7', 1
    );
    IF replayed_budget.id <> budget.id OR updated_budget.version <> 1
       OR approved_budget.status <> 'approved' OR approved_budget.version <> 2
       OR (SELECT amount FROM public.accounting_budget_lines WHERE budget_id = budget.id) <> 130.75 THEN
      RAISE EXCEPTION 'Budget commands are not atomic, idempotent, and versioned.';
    END IF;

    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
    PERFORM set_config('request.jwt.claim.sub', '45454545-4545-4545-8545-454545454545', true);
    browser_rows := 0;
    BEGIN
      INSERT INTO public.accounting_invoices (organization_id, invoice_no, invoice_date)
      VALUES ('11111111-1111-4111-8111-111111111111', 'BROWSER-INVOICE', '2099-03-01');
      GET DIAGNOSTICS browser_rows = ROW_COUNT;
    EXCEPTION WHEN insufficient_privilege THEN browser_rows := 0;
    END;
    browser_budget_rows := 0;
    BEGIN
      UPDATE public.accounting_budgets SET name = 'Forbidden browser budget' WHERE id = budget.id;
      GET DIAGNOSTICS browser_budget_rows = ROW_COUNT;
    EXCEPTION WHEN insufficient_privilege THEN browser_budget_rows := 0;
    END;
    RESET ROLE;
    IF browser_rows <> 0 OR browser_budget_rows <> 0
       OR EXISTS (SELECT 1 FROM public.accounting_invoices WHERE invoice_no = 'BROWSER-INVOICE')
       OR (SELECT name FROM public.accounting_budgets WHERE id = budget.id) <> 'Atomic Budget' THEN
      RAISE EXCEPTION 'Direct browser financial-document mutation was not denied.';
    END IF;
  END
  $test$;

  SET request.jwt.claim.role = 'service_role';

  DO $test$
  DECLARE
    submitted public.advance_requests;
    replayed_submitted public.advance_requests;
    approved public.advance_requests;
    replayed_approved public.advance_requests;
    disbursed public.advance_requests;
    replayed_disbursed public.advance_requests;
    installment_id uuid;
    bank_id uuid;
    salary_expense_id uuid;
    salary_payable_id uuid;
    gosi_expense_id uuid;
    gosi_payable_id uuid;
    advances_account_id uuid;
    june_payslip public.payslips;
    june_run public.payroll_runs;
    june_journal public.accounting_journal_entries;
    reconciliation jsonb;
    browser_rows integer;
    input_snapshot jsonb;
    result_snapshot jsonb;
  BEGIN
    SELECT id INTO bank_id FROM public.accounting_accounts
      WHERE organization_id = '11111111-1111-4111-8111-111111111111' AND code = '1010';
    SELECT id INTO salary_expense_id FROM public.accounting_accounts
      WHERE organization_id = '11111111-1111-4111-8111-111111111111' AND code = '5000';
    SELECT id INTO salary_payable_id FROM public.accounting_accounts
      WHERE organization_id = '11111111-1111-4111-8111-111111111111' AND code = '2200';
    SELECT id INTO gosi_expense_id FROM public.accounting_accounts
      WHERE organization_id = '11111111-1111-4111-8111-111111111111' AND code = '5030';
    SELECT id INTO gosi_payable_id FROM public.accounting_accounts
      WHERE organization_id = '11111111-1111-4111-8111-111111111111' AND code = '2300';
    SELECT id INTO advances_account_id FROM public.accounting_accounts
      WHERE organization_id = '11111111-1111-4111-8111-111111111111' AND code = '1200';

    SELECT * INTO submitted FROM public.submit_advance_request(
      '11111111-1111-4111-8111-111111111111',
      '12121212-1212-4212-8212-121212121212',
      '99999999-9999-4999-8999-999999999999',
      '84848484-8484-4484-8484-848484848484',
      '85858585-8585-4585-8585-858585858585',
      300.01, 'Atomic advance smoke test', 'data:image/png;base64,c21va2U=', 3, '2099-06-01'
    );
    SELECT * INTO replayed_submitted FROM public.submit_advance_request(
      '11111111-1111-4111-8111-111111111111',
      '12121212-1212-4212-8212-121212121212',
      '99999999-9999-4999-8999-999999999999',
      '84848484-8484-4484-8484-848484848484',
      '85858585-8585-4585-8585-858585858585',
      300.01, 'Atomic advance smoke test', 'data:image/png;base64,c21va2U=', 3, '2099-06-01'
    );
    IF submitted.id IS NULL OR replayed_submitted.id <> submitted.id OR submitted.status <> 'pending'
       OR (SELECT count(*) FROM public.advance_requests WHERE employee_id = submitted.employee_id) <> 1 THEN
      RAISE EXCEPTION 'Advance submission is not idempotent.';
    END IF;

    SELECT * INTO approved FROM public.review_advance_request(
      '11111111-1111-4111-8111-111111111111', submitted.id,
      '22222222-2222-4222-8222-222222222222',
      '86868686-8686-4686-8686-868686868686',
      '87878787-8787-4787-8787-878787878787',
      0, 'approved', 300.01, 'Approved by smoke test'
    );
    SELECT * INTO replayed_approved FROM public.review_advance_request(
      '11111111-1111-4111-8111-111111111111', submitted.id,
      '22222222-2222-4222-8222-222222222222',
      '86868686-8686-4686-8686-868686868686',
      '87878787-8787-4787-8787-878787878787',
      0, 'approved', 300.01, 'Approved by smoke test'
    );
    IF approved.version <> 1 OR replayed_approved.id <> approved.id
       OR (SELECT count(*) FROM public.advance_installments WHERE advance_request_id = approved.id) <> 3
       OR (SELECT sum(amount) FROM public.advance_installments WHERE advance_request_id = approved.id) <> 300.01
       OR (SELECT amount FROM public.advance_installments WHERE advance_request_id = approved.id AND sequence_no = 1) <> 100.01
       OR (SELECT max(due_month) FROM public.advance_installments WHERE advance_request_id = approved.id) <> DATE '2099-08-01' THEN
      RAISE EXCEPTION 'Advance review did not create one exact installment schedule.';
    END IF;

    BEGIN
      PERFORM public.review_advance_request(
        '11111111-1111-4111-8111-111111111111', submitted.id,
        '22222222-2222-4222-8222-222222222222',
        '88888888-8888-4888-8888-888888888888',
        '89898989-8989-4989-8989-898989898989',
        0, 'approved', 300.01, 'Duplicate review'
      );
      RAISE EXCEPTION 'A repeated advance review unexpectedly succeeded.';
    EXCEPTION WHEN serialization_failure THEN NULL;
    END;

    BEGIN
      PERFORM public.review_advance_request(
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', submitted.id,
        '22222222-2222-4222-8222-222222222222',
        '90909090-9090-4090-8090-909090909090',
        '91919191-9191-4191-8191-919191919191',
        0, 'approved', 300.01, 'Cross tenant review'
      );
      RAISE EXCEPTION 'Cross-tenant advance review unexpectedly succeeded.';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;

    SELECT * INTO disbursed FROM public.disburse_advance_request(
      '11111111-1111-4111-8111-111111111111', approved.id,
      '45454545-4545-4545-8545-454545454545',
      '92929292-9292-4292-8292-929292929292',
      '93939393-9393-4393-8393-939393939393',
      1, '2099-05-25', bank_id, 'bank_transfer', 'ADV-SMOKE-1'
    );
    SELECT * INTO replayed_disbursed FROM public.disburse_advance_request(
      '11111111-1111-4111-8111-111111111111', approved.id,
      '45454545-4545-4545-8545-454545454545',
      '92929292-9292-4292-8292-929292929292',
      '93939393-9393-4393-8393-939393939393',
      1, '2099-05-25', bank_id, 'bank_transfer', 'ADV-SMOKE-1'
    );
    IF disbursed.status <> 'disbursed' OR disbursed.version <> 2
       OR replayed_disbursed.payment_id <> disbursed.payment_id OR disbursed.outstanding_amount <> 300.01
       OR (SELECT status FROM public.accounting_payments WHERE id = disbursed.payment_id) <> 'posted'
       OR (SELECT count(*) FROM public.financial_balances WHERE advance_request_id = disbursed.id AND amount = 300.01) <> 1
       OR (SELECT count(*) FROM public.business_events WHERE source_type = 'advance' AND business_key LIKE disbursed.id::text || ':disbursed:%') <> 1
       OR (SELECT count(*) FROM public.event_outbox WHERE topic = 'advance.request_disbursed') <> 1 THEN
      RAISE EXCEPTION 'Advance disbursement did not atomically post, publish, and create its balance.';
    END IF;

    SELECT id INTO installment_id FROM public.advance_installments
      WHERE advance_request_id = disbursed.id AND sequence_no = 1;
    input_snapshot := jsonb_build_object(
      'month', '2099-06-01', 'calendarDays', 30, 'payableDays', 30,
      'monthlyBaseSalaryHalalas', 100000,
      'allowances', '[]'::jsonb, 'recurringDeductions', '[]'::jsonb,
      'lateDeductionHalalas', 0, 'absenceDeductionHalalas', 0,
      'advanceDeductionHalalas', 10001, 'advanceInstallmentIds', jsonb_build_array(installment_id),
      'otherDeductionHalalas', 0, 'manualAdjustments', '[]'::jsonb,
      'insurance', jsonb_build_object('registered', true, 'verified', true),
      'attendance', jsonb_build_object('attendanceDays', 22, 'approvedAbsentDays', 0, 'unapprovedAbsentDays', 0, 'lateMinutes', 0),
      'deductionRule', jsonb_build_object(
        'name', 'Smoke policy', 'lateGraceMinutes', 0,
        'deductionPerLateHourHalalas', 0, 'allowedAbsentDays', 0,
        'deductionPerAbsentDayHalalas', 0, 'deductionPerExcessApprovedDayHalalas', 0
      ),
      'notes', 'Advance payroll installment smoke test'
    );
    result_snapshot := jsonb_build_object(
      'formulaVersion', 'sa-payroll-v1', 'earnedBaseSalaryHalalas', 100000,
      'allowanceLines', '[]'::jsonb, 'recurringDeductionLines', '[]'::jsonb,
      'manualBonusHalalas', 0, 'manualDeductionHalalas', 0, 'totalAllowancesHalalas', 0,
      'employeeInsuranceHalalas', 9750, 'employerInsuranceHalalas', 11750,
      'totalDeductionsHalalas', 19751, 'grossEarningsHalalas', 100000,
      'netPayHalalas', 80249, 'totalEmployerCostHalalas', 111750
    );
    SELECT * INTO june_payslip FROM public.save_payroll_calculation(
      '11111111-1111-4111-8111-111111111111',
      '12121212-1212-4212-8212-121212121212', '2099-06-01',
      '22222222-2222-4222-8222-222222222222',
      '94949494-9494-4494-8494-949494949494',
      '95959595-9595-4595-8595-959595959595',
      0, 'calculate_payslip', input_snapshot, result_snapshot
    );
    IF june_payslip.advance_deduction <> 100.01 OR june_payslip.net_salary <> 802.49
       OR (SELECT status FROM public.advance_installments WHERE id = installment_id) <> 'allocated' THEN
      RAISE EXCEPTION 'Payroll did not allocate the exact advance installment.';
    END IF;

    SELECT * INTO june_run FROM public.transition_payroll_run(
      '11111111-1111-4111-8111-111111111111', june_payslip.payroll_run_id,
      '22222222-2222-4222-8222-222222222222',
      '96969696-9696-4696-8696-969696969696',
      '97979797-9797-4797-8797-979797979797',
      1, 'approved', NULL
    );
    IF june_run.status <> 'approved'
       OR (SELECT status FROM public.advance_installments WHERE id = installment_id) <> 'consumed'
       OR (SELECT status FROM public.advance_requests WHERE id = disbursed.id) <> 'repaying'
       OR (SELECT outstanding_amount FROM public.advance_requests WHERE id = disbursed.id) <> 200
       OR (SELECT amount FROM public.financial_balances WHERE advance_request_id = disbursed.id) <> 200 THEN
      RAISE EXCEPTION 'Payroll approval did not consume the installment and reconcile the advance balance.';
    END IF;

    SELECT * INTO june_journal FROM public.accounting_save_journal(
      '11111111-1111-4111-8111-111111111111', '45454545-4545-4545-8545-454545454545',
      'a8a8a8a8-a8a8-48a8-88a8-a8a8a8a8a8a8', 'a9a9a9a9-a9a9-49a9-89a9-a9a9a9a9a9a9',
      NULL, 0, jsonb_build_object(
        'entryDate', '2099-06-30', 'description', 'June payroll accrual with advance',
        'sourceModule', 'payroll', 'sourceId', june_run.id, 'status', 'posted',
        'lines', jsonb_build_array(
          jsonb_build_object('account_id', salary_expense_id, 'debit', 1000, 'credit', 0),
          jsonb_build_object('account_id', gosi_expense_id, 'debit', 117.50, 'credit', 0),
          jsonb_build_object('account_id', salary_payable_id, 'debit', 0, 'credit', 802.49),
          jsonb_build_object('account_id', gosi_payable_id, 'debit', 0, 'credit', 215),
          jsonb_build_object('account_id', advances_account_id, 'debit', 0, 'credit', 100.01)
        )
      )
    );
    reconciliation := public.accounting_reconciliation_report(
      '11111111-1111-4111-8111-111111111111', NULL, NULL
    );
    IF june_journal.status <> 'posted' OR COALESCE((reconciliation->>'isReconciled')::boolean, false) IS NOT TRUE
       OR (reconciliation->>'issueCount')::integer <> 0 THEN
      RAISE EXCEPTION 'Source-to-ledger reconciliation control reported unexplained variance: %', reconciliation;
    END IF;

    BEGIN
      UPDATE public.employees SET lifecycle_status = 'offboarded'
      WHERE id = '12121212-1212-4212-8212-121212121212';
      RAISE EXCEPTION 'Offboarding with an outstanding advance unexpectedly succeeded.';
    EXCEPTION WHEN check_violation THEN NULL;
    END;

    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
    PERFORM set_config('request.jwt.claim.sub', '99999999-9999-4999-8999-999999999999', true);
    browser_rows := 0;
    BEGIN
      UPDATE public.advance_requests SET requested_amount = 1 WHERE id = submitted.id;
      GET DIAGNOSTICS browser_rows = ROW_COUNT;
    EXCEPTION WHEN insufficient_privilege THEN browser_rows := 0;
    END;
    RESET ROLE;
    IF browser_rows <> 0 OR (SELECT requested_amount FROM public.advance_requests WHERE id = submitted.id) <> 300.01 THEN
      RAISE EXCEPTION 'Direct browser advance mutation was not denied.';
    END IF;
  END
  $test$;

  SET request.jwt.claim.role = 'service_role';

  INSERT INTO public.business_events (
    id, org_id, source_type, business_key, payload_hash
  ) VALUES (
    '44444444-4444-4444-8444-444444444444',
    '11111111-1111-4111-8111-111111111111',
    'migration.test',
    'event-one',
    repeat('a', 64)
  );
  INSERT INTO public.event_outbox (
    org_id, business_event_id, topic, payload_hash
  ) VALUES (
    '11111111-1111-4111-8111-111111111111',
    '44444444-4444-4444-8444-444444444444',
    'migration.test.created',
    repeat('b', 64)
  );

  DO $test$
  DECLARE
    claimed_event public.business_events;
    claimed_outbox public.event_outbox;
    lms_ready boolean;
  BEGIN
    SELECT * INTO claimed_event FROM public.claim_business_event(
      '44444444-4444-4444-8444-444444444444',
      '11111111-1111-4111-8111-111111111111'
    );
    SELECT * INTO claimed_outbox FROM public.claim_event_outbox('migration-test-worker', 1);
    SELECT f.lms_enabled AND f.enabled_modules @> '["lms"]'::jsonb
      AND s.status = 'trialing' AND s.trial_end IS NOT NULL
    INTO lms_ready
    FROM public.organization_features f
    JOIN public.organization_subscriptions s USING (org_id)
    WHERE f.org_id = '11111111-1111-4111-8111-111111111111';
    IF claimed_event.status <> 'processing' OR claimed_event.attempts <> 1 THEN
      RAISE EXCEPTION 'Business event claim is not atomic.';
    END IF;
    IF claimed_outbox.status <> 'processing' OR claimed_outbox.locked_by <> 'migration-test-worker' THEN
      RAISE EXCEPTION 'Outbox claim is not atomic.';
    END IF;
    IF NOT lms_ready THEN
      RAISE EXCEPTION 'Tenant defaults are incomplete.';
    END IF;
  END
  $test$;

  INSERT INTO auth.users (id, email) VALUES
    ('77777777-7777-4777-8777-777777777777', 'candidate-integrity@example.test');
  INSERT INTO public.job_postings (id, org_id, title, status, created_by, form_schema)
  VALUES ('78787878-7878-4878-8878-787878787878', '11111111-1111-4111-8111-111111111111',
    'Integrity Engineer', 'open', '22222222-2222-4222-8222-222222222222',
    '[{"id":"experience","type":"text","label":"Experience","required":false,"order":1},
      {"id":"portfolio","type":"file","label":"Portfolio","required":false,"order":2}]'::jsonb);
  DO $test$
  DECLARE submitted public.job_applications; replayed public.job_applications;
    duplicate_denied boolean := false; invalid_answers_denied boolean := false; browser_rows integer := 0;
  BEGIN
    SELECT * INTO submitted FROM public.submit_public_application(
      '78787878-7878-4878-8878-787878787878', '7a7a7a7a-7a7a-4a7a-8a7a-7a7a7a7a7a7a',
      '7b7b7b7b-7b7b-4b7b-8b7b-7b7b7b7b7b7b', '7c7c7c7c-7c7c-4c7c-8c7c-7c7c7c7c7c7c',
      NULL, 'Public Candidate', 'PUBLIC-CANDIDATE@example.test', '+201000000000',
      '{"experience":"5 years","portfolio":{
        "path":"11111111-1111-4111-8111-111111111111/application-files/78787878-7878-4878-8878-787878787878/7a7a7a7a-7a7a-4a7a-8a7a-7a7a7a7a7a7a/portfolio/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb-portfolio.pdf",
        "filename":"portfolio.pdf","mime":"application/pdf","size_bytes":12,
        "sha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        "scan_status":"clean","scan_engine":"test","scanned_at":"2099-01-01T00:00:00Z"}}'::jsonb,
      '{"path":"11111111-1111-4111-8111-111111111111/cv/78787878-7878-4878-8878-787878787878/7a7a7a7a-7a7a-4a7a-8a7a-7a7a7a7a7a7a/7b7b7b7b-7b7b-4b7b-8b7b-7b7b7b7b7b7b/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-cv.pdf",
        "filename":"cv.pdf","mime":"application/pdf","size_bytes":12,
        "sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "scan_status":"clean","scan_engine":"test","scanned_at":"2099-01-01T00:00:00Z"}'::jsonb);
    SELECT * INTO replayed FROM public.submit_public_application(
      '78787878-7878-4878-8878-787878787878', '7a7a7a7a-7a7a-4a7a-8a7a-7a7a7a7a7a7a',
      '7b7b7b7b-7b7b-4b7b-8b7b-7b7b7b7b7b7b', '7c7c7c7c-7c7c-4c7c-8c7c-7c7c7c7c7c7c',
      NULL, 'Public Candidate', 'PUBLIC-CANDIDATE@example.test', '+201000000000',
      '{"experience":"5 years","portfolio":{
        "path":"11111111-1111-4111-8111-111111111111/application-files/78787878-7878-4878-8878-787878787878/7a7a7a7a-7a7a-4a7a-8a7a-7a7a7a7a7a7a/portfolio/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb-portfolio.pdf",
        "filename":"portfolio.pdf","mime":"application/pdf","size_bytes":12,
        "sha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        "scan_status":"clean","scan_engine":"test","scanned_at":"2099-01-01T00:00:00Z"}}'::jsonb,
      '{"path":"11111111-1111-4111-8111-111111111111/cv/78787878-7878-4878-8878-787878787878/7a7a7a7a-7a7a-4a7a-8a7a-7a7a7a7a7a7a/7b7b7b7b-7b7b-4b7b-8b7b-7b7b7b7b7b7b/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-cv.pdf",
        "filename":"cv.pdf","mime":"application/pdf","size_bytes":12,
        "sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "scan_status":"clean","scan_engine":"test","scanned_at":"2099-01-01T00:00:00Z"}'::jsonb);
    BEGIN
      PERFORM * FROM public.submit_public_application(
        '78787878-7878-4878-8878-787878787878', '7a7a7a7a-1111-4a7a-8a7a-7a7a7a7a7a7a',
        '7b7b7b7b-1111-4b7b-8b7b-7b7b7b7b7b7b', '7c7c7c7c-1111-4c7c-8c7c-7c7c7c7c7c7c',
        NULL, 'Invalid Answers', 'invalid-answers@example.test', NULL,
        '{"unknown":"not declared"}'::jsonb, NULL);
    EXCEPTION WHEN SQLSTATE '22023' THEN invalid_answers_denied := true;
    END;
    BEGIN
      PERFORM * FROM public.submit_public_application(
        '78787878-7878-4878-8878-787878787878', '7d7d7d7d-7d7d-4d7d-8d7d-7d7d7d7d7d7d',
        '7e7e7e7e-7e7e-4e7e-8e7e-7e7e7e7e7e7e', '7f7f7f7f-7f7f-4f7f-8f7f-7f7f7f7f7f7f',
        NULL, 'Duplicate Candidate', 'public-candidate@example.test', NULL, '{}'::jsonb, NULL);
    EXCEPTION WHEN unique_violation THEN duplicate_denied := true;
    END;
    IF submitted.id IS DISTINCT FROM replayed.id OR submitted.email <> 'public-candidate@example.test'
       OR NOT duplicate_denied OR NOT invalid_answers_denied
       OR (SELECT count(*) FROM public.job_applications WHERE id = submitted.id) <> 1
       OR (SELECT count(*) FROM public.recruitment_application_files
         WHERE application_id = submitted.id AND question_id = 'portfolio') <> 1
       OR (SELECT count(*) FROM public.managed_files
         WHERE owner_type = 'candidate_application_cv' AND owner_id = submitted.id
           AND bucket_id = 'recruitment' AND retention_until IS NULL) <> 1
       OR (SELECT count(*) FROM public.managed_files file
         JOIN public.recruitment_application_files attachment ON attachment.managed_file_id = file.id
         WHERE attachment.application_id = submitted.id
           AND file.owner_type = 'candidate_application_attachment'
           AND file.bucket_id = 'recruitment' AND file.retention_until IS NULL) <> 1
       OR (SELECT count(*) FROM public.event_outbox WHERE topic = 'recruitment.application_submitted'
         AND payload->>'application_id' = submitted.id::text) <> 1
       OR (SELECT count(*) FROM public.operational_audit_logs
         WHERE action = 'recruitment.application_submitted' AND target_id = submitted.id::text) <> 1 THEN
      RAISE EXCEPTION 'Public candidate submission was not atomic, normalized, unique, and replay-safe.';
    END IF;
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
    PERFORM set_config('request.jwt.claim.sub', '77777777-7777-4777-8777-777777777777', true);
    BEGIN
      INSERT INTO public.job_applications (org_id, job_posting_id, candidate_name, email)
      VALUES ('11111111-1111-4111-8111-111111111111', '78787878-7878-4878-8878-787878787878',
        'Forbidden browser candidate', 'forbidden@example.test');
      GET DIAGNOSTICS browser_rows = ROW_COUNT;
    EXCEPTION WHEN insufficient_privilege THEN browser_rows := 0;
    END;
    RESET ROLE;
    IF browser_rows <> 0 THEN RAISE EXCEPTION 'Direct browser application creation was not denied.'; END IF;
  END
  $test$;
  INSERT INTO public.job_applications (id, org_id, job_posting_id, candidate_id, candidate_user_id,
    candidate_name, email, status, stage_history)
  VALUES ('79797979-7979-4979-8979-797979797979', '11111111-1111-4111-8111-111111111111',
    '78787878-7878-4878-8878-787878787878', '77777777-7777-4777-8777-777777777777',
    '77777777-7777-4777-8777-777777777777', 'Candidate Integrity', 'candidate-integrity@example.test',
    'shortlisted', '[{"stage":"shortlisted"}]'::jsonb);

  DO $test$
  DECLARE application_row public.job_applications; employee_row public.employees;
  BEGIN
    SELECT * INTO application_row FROM public.transition_recruitment_application(
      '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
      '80808080-8080-4080-8080-808080808080', '81818181-8181-4181-8181-818181818181',
      '79797979-7979-4979-8979-797979797979', 1, 'offer', 'Validated offer'
    );
    IF application_row.status <> 'offer' OR application_row.offer_status <> 'pending' OR application_row.version <> 2 THEN
      RAISE EXCEPTION 'Recruitment offer transition did not preserve workflow controls.';
    END IF;
    BEGIN
      UPDATE public.job_applications SET status = 'hired' WHERE id = application_row.id;
      RAISE EXCEPTION 'Candidate was hired before accepting the offer.';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
    SELECT * INTO application_row FROM public.respond_to_recruitment_offer(
      '77777777-7777-4777-8777-777777777777', '82828282-8282-4282-8282-828282828282',
      '83838383-8383-4383-8383-838383838383', application_row.id, 'accepted'
    );
    SELECT * INTO employee_row FROM public.begin_employee_onboarding(
      '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
      '84848484-8484-4484-8484-848484848484',
      jsonb_build_object('full_name', 'Candidate Integrity', 'email', 'candidate-integrity@example.test',
        'job_title', 'Integrity Engineer', 'hiring_date', '2099-07-01', 'employment_type', 'full_time'),
      'recruitment', application_row.id
    );
    IF employee_row.lifecycle_status <> 'onboarding'
       OR (SELECT status FROM public.job_applications WHERE id = application_row.id) <> 'hired'
       OR (SELECT count(*) FROM public.event_outbox WHERE topic = 'recruitment.candidate_hired'
         AND payload->>'application_id' = application_row.id::text) <> 1 THEN
      RAISE EXCEPTION 'Accepted recruitment offer did not atomically enter employee onboarding.';
    END IF;
  END
  $test$;

  INSERT INTO auth.users(id,email) VALUES(
    'ac500000-0000-4000-8000-000000000001','identity-reconciliation@example.test'
  );
  UPDATE public.profiles SET org_id='11111111-1111-4111-8111-111111111111',
    full_name='Identity Reconciliation Proof',account_status='Active'
  WHERE user_id='ac500000-0000-4000-8000-000000000001';
  INSERT INTO public.org_members(org_id,user_id,role) VALUES(
    '11111111-1111-4111-8111-111111111111','ac500000-0000-4000-8000-000000000001','employee'
  );
  CREATE FUNCTION pg_temp.reject_identity_auth_outbox()
  RETURNS trigger LANGUAGE plpgsql AS $failure$
  BEGIN
    IF NEW.topic='identity.auth_sync_requested' THEN
      RAISE EXCEPTION 'Injected identity Auth outbox failure';
    END IF;
    RETURN NEW;
  END
  $failure$;
  CREATE TRIGGER reject_identity_auth_outbox
    BEFORE INSERT ON public.event_outbox
    FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_identity_auth_outbox();
  DO $test$
  BEGIN
    BEGIN
      UPDATE public.profiles SET account_status='Suspended'
      WHERE user_id='ac500000-0000-4000-8000-000000000001';
      RAISE EXCEPTION 'Profile status survived an injected identity outbox failure.';
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM<>'Injected identity Auth outbox failure' THEN RAISE; END IF;
    END;
    IF (SELECT account_status FROM public.profiles
        WHERE user_id='ac500000-0000-4000-8000-000000000001')<>'Active'
       OR EXISTS(SELECT 1 FROM public.identity_auth_sync_jobs
         WHERE target_user_id='ac500000-0000-4000-8000-000000000001') THEN
      RAISE EXCEPTION 'Profile status and Auth sync job did not roll back together.';
    END IF;
  END
  $test$;
  DROP TRIGGER reject_identity_auth_outbox ON public.event_outbox;

  DO $test$
  DECLARE safety_job jsonb; safety_replay jsonb; retry_job jsonb; started jsonb; restarted jsonb;
    browser_function_denied boolean:=false; browser_insert_denied boolean:=false;
  BEGIN
    UPDATE public.profiles SET account_status='Suspended'
    WHERE user_id='ac500000-0000-4000-8000-000000000001';
    UPDATE public.profiles SET account_status='Suspended'
    WHERE user_id='ac500000-0000-4000-8000-000000000001';
    UPDATE public.profiles SET account_status='Active'
    WHERE user_id='ac500000-0000-4000-8000-000000000001';
    safety_job:=public.enqueue_identity_auth_sync_job(
      '11111111-1111-4111-8111-111111111111','ac500000-0000-4000-8000-000000000001',
      'delete','provisioning_safety','ac500000-0000-4000-8000-000000000002',
      'Delayed cleanup proof','22222222-2222-4222-8222-222222222222',
      'ac500000-0000-4000-8000-000000000003',600);
    safety_replay:=public.enqueue_identity_auth_sync_job(
      '11111111-1111-4111-8111-111111111111','ac500000-0000-4000-8000-000000000001',
      'delete','provisioning_safety','ac500000-0000-4000-8000-000000000002',
      'Delayed cleanup proof','22222222-2222-4222-8222-222222222222',
      'ac500000-0000-4000-8000-000000000003',600);
    PERFORM public.cancel_identity_auth_sync_job((safety_job->>'id')::uuid,'Provisioning completed');
    retry_job:=public.enqueue_identity_auth_sync_job(
      '11111111-1111-4111-8111-111111111111','ac500000-0000-4000-8000-000000000001',
      'delete','failed_provisioning_cleanup','ac500000-0000-4000-8000-000000000004',
      'Retry proof','22222222-2222-4222-8222-222222222222',
      'ac500000-0000-4000-8000-000000000005',0);
    started:=public.start_identity_auth_sync_job((retry_job->>'id')::uuid);
    PERFORM public.fail_identity_auth_sync_job((retry_job->>'id')::uuid,'Injected provider outage');
    restarted:=public.start_identity_auth_sync_job((retry_job->>'id')::uuid);
    PERFORM public.complete_identity_auth_sync_job((retry_job->>'id')::uuid,'{"deleted":true}'::jsonb);
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claim.role','authenticated',true);
    PERFORM set_config('request.jwt.claim.sub','ac500000-0000-4000-8000-000000000001',true);
    BEGIN
      PERFORM public.enqueue_identity_auth_sync_job(
        '11111111-1111-4111-8111-111111111111','ac500000-0000-4000-8000-000000000001',
        'ban','browser','forbidden','Forbidden',NULL,NULL,0);
    EXCEPTION WHEN insufficient_privilege THEN browser_function_denied:=true;
    END;
    BEGIN
      INSERT INTO public.identity_auth_sync_jobs(
        org_id,target_user_id,action,source_type,source_id
      ) VALUES(
        '11111111-1111-4111-8111-111111111111','ac500000-0000-4000-8000-000000000001',
        'ban','browser','forbidden-direct'
      );
    EXCEPTION WHEN insufficient_privilege THEN browser_insert_denied:=true;
    END;
    RESET ROLE;
    IF safety_job->>'id' IS DISTINCT FROM safety_replay->>'id'
       OR (started->>'attempts')::integer<>1 OR (restarted->>'attempts')::integer<>2
       OR NOT browser_function_denied OR NOT browser_insert_denied
       OR (SELECT count(*) FROM public.identity_auth_sync_jobs
         WHERE target_user_id='ac500000-0000-4000-8000-000000000001'
           AND source_type='profile_account_status')<>2
       OR (SELECT count(*) FROM public.event_outbox
         WHERE topic='identity.auth_sync_requested'
           AND payload->>'target_user_id'='ac500000-0000-4000-8000-000000000001'
           AND payload->>'source_type'='profile_account_status')<>2
       OR (SELECT status FROM public.identity_auth_sync_jobs WHERE id=(safety_job->>'id')::uuid)<>'cancelled'
       OR (SELECT status FROM public.event_outbox WHERE topic='identity.auth_sync_requested'
         AND payload->>'job_id'=safety_job->>'id')<>'completed'
       OR (SELECT status FROM public.identity_auth_sync_jobs WHERE id=(retry_job->>'id')::uuid)<>'completed'
       OR (SELECT attempts FROM public.identity_auth_sync_jobs WHERE id=(retry_job->>'id')::uuid)<>2 THEN
      RAISE EXCEPTION 'Identity Auth reconciliation was not atomic, idempotent, retryable, cancellable, and service-only.';
    END IF;
  END
  $test$;

  CREATE FUNCTION pg_temp.reject_missing_location_outbox()
  RETURNS trigger LANGUAGE plpgsql AS $failure$
  BEGIN
    IF NEW.topic='attendance.location_missing' THEN
      RAISE EXCEPTION 'Injected missing-location outbox failure';
    END IF;
    RETURN NEW;
  END
  $failure$;
  CREATE TRIGGER reject_missing_location_outbox
    BEFORE INSERT ON public.event_outbox
    FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_missing_location_outbox();
  DO $test$
  BEGIN
    BEGIN
      PERFORM public.raise_missing_attendance_location_alert(
        '11111111-1111-4111-8111-111111111111','99999999-9999-4999-8999-999999999999',
        'ac300000-0000-4000-8000-000000000001','check_in');
      RAISE EXCEPTION 'Missing-location alert survived an injected outbox failure.';
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM <> 'Injected missing-location outbox failure' THEN RAISE; END IF;
    END;
    IF EXISTS(
      SELECT 1 FROM public.business_events
      WHERE org_id='11111111-1111-4111-8111-111111111111'
        AND source_type='attendance_alert'
        AND business_key LIKE 'missing-location:12121212-1212-4212-8212-121212121212:%'
    ) THEN
      RAISE EXCEPTION 'Missing-location business event did not roll back with its outbox.';
    END IF;
  END
  $test$;
  DROP TRIGGER reject_missing_location_outbox ON public.event_outbox;

  DO $test$
  DECLARE first_result jsonb; replay_result jsonb; located_result jsonb;
    cross_tenant_denied boolean:=false; browser_denied boolean:=false;
  BEGIN
    first_result:=public.raise_missing_attendance_location_alert(
      '11111111-1111-4111-8111-111111111111','99999999-9999-4999-8999-999999999999',
      'ac300000-0000-4000-8000-000000000002','check_in');
    replay_result:=public.raise_missing_attendance_location_alert(
      '11111111-1111-4111-8111-111111111111','99999999-9999-4999-8999-999999999999',
      'ac300000-0000-4000-8000-000000000003','check_out');
    located_result:=public.raise_missing_attendance_location_alert(
      '11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',
      'ac300000-0000-4000-8000-000000000004','check_in');
    BEGIN
      PERFORM public.raise_missing_attendance_location_alert(
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','99999999-9999-4999-8999-999999999999',
        'ac300000-0000-4000-8000-000000000005','check_in');
    EXCEPTION WHEN insufficient_privilege THEN cross_tenant_denied:=true;
    END;
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claim.role','authenticated',true);
    PERFORM set_config('request.jwt.claim.sub','99999999-9999-4999-8999-999999999999',true);
    BEGIN
      PERFORM public.raise_missing_attendance_location_alert(
        '11111111-1111-4111-8111-111111111111','99999999-9999-4999-8999-999999999999',
        'ac300000-0000-4000-8000-000000000006','check_in');
    EXCEPTION WHEN insufficient_privilege THEN browser_denied:=true;
    END;
    RESET ROLE;
    IF COALESCE((first_result->>'notified')::boolean,false) IS NOT TRUE
       OR COALESCE((first_result->>'hasLocation')::boolean,true) IS NOT FALSE
       OR COALESCE((replay_result->>'notified')::boolean,true) IS NOT FALSE
       OR COALESCE((located_result->>'hasLocation')::boolean,false) IS NOT TRUE
       OR NOT cross_tenant_denied OR NOT browser_denied
       OR (SELECT count(*) FROM public.business_events
         WHERE org_id='11111111-1111-4111-8111-111111111111'
           AND source_type='attendance_alert'
           AND business_key LIKE 'missing-location:12121212-1212-4212-8212-121212121212:%')<>1
       OR (SELECT count(*) FROM public.event_outbox
         WHERE topic='attendance.location_missing'
           AND payload->>'employee_id'='12121212-1212-4212-8212-121212121212')<>1
       OR (SELECT count(*) FROM public.operational_audit_logs
         WHERE action='attendance.location_missing'
           AND target_id='12121212-1212-4212-8212-121212121212')<>1 THEN
      RAISE EXCEPTION 'Missing-attendance-location alert was not atomic, daily-idempotent, scoped, and audited.';
    END IF;
  END
  $test$;

  INSERT INTO public.lms_courses (id, org_id, title, status, requires_quiz_pass, created_by)
  VALUES
    ('70707070-7070-4070-8070-707070707070', '11111111-1111-4111-8111-111111111111', 'Integrity Course', 'published', true, '22222222-2222-4222-8222-222222222222'),
    ('72727272-7272-4272-8272-727272727272', '11111111-1111-4111-8111-111111111111', 'Other Course', 'published', false, '22222222-2222-4222-8222-222222222222');
  INSERT INTO public.lms_lessons (id, org_id, course_id, title, is_required, created_by) VALUES
    ('69696969-6969-4969-8969-696969696969', '11111111-1111-4111-8111-111111111111', '70707070-7070-4070-8070-707070707070', 'Required lesson', true, '22222222-2222-4222-8222-222222222222'),
    ('68686868-6868-4868-8868-686868686868', '11111111-1111-4111-8111-111111111111', '72727272-7272-4272-8272-727272727272', 'Foreign lesson', true, '22222222-2222-4222-8222-222222222222');
  INSERT INTO public.lms_quizzes (id, org_id, course_id, title, max_attempts, is_required, created_by)
  VALUES ('73737373-7373-4373-8373-737373737373', '11111111-1111-4111-8111-111111111111',
    '70707070-7070-4070-8070-707070707070', 'One attempt', 1, false, '22222222-2222-4222-8222-222222222222');
  INSERT INTO public.lms_quiz_questions (id, org_id, quiz_id, question_text, question_type, correct_answer_json, points)
  VALUES ('74747474-7474-4474-8474-747474747474', '11111111-1111-4111-8111-111111111111',
    '73737373-7373-4373-8373-737373737373', 'Answer yes', 'short_answer', '"yes"'::jsonb, 1);
  INSERT INTO public.lms_enrollments (id, org_id, course_id, employee_id, assigned_by)
  VALUES ('71717171-7171-4171-8171-717171717171', '11111111-1111-4111-8111-111111111111',
    '70707070-7070-4070-8070-707070707070', '12121212-1212-4212-8212-121212121212', '22222222-2222-4222-8222-222222222222');
  DO $test$
  BEGIN
    BEGIN
      PERFORM public.complete_lms_lesson('11111111-1111-4111-8111-111111111111',
        '99999999-9999-4999-8999-999999999999', '67676767-6767-4767-8767-676767676767',
        '71717171-7171-4171-8171-717171717171', '68686868-6868-4868-8868-686868686868');
      RAISE EXCEPTION 'Learner completed a lesson belonging to another course.';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
    PERFORM public.complete_lms_lesson('11111111-1111-4111-8111-111111111111',
      '99999999-9999-4999-8999-999999999999', '66666666-6666-4666-8666-666666666666',
      '71717171-7171-4171-8171-717171717171', '69696969-6969-4969-8969-696969696969');
    IF (SELECT progress_percent FROM public.lms_enrollments WHERE id = '71717171-7171-4171-8171-717171717171') <> 100
       OR (SELECT count(*) FROM public.lms_certificates WHERE enrollment_id = '71717171-7171-4171-8171-717171717171') <> 1
       OR (SELECT count(*) FROM public.event_outbox WHERE topic = 'lms.enrollment_completed'
         AND payload->>'enrollment_id' = '71717171-7171-4171-8171-717171717171') <> 1 THEN
      RAISE EXCEPTION 'Atomic LMS completion did not issue exactly one certificate and event.';
    END IF;
  END
  $test$;

  INSERT INTO public.lms_tasks(id,org_id,course_id,title,max_score,pass_score,is_required,status,created_by)
  VALUES('ac100000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111',
    '70707070-7070-4070-8070-707070707070','Atomic LMS review task',100,70,true,'published',
    '22222222-2222-4222-8222-222222222222');
  INSERT INTO public.lms_task_submissions(id,org_id,task_id,course_id,enrollment_id,employee_id,submission_text,status,submitted_at)
  VALUES('ac100000-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111',
    'ac100000-0000-4000-8000-000000000001','70707070-7070-4070-8070-707070707070',
    '71717171-7171-4171-8171-717171717171','12121212-1212-4212-8212-121212121212',
    'Atomic LMS submission','submitted',now());
  DO $test$
  DECLARE assigned jsonb; assigned_replay jsonb; rubric jsonb; rubric_replay jsonb; revised_rubric jsonb;
    reviewed jsonb; reviewed_replay jsonb; rubric_item_id uuid; conflict_denied boolean:=false;
  BEGIN
    assigned:=public.assign_lms_learning_atomic(
      '11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',
      'ac100000-0000-4000-8000-000000000003','ac100000-0000-4000-8000-000000000004',
      '72727272-7272-4272-8272-727272727272',NULL,'employee','12121212-1212-4212-8212-121212121212',
      '2105-12-31',ARRAY['72727272-7272-4272-8272-727272727272'::uuid],
      ARRAY['12121212-1212-4212-8212-121212121212'::uuid]);
    assigned_replay:=public.assign_lms_learning_atomic(
      '11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',
      'ac100000-0000-4000-8000-000000000003','ac100000-0000-4000-8000-000000000004',
      '72727272-7272-4272-8272-727272727272',NULL,'employee','12121212-1212-4212-8212-121212121212',
      '2105-12-31',ARRAY['72727272-7272-4272-8272-727272727272'::uuid],
      ARRAY['12121212-1212-4212-8212-121212121212'::uuid]);
    rubric:=public.save_lms_project_rubric_atomic(
      '11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',
      'ac100000-0000-4000-8000-000000000005','ac100000-0000-4000-8000-000000000006',
      'ac100000-0000-4000-8000-000000000001',
      '{"title":"Atomic rubric","pass_points":70,"items":[{"title":"Quality","points":100,"sort_order":0}]}'::jsonb);
    rubric_replay:=public.save_lms_project_rubric_atomic(
      '11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',
      'ac100000-0000-4000-8000-000000000005','ac100000-0000-4000-8000-000000000006',
      'ac100000-0000-4000-8000-000000000001',
      '{"title":"Atomic rubric","pass_points":70,"items":[{"title":"Quality","points":100,"sort_order":0}]}'::jsonb);
    rubric_item_id:=(rubric->'items'->0->>'id')::uuid;
    reviewed:=public.review_lms_submission_atomic(
      '11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',
      'ac100000-0000-4000-8000-000000000007','ac100000-0000-4000-8000-000000000008',
      'ac100000-0000-4000-8000-000000000002',80,'Atomic review','accepted',
      jsonb_build_array(jsonb_build_object('rubric_item_id',rubric_item_id,'score',80,'passed',true,'feedback','Good')));
    reviewed_replay:=public.review_lms_submission_atomic(
      '11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',
      'ac100000-0000-4000-8000-000000000007','ac100000-0000-4000-8000-000000000008',
      'ac100000-0000-4000-8000-000000000002',80,'Atomic review','accepted',
      jsonb_build_array(jsonb_build_object('rubric_item_id',rubric_item_id,'score',80,'passed',true,'feedback','Good')));
    revised_rubric:=public.save_lms_project_rubric_atomic(
      '11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',
      'ac100000-0000-4000-8000-000000000010','ac100000-0000-4000-8000-000000000011',
      'ac100000-0000-4000-8000-000000000001',
      '{"title":"Revised atomic rubric","pass_points":70,"items":[{"title":"Replacement quality","points":100,"sort_order":0}]}'::jsonb);
    BEGIN
      PERFORM public.review_lms_submission_atomic(
        '11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',
        'ac100000-0000-4000-8000-000000000009','ac100000-0000-4000-8000-000000000008',
        'ac100000-0000-4000-8000-000000000002',70,'Changed retry','accepted','[]'::jsonb);
    EXCEPTION WHEN unique_violation THEN conflict_denied:=true;
    END;
    IF assigned IS DISTINCT FROM assigned_replay OR rubric IS DISTINCT FROM rubric_replay
       OR reviewed IS DISTINCT FROM reviewed_replay OR NOT conflict_denied OR rubric_item_id IS NULL
       OR jsonb_array_length(assigned->'enrollments')<>1
       OR (SELECT count(*) FROM public.lms_assignment_rules WHERE id=(assigned->'rule'->>'id')::uuid)<>1
       OR (SELECT count(*) FROM public.lms_task_reviews WHERE submission_id='ac100000-0000-4000-8000-000000000002')<>1
       OR (SELECT count(*) FROM public.lms_project_review_items WHERE submission_id='ac100000-0000-4000-8000-000000000002')<>1
       OR (SELECT is_active FROM public.lms_project_rubric_items WHERE id=rubric_item_id) IS NOT FALSE
       OR jsonb_array_length(revised_rubric->'items')<>1
       OR (SELECT status FROM public.lms_task_submissions WHERE id='ac100000-0000-4000-8000-000000000002')<>'accepted'
       OR (SELECT count(*) FROM public.event_outbox WHERE topic='lms.learning_assigned'
         AND payload->>'rule_id'=assigned->'rule'->>'id')<>1
       OR (SELECT count(*) FROM public.event_outbox WHERE topic='lms.submission_reviewed'
         AND payload->>'submission_id'='ac100000-0000-4000-8000-000000000002')<>1 THEN
      RAISE EXCEPTION 'LMS assignment, rubric, or review workflow was not atomic and replay-safe.';
    END IF;
  END
  $test$;

  INSERT INTO public.lms_course_announcements(
    id,org_id,course_id,title,body,created_by
  ) VALUES(
    'ac200000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111',
    '70707070-7070-4070-8070-707070707070','Durable LMS announcement','Initial announcement',
    '22222222-2222-4222-8222-222222222222'
  );
  UPDATE public.lms_course_announcements
  SET title='Updated durable LMS announcement'
  WHERE id='ac200000-0000-4000-8000-000000000001';
  INSERT INTO public.lms_community_posts(
    id,org_id,course_id,employee_id,title,body
  ) VALUES(
    'ac200000-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111',
    '70707070-7070-4070-8070-707070707070','33333333-3333-4333-8333-333333333333',
    'Durable community post','Community question'
  );
  INSERT INTO public.lms_community_comments(
    id,org_id,post_id,course_id,employee_id,body
  ) VALUES(
    'ac200000-0000-4000-8000-000000000003','11111111-1111-4111-8111-111111111111',
    'ac200000-0000-4000-8000-000000000002','70707070-7070-4070-8070-707070707070',
    '12121212-1212-4212-8212-121212121212','Durable reply'
  );
  DO $test$
  BEGIN
    IF (SELECT version FROM public.lms_course_announcements
        WHERE id='ac200000-0000-4000-8000-000000000001')<>2
       OR (SELECT count(*) FROM public.event_outbox WHERE topic='lms.announcement_published'
         AND payload->>'announcement_id'='ac200000-0000-4000-8000-000000000001')<>2
       OR (SELECT count(*) FROM public.event_outbox WHERE topic='lms.community_replied'
         AND payload->>'comment_id'='ac200000-0000-4000-8000-000000000003')<>1 THEN
      RAISE EXCEPTION 'LMS announcement/reply events were not durable and transition-scoped.';
    END IF;
  END
  $test$;

  CREATE FUNCTION pg_temp.reject_lms_community_event()
  RETURNS trigger LANGUAGE plpgsql AS $failure$
  BEGIN
    IF NEW.source_type='lms_community' THEN
      RAISE EXCEPTION 'Injected LMS event failure';
    END IF;
    RETURN NEW;
  END
  $failure$;
  CREATE TRIGGER reject_lms_community_event
    BEFORE INSERT ON public.business_events
    FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_lms_community_event();
  DO $test$
  BEGIN
    BEGIN
      INSERT INTO public.lms_community_comments(
        id,org_id,post_id,course_id,employee_id,body
      ) VALUES(
        'ac200000-0000-4000-8000-000000000004','11111111-1111-4111-8111-111111111111',
        'ac200000-0000-4000-8000-000000000002','70707070-7070-4070-8070-707070707070',
        '12121212-1212-4212-8212-121212121212','Must roll back'
      );
      RAISE EXCEPTION 'LMS reply survived an injected outbox failure.';
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM <> 'Injected LMS event failure' THEN RAISE; END IF;
    END;
    IF EXISTS(SELECT 1 FROM public.lms_community_comments
      WHERE id='ac200000-0000-4000-8000-000000000004') THEN
      RAISE EXCEPTION 'LMS reply source row did not roll back with its event.';
    END IF;
  END
  $test$;
  DROP TRIGGER reject_lms_community_event ON public.business_events;

  DO $test$
  DECLARE sent jsonb; replayed jsonb; inbox jsonb; first_page public.chat_messages; page_count integer; browser_rows integer := 0;
  BEGIN
    sent := public.send_chat_message('11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222', '65656565-6565-4565-8565-656565656565',
      '64646464-6464-4464-8464-646464646464', '63636363-6363-4363-8363-636363636363',
      'direct', NULL, ARRAY['99999999-9999-4999-8999-999999999999']::uuid[], 'Hello securely', '[]'::jsonb);
    replayed := public.send_chat_message('11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222', '65656565-6565-4565-8565-656565656565',
      '64646464-6464-4464-8464-646464646464', '63636363-6363-4363-8363-636363636363',
      'direct', NULL, ARRAY['99999999-9999-4999-8999-999999999999']::uuid[], 'Hello securely', '[]'::jsonb);
    IF sent->'message'->>'id' IS DISTINCT FROM replayed->'message'->>'id'
       OR (SELECT count(*) FROM public.chat_messages WHERE conversation_id = '63636363-6363-4363-8363-636363636363') <> 1
       OR (SELECT public FROM storage.buckets WHERE id = 'chat-attachments') IS NOT FALSE THEN
      RAISE EXCEPTION 'Atomic/idempotent private chat creation failed.';
    END IF;
    INSERT INTO public.chat_messages (conversation_id, org_id, sender_user_id, sender_employee_id, body)
    SELECT '63636363-6363-4363-8363-636363636363', '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333', 'Page message ' || value
    FROM generate_series(1, 120) value;
    SELECT count(*) INTO page_count FROM public.chat_message_page(
      '11111111-1111-4111-8111-111111111111', '99999999-9999-4999-8999-999999999999',
      '63636363-6363-4363-8363-636363636363', NULL, NULL, 50);
    SELECT * INTO first_page FROM public.chat_message_page(
      '11111111-1111-4111-8111-111111111111', '99999999-9999-4999-8999-999999999999',
      '63636363-6363-4363-8363-636363636363', NULL, NULL, 50) LIMIT 1;
    IF page_count <> 50 OR first_page.id IS NULL THEN RAISE EXCEPTION 'Chat message cursor page was not bounded.'; END IF;
    inbox := public.chat_inbox_snapshot('11111111-1111-4111-8111-111111111111',
      '99999999-9999-4999-8999-999999999999', 100);
    IF (inbox->0->>'unread_count')::integer <> 121 THEN RAISE EXCEPTION 'Chat unread count was not exact: %', inbox; END IF;
    PERFORM public.mark_chat_conversation_read('11111111-1111-4111-8111-111111111111',
      '99999999-9999-4999-8999-999999999999', '63636363-6363-4363-8363-636363636363');
    inbox := public.chat_inbox_snapshot('11111111-1111-4111-8111-111111111111',
      '99999999-9999-4999-8999-999999999999', 100);
    IF (inbox->0->>'unread_count')::integer <> 0 THEN RAISE EXCEPTION 'Chat read marker did not clear unread state.'; END IF;
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
    PERFORM set_config('request.jwt.claim.sub', '99999999-9999-4999-8999-999999999999', true);
    BEGIN
      INSERT INTO public.chat_messages (conversation_id, org_id, sender_user_id, body)
      VALUES ('63636363-6363-4363-8363-636363636363', '11111111-1111-4111-8111-111111111111',
        '99999999-9999-4999-8999-999999999999', 'forbidden');
      GET DIAGNOSTICS browser_rows = ROW_COUNT;
    EXCEPTION WHEN insufficient_privilege THEN browser_rows := 0;
    END;
    RESET ROLE;
    IF browser_rows <> 0 THEN RAISE EXCEPTION 'Direct browser chat mutation was not denied.'; END IF;
  END
  $test$;

  SET request.jwt.claim.role = 'service_role';
  INSERT INTO public.tasks (id, org_id, title, status, created_by)
  VALUES ('9a9a9a9a-9a9a-4a9a-8a9a-9a9a9a9a9a9a', '11111111-1111-4111-8111-111111111111',
    'Task integrity proof', 'pending', '22222222-2222-4222-8222-222222222222');
  INSERT INTO public.task_assignments (id, org_id, task_id, employee_id, status)
  VALUES ('9b9b9b9b-9b9b-4b9b-8b9b-9b9b9b9b9b9b', '11111111-1111-4111-8111-111111111111',
    '9a9a9a9a-9a9a-4a9a-8a9a-9a9a9a9a9a9a', '12121212-1212-4212-8212-121212121212', 'pending');
  DO $test$
  DECLARE transitioned jsonb; replayed jsonb; first_update public.task_updates; replayed_update public.task_updates;
    browser_rows integer := 0;
  BEGIN
    transitioned := public.transition_task_assignment(
      '11111111-1111-4111-8111-111111111111', '99999999-9999-4999-8999-999999999999',
      '9c9c9c9c-9c9c-4c9c-8c9c-9c9c9c9c9c9c', '9d9d9d9d-9d9d-4d9d-8d9d-9d9d9d9d9d9d',
      '9b9b9b9b-9b9b-4b9b-8b9b-9b9b9b9b9b9b', 1, 'in_progress', 'Starting safely', '[]'::jsonb);
    replayed := public.transition_task_assignment(
      '11111111-1111-4111-8111-111111111111', '99999999-9999-4999-8999-999999999999',
      '9c9c9c9c-9c9c-4c9c-8c9c-9c9c9c9c9c9c', '9d9d9d9d-9d9d-4d9d-8d9d-9d9d9d9d9d9d',
      '9b9b9b9b-9b9b-4b9b-8b9b-9b9b9b9b9b9b', 1, 'in_progress', 'Starting safely', '[]'::jsonb);
    IF transitioned->'assignment'->>'id' IS DISTINCT FROM replayed->'assignment'->>'id'
       OR (SELECT version FROM public.task_assignments WHERE id = '9b9b9b9b-9b9b-4b9b-8b9b-9b9b9b9b9b9b') <> 2
       OR (SELECT count(*) FROM public.task_updates WHERE task_id = '9a9a9a9a-9a9a-4a9a-8a9a-9a9a9a9a9a9a') <> 1
       OR (SELECT count(*) FROM public.event_outbox WHERE topic = 'task.status_changed'
         AND payload->>'task_id' = '9a9a9a9a-9a9a-4a9a-8a9a-9a9a9a9a9a9a') <> 1 THEN
      RAISE EXCEPTION 'Task transition was not atomic and idempotent.';
    END IF;
    SELECT * INTO first_update FROM public.add_task_update(
      '11111111-1111-4111-8111-111111111111', '99999999-9999-4999-8999-999999999999',
      '9e9e9e9e-9e9e-4e9e-8e9e-9e9e9e9e9e9e', '9f9f9f9f-9f9f-4f9f-8f9f-9f9f9f9f9f9f',
      '9a9a9a9a-9a9a-4a9a-8a9a-9a9a9a9a9a9a', 'Progress note', 60, '[]'::jsonb);
    SELECT * INTO replayed_update FROM public.add_task_update(
      '11111111-1111-4111-8111-111111111111', '99999999-9999-4999-8999-999999999999',
      '9e9e9e9e-9e9e-4e9e-8e9e-9e9e9e9e9e9e', '9f9f9f9f-9f9f-4f9f-8f9f-9f9f9f9f9f9f',
      '9a9a9a9a-9a9a-4a9a-8a9a-9a9a9a9a9a9a', 'Progress note', 60, '[]'::jsonb);
    IF first_update.id IS DISTINCT FROM replayed_update.id
       OR (SELECT count(*) FROM public.event_outbox WHERE topic = 'task.update_added'
         AND payload->>'task_id' = '9a9a9a9a-9a9a-4a9a-8a9a-9a9a9a9a9a9a') <> 1
       OR (SELECT public FROM storage.buckets WHERE id = 'task-attachments') IS NOT FALSE THEN
      RAISE EXCEPTION 'Task update replay or private attachment control failed.';
    END IF;
    PERFORM public.transition_task_assignment(
      '11111111-1111-4111-8111-111111111111', '99999999-9999-4999-8999-999999999999',
      '90909090-9090-4090-8090-909090909090', '91919191-9191-4191-8191-919191919191',
      '9b9b9b9b-9b9b-4b9b-8b9b-9b9b9b9b9b9b', 2, 'completed', 'Done', '[]'::jsonb);
    BEGIN
      PERFORM public.transition_task_assignment(
        '11111111-1111-4111-8111-111111111111', '99999999-9999-4999-8999-999999999999',
        '92929292-9292-4292-8292-929292929292', '93939393-9393-4393-8393-939393939393',
        '9b9b9b9b-9b9b-4b9b-8b9b-9b9b9b9b9b9b', 3, 'in_progress', 'Illegal reopen', '[]'::jsonb);
      RAISE EXCEPTION 'Completed task was reopened through an illegal transition.';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
    PERFORM set_config('request.jwt.claim.sub', '99999999-9999-4999-8999-999999999999', true);
    BEGIN
      UPDATE public.task_assignments SET status = 'delayed'
      WHERE id = '9b9b9b9b-9b9b-4b9b-8b9b-9b9b9b9b9b9b';
      GET DIAGNOSTICS browser_rows = ROW_COUNT;
    EXCEPTION WHEN insufficient_privilege THEN browser_rows := 0;
    END;
    RESET ROLE;
    IF browser_rows <> 0 THEN RAISE EXCEPTION 'Direct browser task transition was not denied.'; END IF;
  END
  $test$;

  SET request.jwt.claim.role = 'service_role';
  DO $test$
  DECLARE submitted public.leave_requests; replayed public.leave_requests;
  BEGIN
    SELECT * INTO submitted FROM public.submit_leave_request(
      '11111111-1111-4111-8111-111111111111', '99999999-9999-4999-8999-999999999999',
      '3c3c3c3c-3c3c-4c3c-8c3c-3c3c3c3c3c3c', '3b3b3b3b-3b3b-4b3b-8b3b-3b3b3b3b3b3b',
      '3a3a3a3a-3a3a-4a3a-8a3a-3a3a3a3a3a3a', '12121212-1212-4212-8212-121212121212',
      'vacation', '2101-01-10', '2101-01-12', 'Atomic submission proof', NULL, NULL);
    SELECT * INTO replayed FROM public.submit_leave_request(
      '11111111-1111-4111-8111-111111111111', '99999999-9999-4999-8999-999999999999',
      '3c3c3c3c-3c3c-4c3c-8c3c-3c3c3c3c3c3c', '3b3b3b3b-3b3b-4b3b-8b3b-3b3b3b3b3b3b',
      '3a3a3a3a-3a3a-4a3a-8a3a-3a3a3a3a3a3a', '12121212-1212-4212-8212-121212121212',
      'vacation', '2101-01-10', '2101-01-12', 'Atomic submission proof', NULL, NULL);
    IF submitted.id IS DISTINCT FROM replayed.id OR submitted.days_count <> 3
       OR (SELECT count(*) FROM public.leave_requests WHERE id = submitted.id) <> 1
       OR (SELECT count(*) FROM public.event_outbox WHERE topic = 'leave.request_submitted'
         AND payload->>'leave_request_id' = submitted.id::text) <> 1
       OR (SELECT count(*) FROM public.operational_audit_logs WHERE action = 'leave.request_submitted'
         AND target_id = submitted.id::text) <> 1 THEN
      RAISE EXCEPTION 'Atomic leave submission was not exact or idempotent.';
    END IF;
  END
  $test$;

  SET request.jwt.claim.role = 'service_role';
  DO $test$
  DECLARE balance public.financial_balances; balance_replay public.financial_balances;
    acknowledged public.financial_balances; acknowledgement_replay public.financial_balances;
    browser_rows integer := 0; evidence jsonb;
  BEGIN
    SELECT * INTO balance FROM public.create_financial_balance(
      '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
      '2c2c2c2c-2c2c-4c2c-8c2c-2c2c2c2c2c2c', '2b2b2b2b-2b2b-4b2b-8b2b-2b2b2b2b2b2b',
      '2a2a2a2a-2a2a-4a2a-8a2a-2a2a2a2a2a2a', '12121212-1212-4212-8212-121212121212',
      'deficit', 345.67, 'Atomic balance proof', NULL);
    SELECT * INTO balance_replay FROM public.create_financial_balance(
      '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
      '2c2c2c2c-2c2c-4c2c-8c2c-2c2c2c2c2c2c', '2b2b2b2b-2b2b-4b2b-8b2b-2b2b2b2b2b2b',
      '2a2a2a2a-2a2a-4a2a-8a2a-2a2a2a2a2a2a', '12121212-1212-4212-8212-121212121212',
      'deficit', 345.67, 'Atomic balance proof', NULL);
    evidence := '{"consent":true,"terms_version":"financial-balance-ack-v1","signed_at":"2099-10-02T12:00:00Z","ip_hash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}'::jsonb;
    SELECT * INTO acknowledged FROM public.acknowledge_financial_balance(
      '11111111-1111-4111-8111-111111111111', '99999999-9999-4999-8999-999999999999',
      '2f2f2f2f-2f2f-4f2f-8f2f-2f2f2f2f2f2f', '2e2e2e2e-2e2e-4e2e-8e2e-2e2e2e2e2e2e',
      balance.id, 1, 'Tenant A Employee', evidence);
    SELECT * INTO acknowledgement_replay FROM public.acknowledge_financial_balance(
      '11111111-1111-4111-8111-111111111111', '99999999-9999-4999-8999-999999999999',
      '2f2f2f2f-2f2f-4f2f-8f2f-2f2f2f2f2f2f', '2e2e2e2e-2e2e-4e2e-8e2e-2e2e2e2e2e2e',
      balance.id, 1, 'Tenant A Employee', evidence);
    IF balance.id IS DISTINCT FROM balance_replay.id OR acknowledged.id IS DISTINCT FROM acknowledgement_replay.id
       OR acknowledged.status <> 'acknowledged' OR acknowledged.version <> 2
       OR length(acknowledged.acknowledgment_signature_hash) <> 64
       OR (SELECT count(*) FROM public.financial_balances WHERE id = balance.id) <> 1
       OR (SELECT count(*) FROM public.event_outbox WHERE topic IN
         ('financial.balance_created', 'financial.balance_acknowledged')
         AND payload->>'balance_id' = balance.id::text) <> 2
       OR (SELECT count(*) FROM public.operational_audit_logs WHERE target_type = 'financial_balance'
         AND target_id = balance.id::text) <> 2 THEN
      RAISE EXCEPTION 'Financial-balance creation or evidence acknowledgement was not exact and idempotent.';
    END IF;
    IF EXISTS (SELECT 1 FROM storage.buckets WHERE id IN ('balance-attachments', 'recruitment',
        'task-attachments', 'chat-attachments', 'merchant-payment-proofs') AND public) THEN
      RAISE EXCEPTION 'A protected attachment bucket is public.';
    END IF;
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
    PERFORM set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
    BEGIN
      UPDATE public.financial_balances SET amount = 1 WHERE id = balance.id;
      GET DIAGNOSTICS browser_rows = ROW_COUNT;
    EXCEPTION WHEN insufficient_privilege THEN browser_rows := 0;
    END;
    RESET ROLE;
    IF browser_rows <> 0 THEN RAISE EXCEPTION 'Direct browser financial-balance mutation was not denied.'; END IF;
  END
  $test$;

  SET request.jwt.claim.role = 'service_role';
  DO $test$
  DECLARE created jsonb; replayed jsonb; updated jsonb; browser_rows integer := 0;
  BEGIN
    created := public.save_task(
      '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
      '8c8c8c8c-8c8c-4c8c-8c8c-8c8c8c8c8c8c', '8b8b8b8b-8b8b-4b8b-8b8b-8b8b8b8b8b8b',
      '8a8a8a8a-8a8a-4a8a-8a8a-8a8a8a8a8a8a', NULL, 'Atomic managed task', 'Create proof',
      'high', '2099-09-01', '12121212-1212-4212-8212-121212121212', 'Initial instructions', '[]'::jsonb);
    replayed := public.save_task(
      '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
      '8c8c8c8c-8c8c-4c8c-8c8c-8c8c8c8c8c8c', '8b8b8b8b-8b8b-4b8b-8b8b-8b8b8b8b8b8b',
      '8a8a8a8a-8a8a-4a8a-8a8a-8a8a8a8a8a8a', NULL, 'Atomic managed task', 'Create proof',
      'high', '2099-09-01', '12121212-1212-4212-8212-121212121212', 'Initial instructions', '[]'::jsonb);
    updated := public.save_task(
      '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
      '8e8e8e8e-8e8e-4e8e-8e8e-8e8e8e8e8e8e', '8d8d8d8d-8d8d-4d8d-8d8d-8d8d8d8d8d8d',
      '8a8a8a8a-8a8a-4a8a-8a8a-8a8a8a8a8a8a', 1, 'Atomic managed task updated', 'Update proof',
      'urgent', '2099-09-02', '12121212-1212-4212-8212-121212121212', 'Updated instructions', '[]'::jsonb);
    IF created->'task'->>'id' IS DISTINCT FROM replayed->'task'->>'id'
       OR (updated->'task'->>'version')::integer <> 2
       OR (SELECT count(*) FROM public.tasks WHERE id = '8a8a8a8a-8a8a-4a8a-8a8a-8a8a8a8a8a8a') <> 1
       OR (SELECT count(*) FROM public.task_assignments WHERE task_id = '8a8a8a8a-8a8a-4a8a-8a8a-8a8a8a8a8a8a') <> 1
       OR (SELECT count(*) FROM public.task_updates WHERE task_id = '8a8a8a8a-8a8a-4a8a-8a8a-8a8a8a8a8a8a') <> 2
       OR (SELECT count(*) FROM public.event_outbox WHERE topic IN ('task.created', 'task.updated')
         AND payload->>'task_id' = '8a8a8a8a-8a8a-4a8a-8a8a-8a8a8a8a8a8a') <> 2
       OR (SELECT count(*) FROM public.operational_audit_logs WHERE target_type = 'task'
         AND target_id = '8a8a8a8a-8a8a-4a8a-8a8a-8a8a8a8a8a8a') <> 2 THEN
      RAISE EXCEPTION 'Atomic task create/update did not reconcile exactly.';
    END IF;
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
    PERFORM set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
    BEGIN
      INSERT INTO public.tasks (org_id, title, created_by)
      VALUES ('11111111-1111-4111-8111-111111111111', 'Forbidden browser task',
        '22222222-2222-4222-8222-222222222222');
      GET DIAGNOSTICS browser_rows = ROW_COUNT;
    EXCEPTION WHEN insufficient_privilege THEN browser_rows := 0;
    END;
    RESET ROLE;
    IF browser_rows <> 0 THEN RAISE EXCEPTION 'Direct browser task creation was not denied.'; END IF;
  END
  $test$;

  SET request.jwt.claim.role = 'service_role';
  DO $test$
  DECLARE inventory public.asset_inventory; replayed_inventory public.asset_inventory;
    assignment public.employee_assets; replayed_assignment public.employee_assets;
    acknowledged public.employee_assets; returned public.employee_assets;
    depreciation jsonb; replayed_depreciation jsonb; posted_journal_id uuid; browser_rows integer := 0;
  BEGIN
    SELECT * INTO inventory FROM public.create_asset_inventory(
      '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
      '7c7c7c7c-7c7c-4c7c-8c7c-7c7c7c7c7c7c', '7b7b7b7b-7b7b-4b7b-8b7b-7b7b7b7b7b7b',
      '7a7a7a7a-7a7a-4a7a-8a7a-7a7a7a7a7a7a',
      '{"asset_name":"Custody laptop","asset_type":"Laptop","serial_number":"ASSET-SMOKE-1","purchase_date":"2099-09-01","purchase_price":1200,"paid_immediately":false,"useful_life_months":12,"salvage_value":0}'::jsonb);
    SELECT * INTO replayed_inventory FROM public.create_asset_inventory(
      '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
      '7c7c7c7c-7c7c-4c7c-8c7c-7c7c7c7c7c7c', '7b7b7b7b-7b7b-4b7b-8b7b-7b7b7b7b7b7b',
      '7a7a7a7a-7a7a-4a7a-8a7a-7a7a7a7a7a7a',
      '{"asset_name":"Custody laptop","asset_type":"Laptop","serial_number":"ASSET-SMOKE-1","purchase_date":"2099-09-01","purchase_price":1200,"paid_immediately":false,"useful_life_months":12,"salvage_value":0}'::jsonb);
    SELECT * INTO assignment FROM public.assign_asset_inventory(
      '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
      '7f7f7f7f-7f7f-4f7f-8f7f-7f7f7f7f7f7f', '7e7e7e7e-7e7e-4e7e-8e7e-7e7e7e7e7e7e',
      '7d7d7d7d-7d7d-4d7d-8d7d-7d7d7d7d7d7d', inventory.id,
      '12121212-1212-4212-8212-121212121212', 'Custody proof');
    SELECT * INTO replayed_assignment FROM public.assign_asset_inventory(
      '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
      '7f7f7f7f-7f7f-4f7f-8f7f-7f7f7f7f7f7f', '7e7e7e7e-7e7e-4e7e-8e7e-7e7e7e7e7e7e',
      '7d7d7d7d-7d7d-4d7d-8d7d-7d7d7d7d7d7d', inventory.id,
      '12121212-1212-4212-8212-121212121212', 'Custody proof');
    SELECT * INTO acknowledged FROM public.acknowledge_asset_assignment(
      '11111111-1111-4111-8111-111111111111', '99999999-9999-4999-8999-999999999999',
      '6b6b6b6b-6b6b-4b6b-8b6b-6b6b6b6b6b6b', '6a6a6a6a-6a6a-4a6a-8a6a-6a6a6a6a6a6a',
      assignment.id, 1, 'Tenant A Employee', '{"consent":true,"terms_version":"asset-custody-v1"}'::jsonb);
    SELECT * INTO returned FROM public.transition_asset_assignment(
      '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
      '6d6d6d6d-6d6d-4d6d-8d6d-6d6d6d6d6d6d', '6c6c6c6c-6c6c-4c6c-8c6c-6c6c6c6c6c6c',
      assignment.id, 2, 'returned');
    IF inventory.id IS DISTINCT FROM replayed_inventory.id OR assignment.id IS DISTINCT FROM replayed_assignment.id
       OR acknowledged.acknowledged_at IS NULL OR length(acknowledged.acknowledgment_signature_hash) <> 64
       OR returned.status <> 'returned' OR returned.version <> 3
       OR (SELECT status FROM public.asset_inventory WHERE id = inventory.id) <> 'returned'
       OR (SELECT current_assignment_id FROM public.asset_inventory WHERE id = inventory.id) IS NOT NULL
       OR (SELECT count(*) FROM public.event_outbox WHERE topic IN
         ('asset.inventory_created', 'asset.assigned', 'asset.acknowledged', 'asset.status_changed')
         AND (payload->>'inventory_id' = inventory.id::text OR payload->>'assignment_id' = assignment.id::text)) <> 4 THEN
      RAISE EXCEPTION 'Atomic asset inventory/custody/evidence workflow did not reconcile.';
    END IF;
    SELECT id INTO posted_journal_id FROM public.accounting_journal_entries
      WHERE organization_id = '11111111-1111-4111-8111-111111111111' AND status = 'posted' LIMIT 1;
    UPDATE public.asset_inventory SET capitalized_journal_id = posted_journal_id WHERE id = inventory.id;
    depreciation := public.run_asset_depreciation(
      '11111111-1111-4111-8111-111111111111', '45454545-4545-4545-8545-454545454545',
      '6f6f6f6f-6f6f-4f6f-8f6f-6f6f6f6f6f6f', '6e6e6e6e-6e6e-4e6e-8e6e-6e6e6e6e6e6e', '2099-10-01');
    replayed_depreciation := public.run_asset_depreciation(
      '11111111-1111-4111-8111-111111111111', '45454545-4545-4545-8545-454545454545',
      '6f6f6f6f-6f6f-4f6f-8f6f-6f6f6f6f6f6f', '6e6e6e6e-6e6e-4e6e-8e6e-6e6e6e6e6e6e', '2099-10-01');
    IF (depreciation->>'journalEntryId') IS DISTINCT FROM (replayed_depreciation->>'journalEntryId')
       OR (depreciation->>'assetsProcessed')::integer <> 1
       OR (SELECT months_depreciated FROM public.asset_inventory WHERE id = inventory.id) <> 1
       OR (SELECT count(*) FROM public.accounting_journal_lines
         WHERE journal_entry_id = (depreciation->>'journalEntryId')::uuid) <> 2
       OR (SELECT count(*) FROM public.asset_depreciation_runs
         WHERE org_id = '11111111-1111-4111-8111-111111111111' AND month = '2099-10-01') <> 1 THEN
      RAISE EXCEPTION 'Atomic monthly asset depreciation was not exact or idempotent: %', depreciation;
    END IF;
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
    PERFORM set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
    BEGIN
      UPDATE public.asset_inventory SET status = 'lost' WHERE id = inventory.id;
      GET DIAGNOSTICS browser_rows = ROW_COUNT;
    EXCEPTION WHEN insufficient_privilege THEN browser_rows := 0;
    END;
    RESET ROLE;
    IF browser_rows <> 0 THEN RAISE EXCEPTION 'Direct browser asset mutation was not denied.'; END IF;
  END
  $test$;

  SET request.jwt.claim.role = 'service_role';
  DO $test$
  DECLARE personnel public.personnel_files; personnel_replay public.personnel_files;
    contract public.employee_contracts; contract_replay public.employee_contracts;
    compliance jsonb; compliance_replay jsonb; browser_rows integer := 0;
    personnel_metadata jsonb; contract_metadata jsonb; retained_file public.managed_files;
  BEGIN
    UPDATE public.organization_settings SET timezone = 'UTC'
    WHERE org_id = '11111111-1111-4111-8111-111111111111';
    personnel_metadata := jsonb_build_object(
      'bucket', 'personnel-files',
      'path', '11111111-1111-4111-8111-111111111111/12121212-1212-4212-8212-121212121212/5b5b5b5b-5b5b-4b5b-8b5b-5b5b5b5b5b5b/personnel-proof.pdf',
      'filename', 'personnel-proof.pdf', 'type', 'application/pdf', 'size_bytes', 128,
      'sha256', repeat('a', 64), 'scan_status', 'clean', 'scan_engine', 'migration-test',
      'scanned_at', '2099-10-02T00:00:00Z');
    contract_metadata := jsonb_build_object(
      'bucket', 'personnel-files',
      'path', '11111111-1111-4111-8111-111111111111/12121212-1212-4212-8212-121212121212/5e5e5e5e-5e5e-4e5e-8e5e-5e5e5e5e5e5e/contract-proof.pdf',
      'filename', 'contract-proof.pdf', 'type', 'application/pdf', 'size_bytes', 256,
      'sha256', repeat('b', 64), 'scan_status', 'clean', 'scan_engine', 'migration-test',
      'scanned_at', '2099-10-02T00:00:00Z');
    SELECT * INTO personnel FROM public.register_personnel_file(
      '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
      '5c5c5c5c-5c5c-4c5c-8c5c-5c5c5c5c5c5c', '5b5b5b5b-5b5b-4b5b-8b5b-5b5b5b5b5b5b',
      '5a5a5a5a-5a5a-4a5a-8a5a-5a5a5a5a5a5a', '12121212-1212-4212-8212-121212121212',
      'Passport', '2099-11-01', 'Managed-file proof', personnel_metadata);
    SELECT * INTO personnel_replay FROM public.register_personnel_file(
      '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
      '5c5c5c5c-5c5c-4c5c-8c5c-5c5c5c5c5c5c', '5b5b5b5b-5b5b-4b5b-8b5b-5b5b5b5b5b5b',
      '5a5a5a5a-5a5a-4a5a-8a5a-5a5a5a5a5a5a', '12121212-1212-4212-8212-121212121212',
      'Passport', '2099-11-01', 'Managed-file proof', personnel_metadata);
    SELECT * INTO contract FROM public.register_employee_contract(
      '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
      '5f5f5f5f-5f5f-4f5f-8f5f-5f5f5f5f5f5f', '5e5e5e5e-5e5e-4e5e-8e5e-5e5e5e5e5e5e',
      '5d5d5d5d-5d5d-4d5d-8d5d-5d5d5d5d5d5d', '12121212-1212-4212-8212-121212121212',
      'permanent', '2099-01-01', '2099-11-01', '2099-11-01', 12000, contract_metadata);
    SELECT * INTO contract_replay FROM public.register_employee_contract(
      '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
      '5f5f5f5f-5f5f-4f5f-8f5f-5f5f5f5f5f5f', '5e5e5e5e-5e5e-4e5e-8e5e-5e5e5e5e5e5e',
      '5d5d5d5d-5d5d-4d5d-8d5d-5d5d5d5d5d5d', '12121212-1212-4212-8212-121212121212',
      'permanent', '2099-01-01', '2099-11-01', '2099-11-01', 12000, contract_metadata);
    IF personnel.id IS DISTINCT FROM personnel_replay.id OR contract.id IS DISTINCT FROM contract_replay.id
       OR personnel.scan_status <> 'clean' OR length(personnel.sha256) <> 64
       OR (SELECT count(*) FROM public.managed_files WHERE owner_id IN (personnel.id, contract.id)) <> 2
       OR (SELECT public FROM storage.buckets WHERE id = 'personnel-files') IS DISTINCT FROM false THEN
      RAISE EXCEPTION 'Managed personnel-file registration was not private, clean, or idempotent.';
    END IF;
    compliance := public.enqueue_compliance_alerts(
      '4a4a4a4a-4a4a-4a4a-8a4a-4a4a4a4a4a4a', '4b4b4b4b-4b4b-4b4b-8b4b-4b4b4b4b4b4b',
      '2099-10-02T12:00:00Z');
    compliance_replay := public.enqueue_compliance_alerts(
      '4a4a4a4a-4a4a-4a4a-8a4a-4a4a4a4a4a4a', '4b4b4b4b-4b4b-4b4b-8b4b-4b4b4b4b4b4b',
      '2099-10-02T12:00:00Z');
    IF (compliance->>'alertsEnqueued')::integer <> 3
       OR compliance->>'alertsEnqueued' IS DISTINCT FROM compliance_replay->>'alertsEnqueued'
       OR (SELECT count(*) FROM public.compliance_alerts WHERE deadline_date = '2099-11-01') <> 3
       OR (SELECT count(*) FROM public.event_outbox WHERE topic = 'compliance.deadline'
         AND payload->>'deadline_date' = '2099-11-01') <> 3 THEN
      RAISE EXCEPTION 'Compliance deadline job was not exact or idempotent: %', compliance;
    END IF;
    UPDATE public.managed_files SET retention_until = '2099-10-02'
    WHERE owner_type = 'personnel_file' AND owner_id = personnel.id;
    UPDATE public.managed_files SET retention_until = '2099-10-02', legal_hold = true
    WHERE owner_type = 'employee_contract' AND owner_id = contract.id;
    SELECT * INTO retained_file FROM public.claim_managed_file_retention('migration-retention-worker', 25, '2099-10-02');
    IF retained_file.owner_id IS DISTINCT FROM personnel.id
       OR (SELECT deletion_status FROM public.managed_files WHERE owner_id = contract.id) <> 'active' THEN
      RAISE EXCEPTION 'Managed-file retention did not claim exactly the due non-held file.';
    END IF;
    SELECT * INTO retained_file FROM public.complete_managed_file_retention(retained_file.id, 'migration-retention-worker');
    IF retained_file.deletion_status <> 'deleted' OR retained_file.deleted_at IS NULL
       OR (SELECT count(*) FROM public.claim_managed_file_retention('migration-retention-worker-2', 25, '2099-10-02')) <> 0 THEN
      RAISE EXCEPTION 'Managed-file retention completion was not exact or legal-hold safe.';
    END IF;
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
    PERFORM set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
    BEGIN
      INSERT INTO public.personnel_files (org_id, employee_id, category, file_name, file_path)
      VALUES ('11111111-1111-4111-8111-111111111111', '12121212-1212-4212-8212-121212121212',
        'other', 'forbidden.pdf', 'forbidden.pdf');
      GET DIAGNOSTICS browser_rows = ROW_COUNT;
    EXCEPTION WHEN insufficient_privilege THEN browser_rows := 0;
    END;
    RESET ROLE;
    IF browser_rows <> 0 THEN RAISE EXCEPTION 'Direct browser personnel-file write was not denied.'; END IF;
  END
  $test$;

  SET request.jwt.claim.role = 'service_role';
  DO $test$
  DECLARE created jsonb; replayed jsonb; updated jsonb; assigned jsonb; assigned_replay jsonb;
    removed jsonb; deleted jsonb; overlap_denied boolean := false; browser_rows integer := 0;
  BEGIN
    created := public.execute_schedule_command(
      '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
      '1c1c1c1c-1c1c-4c1c-8c1c-1c1c1c1c1c1c', '1b1b1b1b-1b1b-4b1b-8b1b-1b1b1b1b1b1b',
      'save_shift', '1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a', NULL,
      '{"name":"Atomic day shift","shift_type":"morning","start_time":"08:00","end_time":"16:00","location_id":"55555555-5555-4555-8555-555555555555"}'::jsonb);
    replayed := public.execute_schedule_command(
      '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
      '1c1c1c1c-1c1c-4c1c-8c1c-1c1c1c1c1c1c', '1b1b1b1b-1b1b-4b1b-8b1b-1b1b1b1b1b1b',
      'save_shift', '1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a', NULL,
      '{"name":"Atomic day shift","shift_type":"morning","start_time":"08:00","end_time":"16:00","location_id":"55555555-5555-4555-8555-555555555555"}'::jsonb);
    updated := public.execute_schedule_command(
      '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
      '1e1e1e1e-1e1e-4e1e-8e1e-1e1e1e1e1e1e', '1d1d1d1d-1d1d-4d1d-8d1d-1d1d1d1d1d1d',
      'save_shift', '1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a', 1,
      '{"name":"Atomic day shift","shift_type":"morning","start_time":"08:30","end_time":"16:30","location_id":"55555555-5555-4555-8555-555555555555"}'::jsonb);
    assigned := public.execute_schedule_command(
      '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
      '19191919-1919-4919-8919-191919191919', '18181818-1818-4818-8818-181818181818',
      'assign_shift', '17171717-1717-4717-8717-171717171717', NULL,
      '{"employee_id":"12121212-1212-4212-8212-121212121212","shift_id":"1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a","start_date":"2102-01-01","end_date":"2102-01-31"}'::jsonb);
    assigned_replay := public.execute_schedule_command(
      '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
      '19191919-1919-4919-8919-191919191919', '18181818-1818-4818-8818-181818181818',
      'assign_shift', '17171717-1717-4717-8717-171717171717', NULL,
      '{"employee_id":"12121212-1212-4212-8212-121212121212","shift_id":"1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a","start_date":"2102-01-01","end_date":"2102-01-31"}'::jsonb);
    BEGIN
      PERFORM public.execute_schedule_command(
        '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
        '16161616-1616-4616-8616-161616161616', '15151515-1515-4515-8515-151515151515',
        'assign_shift', '14141414-1414-4414-8414-141414141414', NULL,
        '{"employee_id":"12121212-1212-4212-8212-121212121212","shift_id":"1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a","start_date":"2102-01-15","end_date":"2102-02-15"}'::jsonb);
    EXCEPTION WHEN exclusion_violation THEN overlap_denied := true;
    END;
    removed := public.execute_schedule_command(
      '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
      '13131313-1313-4313-8313-131313131314', '12121212-1212-4212-8212-121212121213',
      'remove_assignment', '17171717-1717-4717-8717-171717171717', 1, '{}'::jsonb);
    deleted := public.execute_schedule_command(
      '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
      '11111111-1111-4111-8111-111111111112', '10101010-1010-4010-8010-101010101010',
      'delete_shift', '1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a', 2, '{}'::jsonb);
    IF created->'shift'->>'id' IS DISTINCT FROM replayed->'shift'->>'id'
       OR (updated->'shift'->>'version')::integer <> 2
       OR assigned->'assignment'->>'id' IS DISTINCT FROM assigned_replay->'assignment'->>'id'
       OR NOT overlap_denied OR removed->>'assignment_id' IS NULL OR deleted->>'shift_id' IS NULL
       OR EXISTS (SELECT 1 FROM public.shifts WHERE id = '1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a')
       OR EXISTS (SELECT 1 FROM public.employee_shifts WHERE id = '17171717-1717-4717-8717-171717171717')
       OR (SELECT count(*) FROM public.event_outbox WHERE topic LIKE 'schedule.%'
         AND payload->>'actor_user_id' = '22222222-2222-4222-8222-222222222222') <> 5
       OR (SELECT count(*) FROM public.schedule_commands WHERE target_id IN (
         '1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a', '17171717-1717-4717-8717-171717171717')) <> 5 THEN
      RAISE EXCEPTION 'Atomic schedule command workflow was not exact, replay-safe, or overlap-safe.';
    END IF;
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
    PERFORM set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
    BEGIN
      INSERT INTO public.shifts (org_id, name, shift_type)
      VALUES ('11111111-1111-4111-8111-111111111111', 'Forbidden browser shift', 'morning');
      GET DIAGNOSTICS browser_rows = ROW_COUNT;
    EXCEPTION WHEN insufficient_privilege THEN browser_rows := 0;
    END;
    RESET ROLE;
    IF browser_rows <> 0 THEN RAISE EXCEPTION 'Direct browser schedule write was not denied.'; END IF;
  END
  $test$;

  SET request.jwt.claim.role = 'service_role';
  DO $test$
  DECLARE department_created jsonb; department_replay jsonb; members_changed jsonb;
    promoted jsonb; location_created jsonb; location_replay jsonb; location_deleted jsonb;
    department_deleted jsonb; employee_version integer; browser_rows integer := 0;
  BEGIN
    department_created:=public.execute_hr_structure_command(
      '11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',
      '0c0c0c0c-0c0c-4c0c-8c0c-0c0c0c0c0c0c','0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b',
      'save_department','0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a',NULL,
      '{"name":"Atomic Structure Team","manager_employee_id":null}'::jsonb);
    department_replay:=public.execute_hr_structure_command(
      '11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',
      '0c0c0c0c-0c0c-4c0c-8c0c-0c0c0c0c0c0c','0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b',
      'save_department','0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a',NULL,
      '{"name":"Atomic Structure Team","manager_employee_id":null}'::jsonb);
    members_changed:=public.execute_hr_structure_command(
      '11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',
      '0e0e0e0e-0e0e-4e0e-8e0e-0e0e0e0e0e0e','0d0d0d0d-0d0d-4d0d-8d0d-0d0d0d0d0d0d',
      'set_department_members','0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a',1,
      '{"manager_employee_id":"33333333-3333-4333-8333-333333333333","employee_ids":["33333333-3333-4333-8333-333333333333","12121212-1212-4212-8212-121212121212"]}'::jsonb);
    SELECT lifecycle_version INTO employee_version FROM public.employees WHERE id='12121212-1212-4212-8212-121212121212';
    promoted:=public.execute_hr_structure_command(
      '11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',
      '09090909-0909-4909-8909-090909090909','08080808-0808-4808-8808-080808080808',
      'promote_employee','12121212-1212-4212-8212-121212121212',employee_version,
      '{"job_title":"Atomic Structure Lead","department_id":"0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a","manager_id":null,"effective_date":"2103-01-01","notes":"Atomic promotion proof","assign_department_manager":true}'::jsonb);
    location_created:=public.execute_hr_structure_command(
      '11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',
      '07070707-0707-4707-8707-070707070707','06060606-0606-4606-8606-060606060606',
      'save_location','05050505-0505-4505-8505-050505050505',NULL,
      '{"name":"Atomic Structure Office","type":"office","city":"Riyadh","radius_meters":100,"manager_employee_id":"12121212-1212-4212-8212-121212121212"}'::jsonb);
    location_replay:=public.execute_hr_structure_command(
      '11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',
      '07070707-0707-4707-8707-070707070707','06060606-0606-4606-8606-060606060606',
      'save_location','05050505-0505-4505-8505-050505050505',NULL,
      '{"name":"Atomic Structure Office","type":"office","city":"Riyadh","radius_meters":100,"manager_employee_id":"12121212-1212-4212-8212-121212121212"}'::jsonb);
    location_deleted:=public.execute_hr_structure_command(
      '11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',
      '04040404-0404-4404-8404-040404040404','03030303-0303-4303-8303-030303030303',
      'delete_location','05050505-0505-4505-8505-050505050505',1,'{}'::jsonb);
    department_deleted:=public.execute_hr_structure_command(
      '11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',
      '02020202-0202-4202-8202-020202020202','01010101-0101-4101-8101-010101010101',
      'delete_department','0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a',3,'{}'::jsonb);
    IF department_created->'department'->>'id' IS DISTINCT FROM department_replay->'department'->>'id'
       OR (members_changed->'department'->>'version')::integer<>2
       OR promoted->'employee'->>'job_title'<>'Atomic Structure Lead'
       OR location_created->'location'->>'id' IS DISTINCT FROM location_replay->'location'->>'id'
       OR location_deleted->>'location_id' IS NULL OR department_deleted->>'department_id' IS NULL
       OR (SELECT count(*) FROM public.hr_structure_commands WHERE id IN(
         '0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b','0d0d0d0d-0d0d-4d0d-8d0d-0d0d0d0d0d0d',
         '08080808-0808-4808-8808-080808080808','06060606-0606-4606-8606-060606060606',
         '03030303-0303-4303-8303-030303030303','01010101-0101-4101-8101-010101010101'))<>6
       OR (SELECT count(*) FROM public.employee_career_events WHERE notes IN('Atomic promotion proof','Department membership command'))<3 THEN
      RAISE EXCEPTION 'Atomic organization structure workflow did not reconcile or replay exactly.';
    END IF;
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claim.role','authenticated',true);
    PERFORM set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
    BEGIN
      INSERT INTO public.departments(org_id,name) VALUES('11111111-1111-4111-8111-111111111111','Forbidden browser department');
      GET DIAGNOSTICS browser_rows=ROW_COUNT;
    EXCEPTION WHEN insufficient_privilege THEN browser_rows:=0;
    END;
    RESET ROLE;
    IF browser_rows<>0 THEN RAISE EXCEPTION 'Direct browser structure write was not denied.'; END IF;
  END
  $test$;

  SET request.jwt.claim.role = 'service_role';
  INSERT INTO auth.users(id,email) VALUES
    ('e1e1e1e1-e1e1-41e1-81e1-e1e1e1e1e1e1','atomic-agent@example.test'),
    ('e2e2e2e2-e2e2-42e2-82e2-e2e2e2e2e2e2','atomic-merchant@example.test');
  DO $test$
  DECLARE agent_created jsonb; agent_replay jsonb; merchant_created jsonb; merchant_replay jsonb;
    conflict_denied boolean := false;
  BEGIN
    agent_created := public.provision_sales_identity(
      '11111111-1111-4111-8111-111111111111','61616161-6161-4161-8161-616161616161',
      'e3e3e3e3-e3e3-43e3-83e3-e3e3e3e3e3e3','e4e4e4e4-e4e4-44e4-84e4-e4e4e4e4e4e4',
      'e1e1e1e1-e1e1-41e1-81e1-e1e1e1e1e1e1','field_agent',
      '{"email":"atomic-agent@example.test","display_name":"Atomic Provisioned Agent","phone":"0501111111","national_id":"ATOMIC-ID-1","region":"Riyadh","commission_rate":5,"sim_price":50,"max_sim_capacity":100}'::jsonb);
    agent_replay := public.provision_sales_identity(
      '11111111-1111-4111-8111-111111111111','61616161-6161-4161-8161-616161616161',
      'e3e3e3e3-e3e3-43e3-83e3-e3e3e3e3e3e3','e4e4e4e4-e4e4-44e4-84e4-e4e4e4e4e4e4',
      'e1e1e1e1-e1e1-41e1-81e1-e1e1e1e1e1e1','field_agent',
      '{"email":"atomic-agent@example.test","display_name":"Atomic Provisioned Agent","phone":"0501111111","national_id":"ATOMIC-ID-1","region":"Riyadh","commission_rate":5,"sim_price":50,"max_sim_capacity":100}'::jsonb);
    merchant_created := public.provision_sales_identity(
      '11111111-1111-4111-8111-111111111111','e1e1e1e1-e1e1-41e1-81e1-e1e1e1e1e1e1',
      'e5e5e5e5-e5e5-45e5-85e5-e5e5e5e5e5e5','e6e6e6e6-e6e6-46e6-86e6-e6e6e6e6e6e6',
      'e2e2e2e2-e2e2-42e2-82e2-e2e2e2e2e2e2','merchant',
      jsonb_build_object('email','atomic-merchant@example.test','display_name','Atomic Merchant',
        'agent_id',agent_created->>'id','owner_name','Owner','sim_price',60,'commission_rate',10));
    merchant_replay := public.provision_sales_identity(
      '11111111-1111-4111-8111-111111111111','e1e1e1e1-e1e1-41e1-81e1-e1e1e1e1e1e1',
      'e5e5e5e5-e5e5-45e5-85e5-e5e5e5e5e5e5','e6e6e6e6-e6e6-46e6-86e6-e6e6e6e6e6e6',
      'e2e2e2e2-e2e2-42e2-82e2-e2e2e2e2e2e2','merchant',
      jsonb_build_object('email','atomic-merchant@example.test','display_name','Atomic Merchant',
        'agent_id',agent_created->>'id','owner_name','Owner','sim_price',60,'commission_rate',10));
    BEGIN
      PERFORM public.provision_sales_identity(
        '11111111-1111-4111-8111-111111111111','61616161-6161-4161-8161-616161616161',
        'e3e3e3e3-e3e3-43e3-83e3-e3e3e3e3e3e3','e4e4e4e4-e4e4-44e4-84e4-e4e4e4e4e4e4',
        'e1e1e1e1-e1e1-41e1-81e1-e1e1e1e1e1e1','field_agent',
        '{"email":"atomic-agent@example.test","display_name":"Changed Agent","phone":"0501111111","national_id":"ATOMIC-ID-1"}'::jsonb);
    EXCEPTION WHEN unique_violation THEN conflict_denied := true;
    END;
    IF agent_created IS DISTINCT FROM agent_replay OR merchant_created IS DISTINCT FROM merchant_replay
       OR NOT conflict_denied
       OR (SELECT count(*) FROM public.sales_identity_commands WHERE command_id IN(
         'e4e4e4e4-e4e4-44e4-84e4-e4e4e4e4e4e4','e6e6e6e6-e6e6-46e6-86e6-e6e6e6e6e6e6')) <> 2
       OR (SELECT count(*) FROM public.org_members WHERE user_id IN(
         'e1e1e1e1-e1e1-41e1-81e1-e1e1e1e1e1e1','e2e2e2e2-e2e2-42e2-82e2-e2e2e2e2e2e2')) <> 2
       OR (SELECT count(*) FROM public.event_outbox WHERE topic='sales.identity_provisioned'
         AND payload->>'entity_id' IN(agent_created->>'id',merchant_created->>'id')) <> 2 THEN
      RAISE EXCEPTION 'Sales identity provisioning was not atomic, replay-safe, or guarded.';
    END IF;
  END
  $test$;
  DO $test$
  DECLARE direct_denied boolean := false;
  BEGIN
    BEGIN
      INSERT INTO public.field_agents(organization_id,user_id,full_name,phone,national_id)
      VALUES('11111111-1111-4111-8111-111111111111','e2e2e2e2-e2e2-42e2-82e2-e2e2e2e2e2e2','Forbidden','0500000000','FORBIDDEN');
    EXCEPTION WHEN insufficient_privilege THEN direct_denied := true;
    END;
    IF NOT direct_denied THEN RAISE EXCEPTION 'Direct sales identity insert was not guarded.'; END IF;
  END
  $test$;

  DO $test$
  DECLARE agent_collection jsonb; agent_replay jsonb; merchant_collection jsonb; merchant_replay jsonb;
    confirmed jsonb; confirmed_replay jsonb; merchant_id_value uuid; business_date_value date;
  BEGIN
    SELECT id INTO merchant_id_value FROM public.merchants
    WHERE organization_id='11111111-1111-4111-8111-111111111111'
      AND user_id='e2e2e2e2-e2e2-42e2-82e2-e2e2e2e2e2e2';
    business_date_value:=public.organization_business_date('11111111-1111-4111-8111-111111111111',now());
    agent_collection:=public.record_sales_cash_collection(
      '11111111-1111-4111-8111-111111111111','61616161-6161-4161-8161-616161616161',
      'a9555555-a955-4555-8555-a95555555555','a9333333-a933-4333-8333-a93333333333',
      'a9111111-a911-4111-8111-a91111111111','agent','b1b1b1b1-b1b1-41b1-81b1-b1b1b1b1b1b1',
      250,'cash',business_date_value,'Agent cash proof',NULL);
    agent_replay:=public.record_sales_cash_collection(
      '11111111-1111-4111-8111-111111111111','61616161-6161-4161-8161-616161616161',
      'a9555555-a955-4555-8555-a95555555555','a9333333-a933-4333-8333-a93333333333',
      'a9111111-a911-4111-8111-a91111111111','agent','b1b1b1b1-b1b1-41b1-81b1-b1b1b1b1b1b1',
      250,'cash',business_date_value,'Agent cash proof',NULL);
    merchant_collection:=public.record_sales_cash_collection(
      '11111111-1111-4111-8111-111111111111','e2e2e2e2-e2e2-42e2-82e2-e2e2e2e2e2e2',
      'a9666666-a966-4666-8666-a96666666666','a9777777-a977-4777-8777-a97777777777',
      'a9222222-a922-4222-8222-a92222222222','merchant',merchant_id_value,
      175,'bank_transfer',business_date_value,'Merchant payment proof','merchant-payment-proofs/test/proof.pdf');
    merchant_replay:=public.record_sales_cash_collection(
      '11111111-1111-4111-8111-111111111111','e2e2e2e2-e2e2-42e2-82e2-e2e2e2e2e2e2',
      'a9666666-a966-4666-8666-a96666666666','a9777777-a977-4777-8777-a97777777777',
      'a9222222-a922-4222-8222-a92222222222','merchant',merchant_id_value,
      175,'bank_transfer',business_date_value,'Merchant payment proof','merchant-payment-proofs/test/proof.pdf');
    confirmed:=public.transition_merchant_cash_collection(
      '11111111-1111-4111-8111-111111111111','61616161-6161-4161-8161-616161616161',
      'a9888888-a988-4888-8888-a98888888888','a9999999-a999-4999-8999-a99999999999',
      'a9222222-a922-4222-8222-a92222222222',1,'confirmed',NULL);
    confirmed_replay:=public.transition_merchant_cash_collection(
      '11111111-1111-4111-8111-111111111111','61616161-6161-4161-8161-616161616161',
      'a9888888-a988-4888-8888-a98888888888','a9999999-a999-4999-8999-a99999999999',
      'a9222222-a922-4222-8222-a92222222222',1,'confirmed',NULL);
    IF agent_collection IS DISTINCT FROM agent_replay OR merchant_collection IS DISTINCT FROM merchant_replay
       OR confirmed IS DISTINCT FROM confirmed_replay OR merchant_collection->>'status'<>'pending'
       OR confirmed->>'status'<>'confirmed' OR (confirmed->>'version')::integer<>2
       OR (SELECT count(*) FROM public.sales_cash_commands WHERE collection_id IN(
         'a9111111-a911-4111-8111-a91111111111','a9222222-a922-4222-8222-a92222222222'))<>3
       OR (SELECT count(*) FROM public.event_outbox WHERE topic='sales.cash_confirmed'
         AND payload->>'collection_id' IN('a9111111-a911-4111-8111-a91111111111','a9222222-a922-4222-8222-a92222222222'))<>2
       OR (SELECT count(*) FROM public.event_outbox WHERE topic='sales.cash_submitted'
         AND payload->>'collection_id'='a9222222-a922-4222-8222-a92222222222')<>1 THEN
      RAISE EXCEPTION 'Sales cash recording, review, or accounting handoff was not exact and replay-safe.';
    END IF;
  END
  $test$;
  DO $test$
  DECLARE direct_denied boolean:=false;
  BEGIN
    BEGIN
      UPDATE public.agent_cash_collections SET amount=1 WHERE id='a9111111-a911-4111-8111-a91111111111';
    EXCEPTION WHEN insufficient_privilege THEN direct_denied:=true;
    END;
    IF NOT direct_denied THEN RAISE EXCEPTION 'Direct sales cash mutation was not guarded.'; END IF;
  END
  $test$;

  DO $test$
  DECLARE created jsonb; replayed jsonb; updated jsonb; deleted jsonb; direct_denied boolean:=false;
  BEGIN
    created:=public.execute_deduction_policy_command(
      '11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',
      'ab100000-0000-4000-8000-000000000005','ab100000-0000-4000-8000-000000000002',
      'save','ab100000-0000-4000-8000-000000000001',NULL,
      '{"name":"Atomic deduction proof","late_grace_minutes":10,"deduction_per_late_hour":25,"allowed_absent_days":1,"deduction_per_absent_day":100,"deduction_per_excess_approved_day":50}'::jsonb);
    replayed:=public.execute_deduction_policy_command(
      '11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',
      'ab100000-0000-4000-8000-000000000005','ab100000-0000-4000-8000-000000000002',
      'save','ab100000-0000-4000-8000-000000000001',NULL,
      '{"name":"Atomic deduction proof","late_grace_minutes":10,"deduction_per_late_hour":25,"allowed_absent_days":1,"deduction_per_absent_day":100,"deduction_per_excess_approved_day":50}'::jsonb);
    updated:=public.execute_deduction_policy_command(
      '11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',
      'ab100000-0000-4000-8000-000000000006','ab100000-0000-4000-8000-000000000003',
      'save','ab100000-0000-4000-8000-000000000001',1,
      '{"name":"Atomic deduction proof updated","late_grace_minutes":15,"deduction_per_late_hour":30,"allowed_absent_days":1,"deduction_per_absent_day":110,"deduction_per_excess_approved_day":55}'::jsonb);
    deleted:=public.execute_deduction_policy_command(
      '11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',
      'ab100000-0000-4000-8000-000000000007','ab100000-0000-4000-8000-000000000004',
      'delete','ab100000-0000-4000-8000-000000000001',2,'{}'::jsonb);
    IF created IS DISTINCT FROM replayed OR (updated->'policy'->>'version')::integer<>2
       OR deleted->>'policy_id'<>'ab100000-0000-4000-8000-000000000001'
       OR EXISTS(SELECT 1 FROM public.deduction_rule_groups WHERE id='ab100000-0000-4000-8000-000000000001')
       OR (SELECT count(*) FROM public.deduction_policy_commands WHERE target_id='ab100000-0000-4000-8000-000000000001')<>3
       OR (SELECT count(*) FROM public.event_outbox WHERE topic LIKE 'payroll.deduction_policy_%'
         AND payload->>'policy_id'='ab100000-0000-4000-8000-000000000001')<>3 THEN
      RAISE EXCEPTION 'Deduction policy commands were not atomic, versioned, and replay-safe.';
    END IF;
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claim.role','authenticated',true);
    PERFORM set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
    BEGIN
      INSERT INTO public.deduction_rule_groups(org_id,name)
      VALUES('11111111-1111-4111-8111-111111111111','Forbidden browser policy');
    EXCEPTION WHEN insufficient_privilege THEN direct_denied:=true;
    END;
    RESET ROLE;
    IF NOT direct_denied THEN RAISE EXCEPTION 'Direct browser deduction-policy mutation was not denied.'; END IF;
  END
  $test$;

  DO $test$
  DECLARE version_value integer; updated jsonb; replayed jsonb; conflict_denied boolean:=false;
  BEGIN
    SELECT lifecycle_version INTO version_value FROM public.employees
    WHERE id='12121212-1212-4212-8212-121212121212';
    updated:=public.update_employee_master(
      '11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',
      'ab200000-0000-4000-8000-000000000002','ab200000-0000-4000-8000-000000000001',
      '12121212-1212-4212-8212-121212121212',version_value,
      '{"full_name":"Atomic Employee Master Proof"}'::jsonb,
      ARRAY['55555555-5555-4555-8555-555555555555'::uuid],
      '55555555-5555-4555-8555-555555555555',NULL);
    replayed:=public.update_employee_master(
      '11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',
      'ab200000-0000-4000-8000-000000000002','ab200000-0000-4000-8000-000000000001',
      '12121212-1212-4212-8212-121212121212',version_value,
      '{"full_name":"Atomic Employee Master Proof"}'::jsonb,
      ARRAY['55555555-5555-4555-8555-555555555555'::uuid],
      '55555555-5555-4555-8555-555555555555',NULL);
    BEGIN
      PERFORM public.update_employee_master(
        '11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',
        'ab200000-0000-4000-8000-000000000003','ab200000-0000-4000-8000-000000000001',
        '12121212-1212-4212-8212-121212121212',version_value,
        '{"full_name":"Changed retry"}'::jsonb,
        ARRAY['55555555-5555-4555-8555-555555555555'::uuid],
        '55555555-5555-4555-8555-555555555555',NULL);
    EXCEPTION WHEN unique_violation THEN conflict_denied:=true;
    END;
    IF updated IS DISTINCT FROM replayed OR NOT conflict_denied
       OR updated->>'full_name'<>'Atomic Employee Master Proof'
       OR (updated->>'lifecycle_version')::integer<>version_value+1
       OR (SELECT count(*) FROM public.employee_lifecycle_commands
         WHERE idempotency_key='ab200000-0000-4000-8000-000000000001')<>1
       OR (SELECT count(*) FROM public.employee_locations
         WHERE employee_id='12121212-1212-4212-8212-121212121212' AND assigned_to IS NULL AND is_primary)<>1
       OR (SELECT count(*) FROM public.event_outbox outbox
         JOIN public.business_events event ON event.id=outbox.business_event_id
         WHERE outbox.topic='employee.updated' AND event.request_id='ab200000-0000-4000-8000-000000000002')<>1 THEN
      RAISE EXCEPTION 'Employee master proof failed: same %, conflict %, name %, version % expected %, commands %, locations %, events %.',
        updated IS NOT DISTINCT FROM replayed, conflict_denied, updated->>'full_name',
        updated->>'lifecycle_version', version_value+1,
        (SELECT count(*) FROM public.employee_lifecycle_commands WHERE idempotency_key='ab200000-0000-4000-8000-000000000001'),
        (SELECT count(*) FROM public.employee_locations WHERE employee_id='12121212-1212-4212-8212-121212121212' AND assigned_to IS NULL AND is_primary),
        (SELECT count(*) FROM public.event_outbox outbox JOIN public.business_events event ON event.id=outbox.business_event_id
          WHERE outbox.topic='employee.updated' AND event.request_id='ab200000-0000-4000-8000-000000000002');
    END IF;
  END
  $test$;

  INSERT INTO auth.users(id,email) VALUES
    ('ab300000-0000-4000-8000-000000000001','atomic-sales-team@example.test');
  UPDATE public.profiles SET org_id='11111111-1111-4111-8111-111111111111',
    full_name='Atomic Sales Team Member',email='atomic-sales-team@example.test',account_status='Active'
  WHERE user_id='ab300000-0000-4000-8000-000000000001';
  INSERT INTO public.org_members(org_id,user_id,role)
  VALUES('11111111-1111-4111-8111-111111111111','ab300000-0000-4000-8000-000000000001','sales');
  INSERT INTO public.employees(id,org_id,user_id,full_name,email,job_title,status,lifecycle_status)
  VALUES('ab300000-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111',
    'ab300000-0000-4000-8000-000000000001','Atomic Sales Team Member','atomic-sales-team@example.test',
    'Sales','Active','active');
  INSERT INTO public.shifts(id,org_id,name,shift_type,start_time,end_time,location_id)
  VALUES('ab300000-0000-4000-8000-000000000003','11111111-1111-4111-8111-111111111111',
    'Atomic sales shift','morning','09:00','17:00','55555555-5555-4555-8555-555555555555');
  DO $test$
  DECLARE configured jsonb; replayed jsonb; conflict_denied boolean:=false;
    assignment_denied boolean:=false; location_denied boolean:=false; business_date_value date;
  BEGIN
    business_date_value:=public.organization_business_date('11111111-1111-4111-8111-111111111111',now());
    configured:=public.execute_sales_team_command(
      '11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',
      'ab300000-0000-4000-8000-000000000005','ab300000-0000-4000-8000-000000000004',
      'ab300000-0000-4000-8000-000000000001','ab300000-0000-4000-8000-000000000002',1,
      jsonb_build_object('full_name','Atomic Sales Team Configured','phone','0501234567','national_id','TEAM-PROOF',
        'role','sales','location_touched',true,'location_id','55555555-5555-4555-8555-555555555555',
        'shift_touched',true,'shift_id','ab300000-0000-4000-8000-000000000003','company_assignments',
        jsonb_build_array(jsonb_build_object('company_id','e1e1e1e1-e1e1-41e1-81e1-e1e1e1e1e1e1',
          'assignment_role','sales','start_date',business_date_value,'daily_target',250))));
    replayed:=public.execute_sales_team_command(
      '11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',
      'ab300000-0000-4000-8000-000000000005','ab300000-0000-4000-8000-000000000004',
      'ab300000-0000-4000-8000-000000000001','ab300000-0000-4000-8000-000000000002',1,
      jsonb_build_object('full_name','Atomic Sales Team Configured','phone','0501234567','national_id','TEAM-PROOF',
        'role','sales','location_touched',true,'location_id','55555555-5555-4555-8555-555555555555',
        'shift_touched',true,'shift_id','ab300000-0000-4000-8000-000000000003','company_assignments',
        jsonb_build_array(jsonb_build_object('company_id','e1e1e1e1-e1e1-41e1-81e1-e1e1e1e1e1e1',
          'assignment_role','sales','start_date',business_date_value,'daily_target',250))));
    BEGIN
      PERFORM public.execute_sales_team_command(
        '11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',
        'ab300000-0000-4000-8000-000000000006','ab300000-0000-4000-8000-000000000004',
        'ab300000-0000-4000-8000-000000000001','ab300000-0000-4000-8000-000000000002',1,
        jsonb_build_object('full_name','Changed retry','role','sales','company_assignments',
          jsonb_build_array(jsonb_build_object('company_id','e1e1e1e1-e1e1-41e1-81e1-e1e1e1e1e1e1',
            'assignment_role','sales','start_date',business_date_value,'daily_target',250))));
    EXCEPTION WHEN unique_violation THEN conflict_denied:=true;
    END;
    IF configured IS DISTINCT FROM replayed OR NOT conflict_denied
       OR (configured->>'lifecycle_version')::integer<>2
       OR (SELECT count(*) FROM public.sales_team_commands WHERE id='ab300000-0000-4000-8000-000000000004')<>1
       OR (SELECT count(*) FROM public.sales_company_assignments
         WHERE user_id='ab300000-0000-4000-8000-000000000001' AND is_active)<>1
       OR (SELECT count(*) FROM public.employee_locations
         WHERE employee_id='ab300000-0000-4000-8000-000000000002' AND assigned_to IS NULL AND is_primary)<>1
       OR (SELECT count(*) FROM public.employee_shifts
         WHERE employee_id='ab300000-0000-4000-8000-000000000002' AND end_date IS NULL)<>1
       OR (SELECT count(*) FROM public.event_outbox WHERE topic='sales.team_configured'
         AND payload->>'employee_id'='ab300000-0000-4000-8000-000000000002')<>1 THEN
      RAISE EXCEPTION 'Sales-team configuration was not atomic, versioned, and replay-safe.';
    END IF;
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claim.role','authenticated',true);
    PERFORM set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
    BEGIN
      UPDATE public.sales_company_assignments SET daily_target=1
      WHERE user_id='ab300000-0000-4000-8000-000000000001';
    EXCEPTION WHEN insufficient_privilege THEN assignment_denied:=true;
    END;
    BEGIN
      INSERT INTO public.employee_locations(org_id,employee_id,location_id,is_primary)
      VALUES('11111111-1111-4111-8111-111111111111','ab300000-0000-4000-8000-000000000002',
        '55555555-5555-4555-8555-555555555555',false);
    EXCEPTION WHEN insufficient_privilege THEN location_denied:=true;
    END;
    RESET ROLE;
    IF NOT assignment_denied OR NOT location_denied THEN
      RAISE EXCEPTION 'Direct browser sales-team assignment writes were not denied.';
    END IF;
    PERFORM set_config('request.jwt.claim.role','service_role',true);
    PERFORM public.offboard_employee(
      '11111111-1111-4111-8111-111111111111','ab300000-0000-4000-8000-000000000002',
      '22222222-2222-4222-8222-222222222222','ab300000-0000-4000-8000-000000000006',
      business_date_value,'Atomic sales-team offboarding proof','termination');
    IF EXISTS(SELECT 1 FROM public.sales_company_assignments
      WHERE user_id='ab300000-0000-4000-8000-000000000001' AND is_active) THEN
      RAISE EXCEPTION 'Employee offboarding did not close active sales-company access.';
    END IF;
  END
  $test$;

  SET request.jwt.claim.role = 'service_role';
  DO $test$
  DECLARE submitted public.leave_requests; reviewed jsonb; replayed jsonb;
    escalation_event_id uuid; conflict_denied boolean := false;
  BEGIN
    SELECT * INTO submitted FROM public.submit_leave_request(
      '11111111-1111-4111-8111-111111111111', '99999999-9999-4999-8999-999999999999',
      'f1f1f1f1-f1f1-41f1-81f1-f1f1f1f1f1f1', 'f2f2f2f2-f2f2-42f2-82f2-f2f2f2f2f2f2',
      'f3f3f3f3-f3f3-43f3-83f3-f3f3f3f3f3f3', '12121212-1212-4212-8212-121212121212',
      'vacation', '2105-01-10', '2105-01-11', 'Leave escalation integrity proof', NULL, NULL);
    reviewed := public.execute_leave_review_command(
      '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
      submitted.id, 'f4f4f4f4-f4f4-44f4-84f4-f4f4f4f4f4f4', 'approved', 'Manager approval proof');
    replayed := public.execute_leave_review_command(
      '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
      submitted.id, 'f4f4f4f4-f4f4-44f4-84f4-f4f4f4f4f4f4', 'approved', 'Manager approval proof');
    BEGIN
      PERFORM public.execute_leave_review_command(
        '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
        submitted.id, 'f4f4f4f4-f4f4-44f4-84f4-f4f4f4f4f4f4', 'approved', 'Changed retry payload');
    EXCEPTION WHEN unique_violation THEN conflict_denied := true;
    END;
    SELECT event.id INTO escalation_event_id FROM public.business_events event
    WHERE event.org_id = '11111111-1111-4111-8111-111111111111'
      AND event.source_type = 'leave.manager_approved'
      AND event.business_key = submitted.id::text || ':2';
    INSERT INTO public.notifications(org_id,user_id,title,type,source_event_id)
    VALUES('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',
      'Exactly once leave notification','leave',escalation_event_id)
    ON CONFLICT (source_event_id,user_id) DO NOTHING;
    INSERT INTO public.notifications(org_id,user_id,title,type,source_event_id)
    VALUES('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',
      'Duplicate delivery attempt','leave',escalation_event_id)
    ON CONFLICT (source_event_id,user_id) DO NOTHING;
    IF reviewed IS DISTINCT FROM replayed OR reviewed->>'status' <> 'pending'
       OR (reviewed->>'current_step')::integer <> 2 OR NOT conflict_denied
       OR (SELECT count(*) FROM public.leave_review_commands
         WHERE org_id='11111111-1111-4111-8111-111111111111'
           AND command_id='f4f4f4f4-f4f4-44f4-84f4-f4f4f4f4f4f4') <> 1
       OR escalation_event_id IS NULL
       OR (SELECT count(*) FROM public.event_outbox
         WHERE business_event_id=escalation_event_id AND topic='leave.manager_approved') <> 1
       OR (SELECT count(*) FROM public.notifications
         WHERE source_event_id=escalation_event_id
           AND user_id='22222222-2222-4222-8222-222222222222') <> 1 THEN
      RAISE EXCEPTION 'Leave review replay, escalation outbox, or notification idempotency failed.';
    END IF;
  END
  $test$;

  -- v106/v109: inventory imports, agent assignment, and merchant handover are
  -- one replay-safe command chain with exact transfer and outbox evidence.
  DO $test$
  DECLARE
    imported jsonb; imported_replay jsonb; box_imported jsonb; box_replay jsonb;
    assigned_one jsonb; assigned_one_replay jsonb; assigned_owner jsonb;
    merchant_assigned jsonb; merchant_replay jsonb;
    imported_ids uuid[]; merchant_id_value uuid; owner_agent_id uuid;
  BEGIN
    SELECT merchant.id, merchant.agent_id INTO merchant_id_value, owner_agent_id
    FROM public.merchants merchant
    WHERE merchant.organization_id='11111111-1111-4111-8111-111111111111'
      AND merchant.user_id='e2e2e2e2-e2e2-42e2-82e2-e2e2e2e2e2e2';
    IF merchant_id_value IS NULL OR owner_agent_id IS NULL THEN
      RAISE EXCEPTION 'Atomic merchant fixture was not available for inventory proof.';
    END IF;

    imported:=public.execute_sim_inventory_command(
      '11111111-1111-4111-8111-111111111111','61616161-6161-4161-8161-616161616161',
      'ad000001-0000-4000-8000-000000000001','ad000002-0000-4000-8000-000000000002',
      'inventory_import',
      '{"sims":[{"iccid":"890000000000001101","provider":"virgin","sim_type":"prepaid","price":50},{"iccid":"890000000000001102","provider":"virgin","sim_type":"prepaid","price":50},{"iccid":"890000000000001103","provider":"virgin","sim_type":"prepaid","price":50}]}'::jsonb);
    imported_replay:=public.execute_sim_inventory_command(
      '11111111-1111-4111-8111-111111111111','61616161-6161-4161-8161-616161616161',
      'ad000001-0000-4000-8000-000000000001','ad000002-0000-4000-8000-000000000002',
      'inventory_import',
      '{"sims":[{"iccid":"890000000000001101","provider":"virgin","sim_type":"prepaid","price":50},{"iccid":"890000000000001102","provider":"virgin","sim_type":"prepaid","price":50},{"iccid":"890000000000001103","provider":"virgin","sim_type":"prepaid","price":50}]}'::jsonb);
    SELECT array_agg(item.value::uuid ORDER BY item.ordinality) INTO imported_ids
    FROM jsonb_array_elements_text(imported->'sim_unit_ids') WITH ORDINALITY AS item(value, ordinality);

    assigned_one:=public.execute_sim_inventory_command(
      '11111111-1111-4111-8111-111111111111','61616161-6161-4161-8161-616161616161',
      'ad000003-0000-4000-8000-000000000003','ad000004-0000-4000-8000-000000000004',
      'inventory_assign',jsonb_build_object('agent_id','b1b1b1b1-b1b1-41b1-81b1-b1b1b1b1b1b1',
        'sim_ids',jsonb_build_array(imported_ids[1]),'notes','Atomic inventory proof'));
    assigned_one_replay:=public.execute_sim_inventory_command(
      '11111111-1111-4111-8111-111111111111','61616161-6161-4161-8161-616161616161',
      'ad000003-0000-4000-8000-000000000003','ad000004-0000-4000-8000-000000000004',
      'inventory_assign',jsonb_build_object('agent_id','b1b1b1b1-b1b1-41b1-81b1-b1b1b1b1b1b1',
        'sim_ids',jsonb_build_array(imported_ids[1]),'notes','Atomic inventory proof'));
    assigned_owner:=public.execute_sim_inventory_command(
      '11111111-1111-4111-8111-111111111111','61616161-6161-4161-8161-616161616161',
      'ad000005-0000-4000-8000-000000000005','ad000006-0000-4000-8000-000000000006',
      'inventory_assign',jsonb_build_object('agent_id',owner_agent_id,
        'sim_ids',jsonb_build_array(imported_ids[2],imported_ids[3]),'notes','Merchant owner inventory proof'));

    box_imported:=public.execute_sim_inventory_command(
      '11111111-1111-4111-8111-111111111111','61616161-6161-4161-8161-616161616161',
      'ad000007-0000-4000-8000-000000000007','ad000008-0000-4000-8000-000000000008',
      'inventory_box_import',jsonb_build_object('provider','virgin',
        'kit_codes',jsonb_build_array('890000000000001201','890000000000001202'),
        'first_kitcode','890000000000001201','last_kitcode','890000000000001202',
        'quantity',2,'assigned_agent_id','b1b1b1b1-b1b1-41b1-81b1-b1b1b1b1b1b1',
        'skip_duplicates',false,'batch_number','ATOMIC-BOX-1'));
    box_replay:=public.execute_sim_inventory_command(
      '11111111-1111-4111-8111-111111111111','61616161-6161-4161-8161-616161616161',
      'ad000007-0000-4000-8000-000000000007','ad000008-0000-4000-8000-000000000008',
      'inventory_box_import',jsonb_build_object('provider','virgin',
        'kit_codes',jsonb_build_array('890000000000001201','890000000000001202'),
        'first_kitcode','890000000000001201','last_kitcode','890000000000001202',
        'quantity',2,'assigned_agent_id','b1b1b1b1-b1b1-41b1-81b1-b1b1b1b1b1b1',
        'skip_duplicates',false,'batch_number','ATOMIC-BOX-1'));

    merchant_assigned:=public.assign_sim_inventory_to_merchant(
      '11111111-1111-4111-8111-111111111111','61616161-6161-4161-8161-616161616161',
      'ad000009-0000-4000-8000-000000000009','ad000010-0000-4000-8000-000000000010',
      merchant_id_value,jsonb_build_array(imported_ids[2]),NULL,NULL,NULL,'Atomic merchant handover');
    merchant_replay:=public.assign_sim_inventory_to_merchant(
      '11111111-1111-4111-8111-111111111111','61616161-6161-4161-8161-616161616161',
      'ad000009-0000-4000-8000-000000000009','ad000010-0000-4000-8000-000000000010',
      merchant_id_value,jsonb_build_array(imported_ids[2]),NULL,NULL,NULL,'Atomic merchant handover');

    IF imported IS DISTINCT FROM imported_replay OR (imported->>'imported')::integer<>3
       OR assigned_one IS DISTINCT FROM assigned_one_replay OR (assigned_one->>'assigned')::integer<>1
       OR (assigned_owner->>'assigned')::integer<>2
       OR box_imported IS DISTINCT FROM box_replay OR (box_imported->>'inserted_count')::integer<>2
       OR merchant_assigned IS DISTINCT FROM merchant_replay OR (merchant_assigned->>'assigned')::integer<>1
       OR (SELECT status::text FROM public.sim_units WHERE id=imported_ids[2])<>'with_merchant'
       OR (SELECT current_merchant_id FROM public.sim_units WHERE id=imported_ids[2]) IS DISTINCT FROM merchant_id_value
       OR (SELECT count(*) FROM public.sim_units WHERE iccid BETWEEN '890000000000001101' AND '890000000000001103')<>3
       OR (SELECT count(*) FROM public.sim_units WHERE kit_code IN('890000000000001201','890000000000001202'))<>2
       OR (SELECT count(*) FROM public.sim_transfers WHERE sim_unit_id=ANY(imported_ids) AND transfer_type='initial_import')<>3
       OR (SELECT count(*) FROM public.sim_transfers WHERE sim_unit_id=ANY(imported_ids) AND transfer_type='assign_to_agent')<>3
       OR (SELECT count(*) FROM public.sim_transfers WHERE sim_unit_id=imported_ids[2] AND transfer_type='assign_to_merchant')<>1
       OR (SELECT count(*) FROM public.sim_commerce_commands WHERE idempotency_key IN(
         'ad000002-0000-4000-8000-000000000002','ad000004-0000-4000-8000-000000000004',
         'ad000006-0000-4000-8000-000000000006','ad000008-0000-4000-8000-000000000008',
         'ad000010-0000-4000-8000-000000000010'))<>5
       OR (SELECT count(*) FROM public.event_outbox WHERE payload->>'command_id' IN(
         'ad000002-0000-4000-8000-000000000002','ad000004-0000-4000-8000-000000000004',
         'ad000006-0000-4000-8000-000000000006','ad000008-0000-4000-8000-000000000008',
         'ad000010-0000-4000-8000-000000000010'))<>5 THEN
      RAISE EXCEPTION 'Atomic SIM inventory chain did not reconcile or replay exactly.';
    END IF;
  END
  $test$;

  -- v107: accounting master changes are optimistic, replay-safe, and durable.
  DO $test$
  DECLARE created jsonb; replayed jsonb; updated jsonb; deactivated jsonb; account_id_value uuid;
  BEGIN
    created:=public.execute_accounting_master_command(
      '11111111-1111-4111-8111-111111111111','45454545-4545-4545-8545-454545454545',
      'ad100001-0000-4000-8000-000000000001','ad100002-0000-4000-8000-000000000002',
      'account',NULL,0,'save',
      '{"code":"ATOMIC-901","name_ar":"Atomic launch expense","name_en":"Atomic launch expense","type":"expense","normal_balance":"debit","is_active":true}'::jsonb);
    replayed:=public.execute_accounting_master_command(
      '11111111-1111-4111-8111-111111111111','45454545-4545-4545-8545-454545454545',
      'ad100001-0000-4000-8000-000000000001','ad100002-0000-4000-8000-000000000002',
      'account',NULL,0,'save',
      '{"code":"ATOMIC-901","name_ar":"Atomic launch expense","name_en":"Atomic launch expense","type":"expense","normal_balance":"debit","is_active":true}'::jsonb);
    account_id_value:=(created->>'id')::uuid;
    updated:=public.execute_accounting_master_command(
      '11111111-1111-4111-8111-111111111111','45454545-4545-4545-8545-454545454545',
      'ad100003-0000-4000-8000-000000000003','ad100004-0000-4000-8000-000000000004',
      'account',account_id_value,1,'save','{"name_ar":"Atomic launch expense updated"}'::jsonb);
    deactivated:=public.execute_accounting_master_command(
      '11111111-1111-4111-8111-111111111111','45454545-4545-4545-8545-454545454545',
      'ad100005-0000-4000-8000-000000000005','ad100006-0000-4000-8000-000000000006',
      'account',account_id_value,2,'deactivate','{}'::jsonb);
    IF created IS DISTINCT FROM replayed OR (created->>'version')::integer<>1
       OR (updated->>'version')::integer<>2 OR updated->>'name_ar'<>'Atomic launch expense updated'
       OR (deactivated->>'version')::integer<>3 OR (deactivated->>'is_active')::boolean
       OR (SELECT count(*) FROM public.accounting_commands WHERE idempotency_key IN(
         'ad100002-0000-4000-8000-000000000002','ad100004-0000-4000-8000-000000000004',
         'ad100006-0000-4000-8000-000000000006'))<>3
       OR (SELECT count(*) FROM public.business_events WHERE source_type='accounting_master'
         AND business_key IN('ad100002-0000-4000-8000-000000000002','ad100004-0000-4000-8000-000000000004',
         'ad100006-0000-4000-8000-000000000006'))<>3
       OR (SELECT count(*) FROM public.event_outbox outbox JOIN public.business_events event
         ON event.id=outbox.business_event_id WHERE event.source_type='accounting_master'
         AND event.business_key IN('ad100002-0000-4000-8000-000000000002','ad100004-0000-4000-8000-000000000004',
         'ad100006-0000-4000-8000-000000000006') AND outbox.topic='accounting.record_changed')<>3 THEN
      RAISE EXCEPTION 'Atomic accounting master workflow did not reconcile or replay exactly.';
    END IF;
  END
  $test$;

  -- v108: promoter configuration is versioned and validates connected sales data.
  INSERT INTO public.sales_companies(id,organization_id,name,slug,code)
  VALUES('ad200001-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'Other Tenant Company','other-tenant-atomic','OTA');
  DO $test$
  DECLARE created jsonb; replayed jsonb; updated jsonb; deactivated jsonb;
    offer_id_value uuid; cross_tenant_denied boolean:=false;
  BEGIN
    created:=public.execute_promoter_configuration_command(
      '11111111-1111-4111-8111-111111111111','61616161-6161-4161-8161-616161616161',
      'ad200002-0000-4000-8000-000000000002','ad200003-0000-4000-8000-000000000003',
      'offer',NULL,0,'save',jsonb_build_object(
        'company_id','e1e1e1e1-e1e1-41e1-81e1-e1e1e1e1e1e1','product_id','e2e2e2e2-e2e2-42e2-82e2-e2e2e2e2e2e2',
        'name_ar','Atomic promoter offer','name_en','Atomic promoter offer','offer_target','mobile',
        'monthly_price',75,'contract_months',12,'priority',5,'is_active',true));
    replayed:=public.execute_promoter_configuration_command(
      '11111111-1111-4111-8111-111111111111','61616161-6161-4161-8161-616161616161',
      'ad200002-0000-4000-8000-000000000002','ad200003-0000-4000-8000-000000000003',
      'offer',NULL,0,'save',jsonb_build_object(
        'company_id','e1e1e1e1-e1e1-41e1-81e1-e1e1e1e1e1e1','product_id','e2e2e2e2-e2e2-42e2-82e2-e2e2e2e2e2e2',
        'name_ar','Atomic promoter offer','name_en','Atomic promoter offer','offer_target','mobile',
        'monthly_price',75,'contract_months',12,'priority',5,'is_active',true));
    offer_id_value:=(created->>'id')::uuid;
    updated:=public.execute_promoter_configuration_command(
      '11111111-1111-4111-8111-111111111111','61616161-6161-4161-8161-616161616161',
      'ad200004-0000-4000-8000-000000000004','ad200005-0000-4000-8000-000000000005',
      'offer',offer_id_value,1,'save','{"monthly_price":80,"priority":6}'::jsonb);
    deactivated:=public.execute_promoter_configuration_command(
      '11111111-1111-4111-8111-111111111111','61616161-6161-4161-8161-616161616161',
      'ad200006-0000-4000-8000-000000000006','ad200007-0000-4000-8000-000000000007',
      'offer',offer_id_value,2,'deactivate','{}'::jsonb);
    BEGIN
      PERFORM public.execute_promoter_configuration_command(
        '11111111-1111-4111-8111-111111111111','61616161-6161-4161-8161-616161616161',
        'ad200008-0000-4000-8000-000000000008','ad200009-0000-4000-8000-000000000009',
        'offer',NULL,0,'save',jsonb_build_object('company_id','ad200001-0000-4000-8000-000000000001',
          'name_ar','Forbidden cross tenant offer','offer_target','mobile','monthly_price',1));
    EXCEPTION WHEN check_violation THEN cross_tenant_denied:=true;
    END;
    IF created IS DISTINCT FROM replayed OR (created->>'version')::integer<>1
       OR (updated->>'version')::integer<>2 OR (updated->>'monthly_price')::numeric<>80
       OR (deactivated->>'version')::integer<>3 OR (deactivated->>'is_active')::boolean
       OR NOT cross_tenant_denied
       OR EXISTS(SELECT 1 FROM public.telecom_offers WHERE name_ar='Forbidden cross tenant offer')
       OR EXISTS(SELECT 1 FROM public.promoter_configuration_commands
         WHERE command_id='ad200009-0000-4000-8000-000000000009')
       OR (SELECT count(*) FROM public.promoter_configuration_commands WHERE command_id IN(
         'ad200003-0000-4000-8000-000000000003','ad200005-0000-4000-8000-000000000005',
         'ad200007-0000-4000-8000-000000000007'))<>3
       OR (SELECT count(*) FROM public.business_events WHERE source_type='promoter_configuration'
         AND business_key IN('ad200003-0000-4000-8000-000000000003','ad200005-0000-4000-8000-000000000005',
         'ad200007-0000-4000-8000-000000000007'))<>3 THEN
      RAISE EXCEPTION 'Atomic promoter configuration did not reconcile, isolate, or replay exactly.';
    END IF;
  END
  $test$;

  -- v110: the monthly EOSB journal and every employee accrual row commit as
  -- one natural-month command and replay without a second financial posting.
  DO $test$
  DECLARE posted jsonb; replayed jsonb; journal_id_value uuid; employee_count integer;
  BEGIN
    UPDATE public.accounting_settings settings SET
      default_eosb_expense_id=(SELECT id FROM public.accounting_accounts
        WHERE organization_id=settings.organization_id AND code='5000'),
      default_eosb_provision_id=(SELECT id FROM public.accounting_accounts
        WHERE organization_id=settings.organization_id AND code='2400'),
      auto_post_eosb=true
    WHERE settings.organization_id='11111111-1111-4111-8111-111111111111';
    posted:=public.run_eosb_accrual(
      '11111111-1111-4111-8111-111111111111','45454545-4545-4545-8545-454545454545',
      'ad250001-0000-4000-8000-000000000001','ad250002-0000-4000-8000-000000000002','2111-01-01');
    replayed:=public.run_eosb_accrual(
      '11111111-1111-4111-8111-111111111111','45454545-4545-4545-8545-454545454545',
      'ad250003-0000-4000-8000-000000000003','ad250004-0000-4000-8000-000000000004','2111-01-01');
    journal_id_value:=(posted->>'journalEntryId')::uuid;
    employee_count:=(posted->>'employeesProcessed')::integer;
    IF posted IS DISTINCT FROM replayed OR journal_id_value IS NULL OR employee_count<1
       OR (posted->>'status')<>'completed' OR (posted->>'totalAccrual')::numeric<=0
       OR (SELECT count(*) FROM public.eosb_accrual_runs
         WHERE organization_id='11111111-1111-4111-8111-111111111111' AND month='2111-01-01')<>1
       OR (SELECT count(*) FROM public.eosb_accruals
         WHERE organization_id='11111111-1111-4111-8111-111111111111' AND month='2111-01'
           AND journal_entry_id=journal_id_value)<>employee_count
       OR (SELECT count(*) FROM public.accounting_journal_entries
         WHERE organization_id='11111111-1111-4111-8111-111111111111' AND id=journal_id_value
           AND source_module='eosb' AND status='posted')<>1
       OR (SELECT count(*) FROM public.event_outbox outbox JOIN public.business_events event
         ON event.id=outbox.business_event_id
         WHERE event.source_type='accounting_journal' AND outbox.topic='accounting.journal_posted'
           AND event.payload->>'journal_entry_id'=journal_id_value::text)<>1 THEN
      RAISE EXCEPTION 'Atomic EOSB accrual did not reconcile or replay exactly.';
    END IF;
  END
  $test$;

  -- Inject an outbox failure into every new command family and prove that the
  -- source mutation, command receipt, transfer, and audit all roll back.
  CREATE FUNCTION pg_temp.reject_final_command_outbox()
  RETURNS trigger LANGUAGE plpgsql AS $failure$
  BEGIN
    IF NEW.topic=current_setting('app.test_rejected_outbox_topic',true) THEN
      RAISE EXCEPTION 'Injected final command outbox failure';
    END IF;
    RETURN NEW;
  END
  $failure$;
  CREATE TRIGGER reject_final_command_outbox
    BEFORE INSERT ON public.event_outbox
    FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_final_command_outbox();
  DO $test$
  DECLARE failed boolean; merchant_id_value uuid; owner_agent_id uuid; failure_sim_id uuid;
    prep jsonb; prep_assign jsonb;
  BEGIN
    SELECT merchant.id,merchant.agent_id INTO merchant_id_value,owner_agent_id
    FROM public.merchants merchant
    WHERE merchant.organization_id='11111111-1111-4111-8111-111111111111'
      AND merchant.user_id='e2e2e2e2-e2e2-42e2-82e2-e2e2e2e2e2e2';

    PERFORM set_config('app.test_rejected_outbox_topic','sim.inventory_imported',true); failed:=false;
    BEGIN
      PERFORM public.execute_sim_inventory_command(
        '11111111-1111-4111-8111-111111111111','61616161-6161-4161-8161-616161616161',
        'ad300001-0000-4000-8000-000000000001','ad300002-0000-4000-8000-000000000002',
        'inventory_import','{"sims":[{"iccid":"899999999999991101","provider":"virgin","sim_type":"prepaid","price":50}]}'::jsonb);
    EXCEPTION WHEN raise_exception THEN failed:=SQLERRM='Injected final command outbox failure';
    END;
    IF NOT failed OR EXISTS(SELECT 1 FROM public.sim_units WHERE iccid='899999999999991101')
       OR EXISTS(SELECT 1 FROM public.sim_commerce_commands WHERE idempotency_key='ad300002-0000-4000-8000-000000000002') THEN
      RAISE EXCEPTION 'SIM inventory outbox failure did not roll back the command.';
    END IF;

    PERFORM set_config('app.test_rejected_outbox_topic','accounting.record_changed',true); failed:=false;
    BEGIN
      PERFORM public.execute_accounting_master_command(
        '11111111-1111-4111-8111-111111111111','45454545-4545-4545-8545-454545454545',
        'ad300003-0000-4000-8000-000000000003','ad300004-0000-4000-8000-000000000004',
        'account',NULL,0,'save','{"code":"ATOMIC-FAIL-902","name_ar":"Rollback account","type":"expense","normal_balance":"debit"}'::jsonb);
    EXCEPTION WHEN raise_exception THEN failed:=SQLERRM='Injected final command outbox failure';
    END;
    IF NOT failed OR EXISTS(SELECT 1 FROM public.accounting_accounts WHERE code='ATOMIC-FAIL-902')
       OR EXISTS(SELECT 1 FROM public.accounting_commands WHERE idempotency_key='ad300004-0000-4000-8000-000000000004') THEN
      RAISE EXCEPTION 'Accounting master outbox failure did not roll back the command.';
    END IF;

    PERFORM set_config('app.test_rejected_outbox_topic','promoter.configuration_saved',true); failed:=false;
    BEGIN
      PERFORM public.execute_promoter_configuration_command(
        '11111111-1111-4111-8111-111111111111','61616161-6161-4161-8161-616161616161',
        'ad300005-0000-4000-8000-000000000005','ad300006-0000-4000-8000-000000000006',
        'reference',NULL,0,'save','{"kind":"city","code":"atomic-rollback-city","label_ar":"Rollback city"}'::jsonb);
    EXCEPTION WHEN raise_exception THEN failed:=SQLERRM='Injected final command outbox failure';
    END;
    IF NOT failed OR EXISTS(SELECT 1 FROM public.promoter_reference_values WHERE code='atomic-rollback-city')
       OR EXISTS(SELECT 1 FROM public.promoter_configuration_commands WHERE command_id='ad300006-0000-4000-8000-000000000006') THEN
      RAISE EXCEPTION 'Promoter configuration outbox failure did not roll back the command.';
    END IF;

    PERFORM set_config('app.test_rejected_outbox_topic','accounting.journal_posted',true); failed:=false;
    BEGIN
      PERFORM public.run_eosb_accrual(
        '11111111-1111-4111-8111-111111111111','45454545-4545-4545-8545-454545454545',
        'ad300015-0000-4000-8000-000000000015','ad300016-0000-4000-8000-000000000016','2111-02-01');
    EXCEPTION WHEN raise_exception THEN failed:=SQLERRM='Injected final command outbox failure';
    END;
    IF NOT failed
       OR EXISTS(SELECT 1 FROM public.eosb_accrual_runs
         WHERE organization_id='11111111-1111-4111-8111-111111111111' AND month='2111-02-01')
       OR EXISTS(SELECT 1 FROM public.eosb_accruals
         WHERE organization_id='11111111-1111-4111-8111-111111111111' AND month='2111-02')
       OR EXISTS(SELECT 1 FROM public.accounting_commands
         WHERE idempotency_key='ad300016-0000-4000-8000-000000000016')
       OR EXISTS(SELECT 1 FROM public.accounting_journal_entries
         WHERE organization_id='11111111-1111-4111-8111-111111111111'
           AND source_module='eosb' AND source_id='ad300016-0000-4000-8000-000000000016') THEN
      RAISE EXCEPTION 'EOSB accrual outbox failure did not roll back its journal and employee rows.';
    END IF;

    PERFORM set_config('app.test_rejected_outbox_topic','',true);
    prep:=public.execute_sim_inventory_command(
      '11111111-1111-4111-8111-111111111111','61616161-6161-4161-8161-616161616161',
      'ad300007-0000-4000-8000-000000000007','ad300008-0000-4000-8000-000000000008',
      'inventory_import','{"sims":[{"iccid":"899999999999991102","provider":"virgin","sim_type":"prepaid","price":50}]}'::jsonb);
    failure_sim_id:=(prep->'sim_unit_ids'->>0)::uuid;
    prep_assign:=public.execute_sim_inventory_command(
      '11111111-1111-4111-8111-111111111111','61616161-6161-4161-8161-616161616161',
      'ad300009-0000-4000-8000-000000000009','ad300010-0000-4000-8000-000000000010',
      'inventory_assign',jsonb_build_object('agent_id',owner_agent_id,'sim_ids',jsonb_build_array(failure_sim_id)));
    PERFORM set_config('app.test_rejected_outbox_topic','sim.inventory_assigned_to_merchant',true); failed:=false;
    BEGIN
      PERFORM public.assign_sim_inventory_to_merchant(
        '11111111-1111-4111-8111-111111111111','61616161-6161-4161-8161-616161616161',
        'ad300011-0000-4000-8000-000000000011','ad300012-0000-4000-8000-000000000012',
        merchant_id_value,jsonb_build_array(failure_sim_id),NULL,NULL,NULL,'Rollback handover');
    EXCEPTION WHEN raise_exception THEN failed:=SQLERRM='Injected final command outbox failure';
    END;
    PERFORM set_config('app.test_rejected_outbox_topic','',true);
    IF NOT failed OR (SELECT status::text FROM public.sim_units WHERE id=failure_sim_id)<>'with_agent'
       OR (SELECT current_merchant_id FROM public.sim_units WHERE id=failure_sim_id) IS NOT NULL
       OR EXISTS(SELECT 1 FROM public.sim_transfers WHERE sim_unit_id=failure_sim_id AND transfer_type='assign_to_merchant')
       OR EXISTS(SELECT 1 FROM public.sim_commerce_commands WHERE idempotency_key='ad300012-0000-4000-8000-000000000012') THEN
      RAISE EXCEPTION 'Merchant SIM outbox failure did not roll back the handover.';
    END IF;
  END
  $test$;
  DROP TRIGGER reject_final_command_outbox ON public.event_outbox;

  -- Phase 1 product inventory: receipt commands are replay-safe, confirmation
  -- creates one serialized stock unit and one movement per accepted serial,
  -- and confirmed serials cannot be received twice.
  UPDATE public.sales_products
  SET inventory_enabled = true, tracking_mode = 'serialized',
      sku = 'ATOMIC-PRODUCT-1', default_cost = 60
  WHERE id = 'e2e2e2e2-e2e2-42e2-82e2-e2e2e2e2e2e2';
  DO $test$
  DECLARE
    warehouse_id_value uuid;
    draft_result jsonb;
    replayed_draft jsonb;
    confirmed_result jsonb;
    duplicate_draft jsonb;
    duplicate_denied boolean := false;
    receipt_payload jsonb;
  BEGIN
    SELECT id INTO warehouse_id_value
    FROM public.inventory_warehouses
    WHERE organization_id = '11111111-1111-4111-8111-111111111111'
      AND is_default = true
    LIMIT 1;
    receipt_payload := jsonb_build_object(
      'receipt_id', 'ae100001-0000-4000-8000-000000000001',
      'expected_version', 0,
      'supplier_company_id', 'e1e1e1e1-e1e1-41e1-81e1-e1e1e1e1e1e1',
      'warehouse_id', warehouse_id_value,
      'ownership_type', 'purchased',
      'receipt_date', '2099-07-10',
      'currency', 'SAR',
      'groups', jsonb_build_array(jsonb_build_object(
        'product_id', 'e2e2e2e2-e2e2-42e2-82e2-e2e2e2e2e2e2',
        'unit_cost', 60,
        'planned_sale_price', 100,
        'currency', 'SAR',
        'tax_included', true,
        'condition', 'new',
        'serial_numbers', jsonb_build_array('VG-PHASE1-0001', 'VG-PHASE1-0002')
      ))
    );
    draft_result := public.execute_product_receipt_command(
      '11111111-1111-4111-8111-111111111111',
      '61616161-6161-4161-8161-616161616161',
      'ae100002-0000-4000-8000-000000000002',
      'ae100003-0000-4000-8000-000000000003',
      'receipt_draft_save', receipt_payload
    );
    replayed_draft := public.execute_product_receipt_command(
      '11111111-1111-4111-8111-111111111111',
      '61616161-6161-4161-8161-616161616161',
      'ae100002-0000-4000-8000-000000000002',
      'ae100003-0000-4000-8000-000000000003',
      'receipt_draft_save', receipt_payload
    );
    confirmed_result := public.execute_product_receipt_command(
      '11111111-1111-4111-8111-111111111111',
      '61616161-6161-4161-8161-616161616161',
      'ae100004-0000-4000-8000-000000000004',
      'ae100005-0000-4000-8000-000000000005',
      'receipt_confirm',
      '{"receipt_id":"ae100001-0000-4000-8000-000000000001","expected_version":1}'::jsonb
    );

    duplicate_draft := public.execute_product_receipt_command(
      '11111111-1111-4111-8111-111111111111',
      '61616161-6161-4161-8161-616161616161',
      'ae100006-0000-4000-8000-000000000006',
      'ae100007-0000-4000-8000-000000000007',
      'receipt_draft_save',
      receipt_payload || '{"receipt_id":"ae100008-0000-4000-8000-000000000008"}'::jsonb
    );
    BEGIN
      PERFORM public.execute_product_receipt_command(
        '11111111-1111-4111-8111-111111111111',
        '61616161-6161-4161-8161-616161616161',
        'ae100009-0000-4000-8000-000000000009',
        'ae100010-0000-4000-8000-000000000010',
        'receipt_confirm',
        '{"receipt_id":"ae100008-0000-4000-8000-000000000008","expected_version":1}'::jsonb
      );
    EXCEPTION WHEN unique_violation THEN
      duplicate_denied := true;
    END;

    IF draft_result IS DISTINCT FROM replayed_draft
       OR confirmed_result->'receipt'->>'status' <> 'confirmed'
       OR confirmed_result->'receipt'->>'accounting_status' <> 'pending'
       OR (confirmed_result->'receipt'->>'total_units')::integer <> 2
       OR (confirmed_result->'receipt'->>'physical_total_cost')::numeric <> 120
       OR (confirmed_result->'receipt'->>'expected_sales_value')::numeric <> 200
       OR NOT duplicate_denied
       OR (SELECT count(*) FROM public.product_inventory_units
           WHERE receipt_id = 'ae100001-0000-4000-8000-000000000001') <> 2
       OR (SELECT count(*) FROM public.product_inventory_movements
           WHERE receipt_id = 'ae100001-0000-4000-8000-000000000001'
             AND movement_type = 'receipt') <> 2
       OR (SELECT count(*) FROM public.event_outbox
           WHERE org_id = '11111111-1111-4111-8111-111111111111'
             AND topic IN (
               'product_inventory.receipt_draft_saved',
               'product_inventory.receipt_confirmed'
             )
             AND payload->>'receipt_id' = 'ae100001-0000-4000-8000-000000000001') <> 2 THEN
      RAISE EXCEPTION 'Product receipt idempotency, confirmation, valuation, serial uniqueness, or event proof failed.';
    END IF;
  END
  $test$;

  -- Phase 2 product inventory: every workbook row and its clean private source
  -- are retained, partial commits are denied, price groups are formed
  -- atomically, and the completed receipt reuses Phase 1 stock confirmation.
  DO $test$
  DECLARE
    warehouse_id_value uuid;
    preview_rows jsonb;
    preview_result jsonb;
    preview_replay jsonb;
    commit_result jsonb;
    commit_replay jsonb;
    confirmed_result jsonb;
    partial_denied boolean := false;
  BEGIN
    SELECT id INTO warehouse_id_value
    FROM public.inventory_warehouses
    WHERE organization_id = '11111111-1111-4111-8111-111111111111'
      AND is_default = true
    LIMIT 1;
    preview_rows := jsonb_build_array(
      jsonb_build_object(
        'row_number', 2, 'raw_data', '{"product_sku":"ATOMIC-PRODUCT-1","serial_number":"VG-PHASE2-0001"}'::jsonb,
        'product_sku', 'ATOMIC-PRODUCT-1', 'product_name', 'Atomic Sales Product',
        'model', '', 'product_id', 'e2e2e2e2-e2e2-42e2-82e2-e2e2e2e2e2e2',
        'serial_number', 'VG-PHASE2-0001', 'normalized_serial', 'VGPHASE20001',
        'barcode', '', 'unit_cost', 60, 'planned_sale_price', 100,
        'currency', 'SAR', 'condition', 'new', 'status', 'valid',
        'confidence', 1, 'validation_errors', '[]'::jsonb, 'validation_warnings', '[]'::jsonb
      ),
      jsonb_build_object(
        'row_number', 3, 'raw_data', '{"product_sku":"ATOMIC-PRODUCT-1","serial_number":"VG-PHASE2-0002"}'::jsonb,
        'product_sku', 'ATOMIC-PRODUCT-1', 'product_name', 'Atomic Sales Product',
        'model', '', 'product_id', 'e2e2e2e2-e2e2-42e2-82e2-e2e2e2e2e2e2',
        'serial_number', 'VG-PHASE2-0002', 'normalized_serial', 'VGPHASE20002',
        'barcode', '', 'unit_cost', 60, 'planned_sale_price', 100,
        'currency', 'SAR', 'condition', 'new', 'status', 'valid',
        'confidence', 1, 'validation_errors', '[]'::jsonb, 'validation_warnings', '[]'::jsonb
      ),
      jsonb_build_object(
        'row_number', 4, 'raw_data', '{"product_sku":"ATOMIC-PRODUCT-1","serial_number":"VG-PHASE2-0003"}'::jsonb,
        'product_sku', 'ATOMIC-PRODUCT-1', 'product_name', 'Atomic Sales Product',
        'model', '', 'product_id', 'e2e2e2e2-e2e2-42e2-82e2-e2e2e2e2e2e2',
        'serial_number', 'VG-PHASE2-0003', 'normalized_serial', 'VGPHASE20003',
        'barcode', '', 'unit_cost', 65, 'planned_sale_price', 110,
        'currency', 'SAR', 'condition', 'open_box', 'status', 'warning',
        'confidence', 1, 'validation_errors', '[]'::jsonb,
        'validation_warnings', '["Serial number also appears in another draft receipt."]'::jsonb
      )
    );

    preview_result := public.execute_product_workbook_preview(
      '11111111-1111-4111-8111-111111111111',
      '61616161-6161-4161-8161-616161616161',
      'ae200002-0000-4000-8000-000000000002',
      'ae200003-0000-4000-8000-000000000003',
      'ae200001-0000-4000-8000-000000000001',
      'ae200004-0000-4000-8000-000000000004',
      'ae200005-0000-4000-8000-000000000005',
      jsonb_build_object(
        'supplier_company_id', 'e1e1e1e1-e1e1-41e1-81e1-e1e1e1e1e1e1',
        'warehouse_id', warehouse_id_value, 'ownership_type', 'purchased',
        'receipt_date', '2099-07-11', 'currency', 'SAR',
        'delivery_note_no', 'VIRGIN-DN-PHASE2', 'supplier_invoice_no', 'VIRGIN-INV-PHASE2'
      ),
      jsonb_build_object(
        'bucket', 'product-inventory-imports',
        'path', '11111111-1111-4111-8111-111111111111/ae200001-0000-4000-8000-000000000001/ae200003-0000-4000-8000-000000000003/virgin-phase2.csv',
        'filename', 'virgin-phase2.csv', 'type', 'text/csv', 'source_type', 'csv',
        'size_bytes', 512, 'sha256', repeat('a', 64), 'scan_status', 'clean',
        'scan_engine', 'database-smoke-test', 'scanned_at', now(),
        'headers', jsonb_build_array('product_sku', 'serial_number', 'unit_cost', 'planned_sale_price')
      ),
      preview_rows
    );
    preview_replay := public.execute_product_workbook_preview(
      '11111111-1111-4111-8111-111111111111',
      '61616161-6161-4161-8161-616161616161',
      'ae200002-0000-4000-8000-000000000002',
      'ae200003-0000-4000-8000-000000000003',
      'ae200001-0000-4000-8000-000000000001',
      'ae200004-0000-4000-8000-000000000004',
      'ae200005-0000-4000-8000-000000000005',
      jsonb_build_object(
        'supplier_company_id', 'e1e1e1e1-e1e1-41e1-81e1-e1e1e1e1e1e1',
        'warehouse_id', warehouse_id_value, 'ownership_type', 'purchased',
        'receipt_date', '2099-07-11', 'currency', 'SAR',
        'delivery_note_no', 'VIRGIN-DN-PHASE2', 'supplier_invoice_no', 'VIRGIN-INV-PHASE2'
      ),
      jsonb_build_object(
        'bucket', 'product-inventory-imports',
        'path', '11111111-1111-4111-8111-111111111111/ae200001-0000-4000-8000-000000000001/ae200003-0000-4000-8000-000000000003/virgin-phase2.csv',
        'filename', 'virgin-phase2.csv', 'type', 'text/csv', 'source_type', 'csv',
        'size_bytes', 512, 'sha256', repeat('a', 64), 'scan_status', 'clean',
        'scan_engine', 'database-smoke-test', 'scanned_at', now(),
        'headers', jsonb_build_array('product_sku', 'serial_number', 'unit_cost', 'planned_sale_price')
      ),
      preview_rows
    );

    BEGIN
      PERFORM public.execute_product_workbook_commit(
        '11111111-1111-4111-8111-111111111111',
        '61616161-6161-4161-8161-616161616161',
        'ae200006-0000-4000-8000-000000000006',
        'ae200007-0000-4000-8000-000000000007',
        'ae200001-0000-4000-8000-000000000001',
        'ae200004-0000-4000-8000-000000000004',
        1, preview_rows - 2
      );
    EXCEPTION WHEN check_violation THEN
      partial_denied := true;
    END;

    commit_result := public.execute_product_workbook_commit(
      '11111111-1111-4111-8111-111111111111',
      '61616161-6161-4161-8161-616161616161',
      'ae200008-0000-4000-8000-000000000008',
      'ae200009-0000-4000-8000-000000000009',
      'ae200001-0000-4000-8000-000000000001',
      'ae200004-0000-4000-8000-000000000004',
      1, preview_rows
    );
    commit_replay := public.execute_product_workbook_commit(
      '11111111-1111-4111-8111-111111111111',
      '61616161-6161-4161-8161-616161616161',
      'ae200008-0000-4000-8000-000000000008',
      'ae200009-0000-4000-8000-000000000009',
      'ae200001-0000-4000-8000-000000000001',
      'ae200004-0000-4000-8000-000000000004',
      1, preview_rows
    );
    confirmed_result := public.execute_product_receipt_command(
      '11111111-1111-4111-8111-111111111111',
      '61616161-6161-4161-8161-616161616161',
      'ae200010-0000-4000-8000-000000000010',
      'ae200011-0000-4000-8000-000000000011',
      'receipt_confirm',
      '{"receipt_id":"ae200001-0000-4000-8000-000000000001","expected_version":2}'::jsonb
    );

    IF preview_result IS DISTINCT FROM preview_replay
       OR commit_result IS DISTINCT FROM commit_replay
       OR NOT partial_denied
       OR (commit_result->>'group_count')::integer <> 2
       OR commit_result->'receipt'->>'status' <> 'ready_to_confirm'
       OR confirmed_result->'receipt'->>'status' <> 'confirmed'
       OR (confirmed_result->'receipt'->>'total_units')::integer <> 3
       OR (confirmed_result->'receipt'->>'physical_total_cost')::numeric <> 185
       OR (confirmed_result->'receipt'->>'expected_sales_value')::numeric <> 310
       OR (SELECT count(*) FROM public.product_inventory_import_rows
           WHERE source_id = 'ae200004-0000-4000-8000-000000000004') <> 3
       OR (SELECT count(*) FROM public.product_receipt_lines
           WHERE receipt_id = 'ae200001-0000-4000-8000-000000000001') <> 2
       OR (SELECT count(*) FROM public.product_receipt_candidates
           WHERE receipt_id = 'ae200001-0000-4000-8000-000000000001'
             AND source_id = 'ae200004-0000-4000-8000-000000000004'
             AND source_reference LIKE 'row:%') <> 3
       OR (SELECT count(*) FROM public.product_inventory_units
           WHERE receipt_id = 'ae200001-0000-4000-8000-000000000001') <> 3
       OR NOT EXISTS (
         SELECT 1 FROM public.product_receipt_sources source
         JOIN public.managed_files file ON file.id = source.managed_file_id
         WHERE source.id = 'ae200004-0000-4000-8000-000000000004'
           AND source.committed_at IS NOT NULL
           AND source.file_sha256 = repeat('a', 64)
           AND source.valid_rows = 2
           AND source.warning_rows = 1
           AND file.bucket_id = 'product-inventory-imports'
           AND file.scan_status = 'clean'
       )
       OR (SELECT count(*) FROM public.event_outbox
           WHERE payload->>'receipt_id' = 'ae200001-0000-4000-8000-000000000001'
             AND topic IN (
               'product_inventory.workbook_previewed',
               'product_inventory.workbook_committed',
               'product_inventory.receipt_draft_saved',
               'product_inventory.receipt_confirmed'
             )) <> 4 THEN
      RAISE EXCEPTION 'Workbook evidence, replay, full-row commit, grouping, or stock confirmation failed.';
    END IF;
  END
  $test$;

  -- Phase 3 product inventory: private image evidence and local extraction
  -- metadata are retained, every candidate must be reviewed, warnings require
  -- explicit acceptance, corrected labels may become manager-approved aliases,
  -- and priced photo candidates reuse the Phase 1 stock command.
  DO $test$
  DECLARE
    warehouse_id_value uuid;
    preview_sources jsonb;
    preview_candidates jsonb;
    commit_candidates jsonb;
    preview_result jsonb;
    preview_replay jsonb;
    commit_result jsonb;
    commit_replay jsonb;
    confirmed_result jsonb;
    partial_denied boolean := false;
    warning_denied boolean := false;
  BEGIN
    SELECT id INTO warehouse_id_value
    FROM public.inventory_warehouses
    WHERE organization_id = '11111111-1111-4111-8111-111111111111'
      AND is_default = true
    LIMIT 1;

    preview_sources := jsonb_build_array(
      jsonb_build_object(
        'source_id', 'ae300004-0000-4000-8000-000000000004',
        'managed_file_id', 'ae300005-0000-4000-8000-000000000005',
        'file', jsonb_build_object(
          'bucket', 'product-inventory-photos',
          'path', '11111111-1111-4111-8111-111111111111/ae300001-0000-4000-8000-000000000001/ae300003-0000-4000-8000-000000000003/label-1.jpg',
          'filename', 'label-1.jpg', 'type', 'image/jpeg',
          'size_bytes', 2048, 'sha256', repeat('b', 64),
          'scan_status', 'clean', 'scan_engine', 'database-smoke-test',
          'scanned_at', '2099-07-12T00:00:00Z'
        ),
        'extraction', jsonb_build_object(
          'engine', 'tesseract-zxing-local', 'version', 'local-product-label-v1',
          'raw_text', E'Product: Virgin Photo Router\\nS/N: VG-PHASE3-O001\\nS/N: VG-PHASE3-0002',
          'ocr_confidence', 82, 'barcode_values', jsonb_build_array('6280000000001'),
          'bounding_boxes', jsonb_build_array(jsonb_build_object(
            'text', 'Virgin', 'confidence', 90, 'x0', 10, 'y0', 10, 'x1', 80, 'y1', 30
          ))
        )
      ),
      jsonb_build_object(
        'source_id', 'ae300006-0000-4000-8000-000000000006',
        'managed_file_id', 'ae300007-0000-4000-8000-000000000007',
        'file', jsonb_build_object(
          'bucket', 'product-inventory-photos',
          'path', '11111111-1111-4111-8111-111111111111/ae300001-0000-4000-8000-000000000001/ae300003-0000-4000-8000-000000000003/label-2.png',
          'filename', 'label-2.png', 'type', 'image/png',
          'size_bytes', 3072, 'sha256', repeat('c', 64),
          'scan_status', 'clean', 'scan_engine', 'database-smoke-test',
          'scanned_at', '2099-07-12T00:00:00Z'
        ),
        'extraction', jsonb_build_object(
          'engine', 'tesseract-zxing-local', 'version', 'local-product-label-v1',
          'raw_text', E'SKU: ATOMIC-PRODUCT-1\\nSerial: VG-PHASE3-0003',
          'ocr_confidence', 97, 'barcode_values', '[]'::jsonb,
          'bounding_boxes', '[]'::jsonb
        )
      )
    );

    preview_candidates := jsonb_build_array(
      jsonb_build_object(
        'source_id', 'ae300004-0000-4000-8000-000000000004',
        'candidate_index', 1, 'raw_product_name', 'Virgin Photo Router',
        'raw_sku', '', 'raw_model', '', 'raw_serial', 'VG-PHASE3-O001',
        'raw_barcode', '6280000000001', 'product_id', '',
        'serial_number', 'VG-PHASE3-O001', 'normalized_serial', 'VGPHASE3O001',
        'unit_cost', null, 'planned_sale_price', null, 'currency', 'SAR',
        'condition', 'new', 'status', 'unmatched', 'confidence', 0,
        'match_method', 'none',
        'validation_errors', jsonb_build_array('Product could not be matched.'),
        'validation_warnings', '[]'::jsonb
      ),
      jsonb_build_object(
        'source_id', 'ae300004-0000-4000-8000-000000000004',
        'candidate_index', 2, 'raw_product_name', 'Atomic Sales Product',
        'raw_sku', 'ATOMIC-PRODUCT-1', 'raw_model', '',
        'raw_serial', 'VG-PHASE3-0002', 'raw_barcode', '',
        'product_id', 'e2e2e2e2-e2e2-42e2-82e2-e2e2e2e2e2e2',
        'serial_number', 'VG-PHASE3-0002', 'normalized_serial', 'VGPHASE30002',
        'unit_cost', 60, 'planned_sale_price', 100, 'currency', 'SAR',
        'condition', 'new', 'status', 'warning', 'confidence', 0.82,
        'match_method', 'sku', 'validation_errors', '[]'::jsonb,
        'validation_warnings', jsonb_build_array('Extraction confidence is below 90%.')
      ),
      jsonb_build_object(
        'source_id', 'ae300006-0000-4000-8000-000000000006',
        'candidate_index', 1, 'raw_product_name', 'Atomic Sales Product',
        'raw_sku', 'ATOMIC-PRODUCT-1', 'raw_model', '',
        'raw_serial', 'VG-PHASE3-0003', 'raw_barcode', '',
        'product_id', 'e2e2e2e2-e2e2-42e2-82e2-e2e2e2e2e2e2',
        'serial_number', 'VG-PHASE3-0003', 'normalized_serial', 'VGPHASE30003',
        'unit_cost', 65, 'planned_sale_price', 110, 'currency', 'SAR',
        'condition', 'open_box', 'status', 'valid', 'confidence', 0.97,
        'match_method', 'sku', 'validation_errors', '[]'::jsonb,
        'validation_warnings', '[]'::jsonb
      )
    );

    preview_result := public.execute_product_photo_preview(
      '11111111-1111-4111-8111-111111111111',
      '61616161-6161-4161-8161-616161616161',
      'ae300002-0000-4000-8000-000000000002',
      'ae300003-0000-4000-8000-000000000003',
      'ae300001-0000-4000-8000-000000000001',
      jsonb_build_object(
        'supplier_company_id', 'e1e1e1e1-e1e1-41e1-81e1-e1e1e1e1e1e1',
        'warehouse_id', warehouse_id_value, 'ownership_type', 'purchased',
        'receipt_date', '2099-07-12', 'currency', 'SAR',
        'delivery_note_no', 'VIRGIN-DN-PHASE3',
        'supplier_invoice_no', 'VIRGIN-INV-PHASE3'
      ),
      preview_sources, preview_candidates
    );
    preview_replay := public.execute_product_photo_preview(
      '11111111-1111-4111-8111-111111111111',
      '61616161-6161-4161-8161-616161616161',
      'ae300002-0000-4000-8000-000000000002',
      'ae300003-0000-4000-8000-000000000003',
      'ae300001-0000-4000-8000-000000000001',
      jsonb_build_object(
        'supplier_company_id', 'e1e1e1e1-e1e1-41e1-81e1-e1e1e1e1e1e1',
        'warehouse_id', warehouse_id_value, 'ownership_type', 'purchased',
        'receipt_date', '2099-07-12', 'currency', 'SAR',
        'delivery_note_no', 'VIRGIN-DN-PHASE3',
        'supplier_invoice_no', 'VIRGIN-INV-PHASE3'
      ),
      preview_sources, preview_candidates
    );

    commit_candidates := jsonb_build_array(
      jsonb_build_object(
        'source_id', 'ae300004-0000-4000-8000-000000000004',
        'candidate_index', 1, 'raw_product_name', 'Virgin Photo Router',
        'raw_sku', '', 'raw_model', '', 'raw_serial', 'VG-PHASE3-O001',
        'raw_barcode', '6280000000001',
        'product_id', 'e2e2e2e2-e2e2-42e2-82e2-e2e2e2e2e2e2',
        'serial_number', 'VG-PHASE3-0001', 'normalized_serial', 'VGPHASE30001',
        'unit_cost', 60, 'planned_sale_price', 100, 'currency', 'SAR',
        'condition', 'new', 'status', 'warning', 'confidence', 0.6,
        'match_method', 'none', 'validation_errors', '[]'::jsonb,
        'validation_warnings', jsonb_build_array('Extraction confidence is below 90%.'),
        'save_as_alias', true
      ),
      preview_candidates->1,
      preview_candidates->2
    );

    BEGIN
      PERFORM public.execute_product_photo_commit(
        '11111111-1111-4111-8111-111111111111',
        '61616161-6161-4161-8161-616161616161',
        'ae300008-0000-4000-8000-000000000008',
        'ae300009-0000-4000-8000-000000000009',
        'ae300001-0000-4000-8000-000000000001',
        1, true, commit_candidates - 2
      );
    EXCEPTION WHEN check_violation THEN
      partial_denied := true;
    END;

    BEGIN
      PERFORM public.execute_product_photo_commit(
        '11111111-1111-4111-8111-111111111111',
        '61616161-6161-4161-8161-616161616161',
        'ae300010-0000-4000-8000-000000000010',
        'ae300011-0000-4000-8000-000000000011',
        'ae300001-0000-4000-8000-000000000001',
        1, false, commit_candidates
      );
    EXCEPTION WHEN check_violation THEN
      warning_denied := true;
    END;

    commit_result := public.execute_product_photo_commit(
      '11111111-1111-4111-8111-111111111111',
      '61616161-6161-4161-8161-616161616161',
      'ae300012-0000-4000-8000-000000000012',
      'ae300013-0000-4000-8000-000000000013',
      'ae300001-0000-4000-8000-000000000001',
      1, true, commit_candidates
    );
    commit_replay := public.execute_product_photo_commit(
      '11111111-1111-4111-8111-111111111111',
      '61616161-6161-4161-8161-616161616161',
      'ae300012-0000-4000-8000-000000000012',
      'ae300013-0000-4000-8000-000000000013',
      'ae300001-0000-4000-8000-000000000001',
      1, true, commit_candidates
    );
    confirmed_result := public.execute_product_receipt_command(
      '11111111-1111-4111-8111-111111111111',
      '61616161-6161-4161-8161-616161616161',
      'ae300014-0000-4000-8000-000000000014',
      'ae300015-0000-4000-8000-000000000015',
      'receipt_confirm',
      '{"receipt_id":"ae300001-0000-4000-8000-000000000001","expected_version":2}'::jsonb
    );

    IF preview_result IS DISTINCT FROM preview_replay
       OR commit_result IS DISTINCT FROM commit_replay
       OR NOT partial_denied OR NOT warning_denied
       OR (commit_result->>'group_count')::integer <> 2
       OR commit_result->'receipt'->>'status' <> 'ready_to_confirm'
       OR confirmed_result->'receipt'->>'status' <> 'confirmed'
       OR (confirmed_result->'receipt'->>'total_units')::integer <> 3
       OR (confirmed_result->'receipt'->>'physical_total_cost')::numeric <> 185
       OR (confirmed_result->'receipt'->>'expected_sales_value')::numeric <> 310
       OR (SELECT count(*) FROM public.product_inventory_photo_candidates
           WHERE receipt_id = 'ae300001-0000-4000-8000-000000000001') <> 3
       OR (SELECT count(*) FROM public.product_inventory_photo_candidates
           WHERE receipt_id = 'ae300001-0000-4000-8000-000000000001'
             AND product_corrected AND serial_corrected
             AND reviewed_by = '61616161-6161-4161-8161-616161616161') <> 1
       OR (SELECT count(*) FROM public.product_receipt_candidates
           WHERE receipt_id = 'ae300001-0000-4000-8000-000000000001'
             AND source_id IS NOT NULL AND source_reference LIKE 'photo:%') <> 3
       OR (SELECT count(*) FROM public.product_inventory_units
           WHERE receipt_id = 'ae300001-0000-4000-8000-000000000001') <> 3
       OR (SELECT count(*) FROM public.product_receipt_sources source
           JOIN public.managed_files file ON file.id = source.managed_file_id
           WHERE source.receipt_id = 'ae300001-0000-4000-8000-000000000001'
             AND source.source_type = 'photo'
             AND source.committed_at IS NOT NULL
             AND source.extraction_provider = 'tesseract-zxing-local'
             AND source.extraction_version = 'local-product-label-v1'
             AND file.bucket_id = 'product-inventory-photos'
             AND file.scan_status = 'clean') <> 2
       OR NOT EXISTS (
         SELECT 1 FROM public.product_inventory_aliases
         WHERE organization_id = '11111111-1111-4111-8111-111111111111'
           AND product_id = 'e2e2e2e2-e2e2-42e2-82e2-e2e2e2e2e2e2'
           AND normalized_value = 'virginphotorouter'
           AND source = 'photo_correction' AND is_approved
           AND approved_by = '61616161-6161-4161-8161-616161616161'
       )
       OR (SELECT count(*) FROM public.event_outbox
           WHERE payload->>'receipt_id' = 'ae300001-0000-4000-8000-000000000001'
             AND topic IN (
               'product_inventory.photo_previewed',
               'product_inventory.photo_committed',
               'product_inventory.receipt_draft_saved',
               'product_inventory.receipt_confirmed'
             )) <> 4 THEN
      RAISE EXCEPTION 'Photo evidence, replay, review, alias, grouping, or stock confirmation failed.';
    END IF;
  END
  $test$;

  -- Phase 4 product inventory: serialized units move through manager handover,
  -- agent acknowledgment, controlled price exceptions, sale, collection,
  -- unsold return, and manager void without losing their cost or audit trail.
  INSERT INTO auth.users (id, email) VALUES
    ('71717171-7171-4171-8171-717171717171', 'product-agent-a@example.test');
  INSERT INTO public.org_members (org_id, user_id, role) VALUES
    ('11111111-1111-4111-8111-111111111111',
     '71717171-7171-4171-8171-717171717171', 'field_agent');
  UPDATE public.profiles
  SET org_id = '11111111-1111-4111-8111-111111111111',
      account_status = 'Active'
  WHERE user_id = '71717171-7171-4171-8171-717171717171';
  INSERT INTO public.employees (
    id, org_id, user_id, full_name, email, job_title, status, lifecycle_status
  ) VALUES (
    '72727272-7272-4272-8272-727272727272',
    '11111111-1111-4111-8111-111111111111',
    '71717171-7171-4171-8171-717171717171',
    'Atomic Product Agent', 'product-agent-a@example.test',
    'Field Agent', 'Active', 'active'
  );
  SELECT set_config('app.sales_identity_command', 'trusted', false);
  INSERT INTO public.field_agents (
    id, organization_id, user_id, full_name, phone, national_id,
    commission_rate, status, created_by
  ) VALUES (
    'b7b7b7b7-b7b7-47b7-87b7-b7b7b7b7b7b7',
    '11111111-1111-4111-8111-111111111111',
    '71717171-7171-4171-8171-717171717171',
    'Atomic Product Agent', '0500000007', 'PRODUCT-SMOKE-AGENT',
    5, 'active', '61616161-6161-4161-8161-616161616161'
  );
  SELECT set_config('app.sales_identity_command', '', false);

  DO $test$
  DECLARE
    warehouse_id_value uuid;
    unit_ids uuid[];
    handover_result jsonb;
    handover_replay jsonb;
    accepted_result jsonb;
    accepted_replay jsonb;
    override_result jsonb;
    override_replay jsonb;
    review_result jsonb;
    sale_result jsonb;
    sale_replay jsonb;
    collection_result jsonb;
    collection_replay jsonb;
    return_result jsonb;
    return_replay jsonb;
    second_handover jsonb;
    second_sale jsonb;
    void_result jsonb;
    third_handover jsonb;
    policy_denied boolean := false;
  BEGIN
    SELECT id INTO warehouse_id_value
    FROM public.inventory_warehouses
    WHERE organization_id = '11111111-1111-4111-8111-111111111111'
      AND is_default
    LIMIT 1;
    SELECT array_agg(id ORDER BY normalized_serial_number) INTO unit_ids
    FROM public.product_inventory_units
    WHERE receipt_id = 'ae300001-0000-4000-8000-000000000001';

    handover_result := public.execute_product_commerce_command(
      '11111111-1111-4111-8111-111111111111',
      '61616161-6161-4161-8161-616161616161',
      'ae400001-0000-4000-8000-000000000001',
      'ae400002-0000-4000-8000-000000000002',
      'handover_issue',
      jsonb_build_object(
        'handover_id', 'ae400003-0000-4000-8000-000000000003',
        'warehouse_id', warehouse_id_value,
        'agent_id', 'b7b7b7b7-b7b7-47b7-87b7-b7b7b7b7b7b7',
        'require_acknowledgment', true,
        'notes', 'Phase 4 acknowledged custody',
        'units', jsonb_build_array(
          jsonb_build_object('unit_id', unit_ids[1], 'minimum_sale_price', 90, 'maximum_sale_price', 110),
          jsonb_build_object('unit_id', unit_ids[2], 'minimum_sale_price', 90, 'maximum_sale_price', 110)
        )
      )
    );
    handover_replay := public.execute_product_commerce_command(
      '11111111-1111-4111-8111-111111111111',
      '61616161-6161-4161-8161-616161616161',
      'ae400001-0000-4000-8000-000000000001',
      'ae400002-0000-4000-8000-000000000002',
      'handover_issue',
      jsonb_build_object(
        'handover_id', 'ae400003-0000-4000-8000-000000000003',
        'warehouse_id', warehouse_id_value,
        'agent_id', 'b7b7b7b7-b7b7-47b7-87b7-b7b7b7b7b7b7',
        'require_acknowledgment', true,
        'notes', 'Phase 4 acknowledged custody',
        'units', jsonb_build_array(
          jsonb_build_object('unit_id', unit_ids[1], 'minimum_sale_price', 90, 'maximum_sale_price', 110),
          jsonb_build_object('unit_id', unit_ids[2], 'minimum_sale_price', 90, 'maximum_sale_price', 110)
        )
      )
    );
    accepted_result := public.execute_product_commerce_command(
      '11111111-1111-4111-8111-111111111111',
      '71717171-7171-4171-8171-717171717171',
      'ae400004-0000-4000-8000-000000000004',
      'ae400005-0000-4000-8000-000000000005',
      'handover_accept',
      '{"handover_id":"ae400003-0000-4000-8000-000000000003","expected_version":1}'::jsonb
    );
    accepted_replay := public.execute_product_commerce_command(
      '11111111-1111-4111-8111-111111111111',
      '71717171-7171-4171-8171-717171717171',
      'ae400004-0000-4000-8000-000000000004',
      'ae400005-0000-4000-8000-000000000005',
      'handover_accept',
      '{"handover_id":"ae400003-0000-4000-8000-000000000003","expected_version":1}'::jsonb
    );
    override_result := public.execute_product_commerce_command(
      '11111111-1111-4111-8111-111111111111',
      '71717171-7171-4171-8171-717171717171',
      'ae400006-0000-4000-8000-000000000006',
      'ae400007-0000-4000-8000-000000000007',
      'price_override_request',
      jsonb_build_object(
        'request_id', 'ae400008-0000-4000-8000-000000000008',
        'unit_id', unit_ids[1], 'requested_price', 50,
        'reason', 'Controlled Phase 4 commercial exception'
      )
    );
    override_replay := public.execute_product_commerce_command(
      '11111111-1111-4111-8111-111111111111',
      '71717171-7171-4171-8171-717171717171',
      'ae400006-0000-4000-8000-000000000006',
      'ae400007-0000-4000-8000-000000000007',
      'price_override_request',
      jsonb_build_object(
        'request_id', 'ae400008-0000-4000-8000-000000000008',
        'unit_id', unit_ids[1], 'requested_price', 50,
        'reason', 'Controlled Phase 4 commercial exception'
      )
    );
    BEGIN
      PERFORM public.execute_product_commerce_command(
        '11111111-1111-4111-8111-111111111111',
        '71717171-7171-4171-8171-717171717171',
        'ae400009-0000-4000-8000-000000000009',
        'ae400010-0000-4000-8000-000000000010',
        'sale',
        jsonb_build_object(
          'sale_id', 'ae400011-0000-4000-8000-000000000011',
          'unit_id', unit_ids[1], 'actual_sale_price', 50,
          'sale_date', '2099-07-13', 'payment_method', 'cash'
        )
      );
    EXCEPTION WHEN check_violation THEN
      policy_denied := true;
    END;
    review_result := public.execute_product_commerce_command(
      '11111111-1111-4111-8111-111111111111',
      '61616161-6161-4161-8161-616161616161',
      'ae400012-0000-4000-8000-000000000012',
      'ae400013-0000-4000-8000-000000000013',
      'price_override_review',
      '{"request_id":"ae400008-0000-4000-8000-000000000008","expected_version":1,"decision":"approved","review_note":"Approved for atomic proof"}'::jsonb
    );
    sale_result := public.execute_product_commerce_command(
      '11111111-1111-4111-8111-111111111111',
      '71717171-7171-4171-8171-717171717171',
      'ae400014-0000-4000-8000-000000000014',
      'ae400015-0000-4000-8000-000000000015',
      'sale',
      jsonb_build_object(
        'sale_id', 'ae400016-0000-4000-8000-000000000016',
        'unit_id', unit_ids[1], 'actual_sale_price', 50,
        'sale_date', '2099-07-13', 'payment_method', 'cash',
        'customer_name', 'Phase 4 buyer',
        'price_override_request_id', 'ae400008-0000-4000-8000-000000000008'
      )
    );
    sale_replay := public.execute_product_commerce_command(
      '11111111-1111-4111-8111-111111111111',
      '71717171-7171-4171-8171-717171717171',
      'ae400014-0000-4000-8000-000000000014',
      'ae400015-0000-4000-8000-000000000015',
      'sale',
      jsonb_build_object(
        'sale_id', 'ae400016-0000-4000-8000-000000000016',
        'unit_id', unit_ids[1], 'actual_sale_price', 50,
        'sale_date', '2099-07-13', 'payment_method', 'cash',
        'customer_name', 'Phase 4 buyer',
        'price_override_request_id', 'ae400008-0000-4000-8000-000000000008'
      )
    );
    collection_result := public.execute_product_commerce_command(
      '11111111-1111-4111-8111-111111111111',
      '61616161-6161-4161-8161-616161616161',
      'ae400017-0000-4000-8000-000000000017',
      'ae400018-0000-4000-8000-000000000018',
      'collection_post',
      '{"collection_id":"ae400019-0000-4000-8000-000000000019","agent_id":"b7b7b7b7-b7b7-47b7-87b7-b7b7b7b7b7b7","amount":20,"payment_method":"cash","collection_date":"2099-07-13","reference":"PHASE4-COLLECT"}'::jsonb
    );
    collection_replay := public.execute_product_commerce_command(
      '11111111-1111-4111-8111-111111111111',
      '61616161-6161-4161-8161-616161616161',
      'ae400017-0000-4000-8000-000000000017',
      'ae400018-0000-4000-8000-000000000018',
      'collection_post',
      '{"collection_id":"ae400019-0000-4000-8000-000000000019","agent_id":"b7b7b7b7-b7b7-47b7-87b7-b7b7b7b7b7b7","amount":20,"payment_method":"cash","collection_date":"2099-07-13","reference":"PHASE4-COLLECT"}'::jsonb
    );
    return_result := public.execute_product_commerce_command(
      '11111111-1111-4111-8111-111111111111',
      '71717171-7171-4171-8171-717171717171',
      'ae400020-0000-4000-8000-000000000020',
      'ae400021-0000-4000-8000-000000000021',
      'agent_return',
      jsonb_build_object(
        'return_id', 'ae400022-0000-4000-8000-000000000022',
        'warehouse_id', warehouse_id_value,
        'unit_ids', jsonb_build_array(unit_ids[2]),
        'reason', 'Unsold stock returned intact'
      )
    );
    return_replay := public.execute_product_commerce_command(
      '11111111-1111-4111-8111-111111111111',
      '71717171-7171-4171-8171-717171717171',
      'ae400020-0000-4000-8000-000000000020',
      'ae400021-0000-4000-8000-000000000021',
      'agent_return',
      jsonb_build_object(
        'return_id', 'ae400022-0000-4000-8000-000000000022',
        'warehouse_id', warehouse_id_value,
        'unit_ids', jsonb_build_array(unit_ids[2]),
        'reason', 'Unsold stock returned intact'
      )
    );
    second_handover := public.execute_product_commerce_command(
      '11111111-1111-4111-8111-111111111111',
      '61616161-6161-4161-8161-616161616161',
      'ae400023-0000-4000-8000-000000000023',
      'ae400024-0000-4000-8000-000000000024',
      'handover_issue',
      jsonb_build_object(
        'handover_id', 'ae400025-0000-4000-8000-000000000025',
        'warehouse_id', warehouse_id_value,
        'agent_id', 'b7b7b7b7-b7b7-47b7-87b7-b7b7b7b7b7b7',
        'require_acknowledgment', false,
        'units', jsonb_build_array(jsonb_build_object(
          'unit_id', unit_ids[2], 'minimum_sale_price', 90, 'maximum_sale_price', 110
        ))
      )
    );
    second_sale := public.execute_product_commerce_command(
      '11111111-1111-4111-8111-111111111111',
      '71717171-7171-4171-8171-717171717171',
      'ae400026-0000-4000-8000-000000000026',
      'ae400027-0000-4000-8000-000000000027',
      'sale',
      jsonb_build_object(
        'sale_id', 'ae400028-0000-4000-8000-000000000028',
        'unit_id', unit_ids[2], 'actual_sale_price', 100,
        'sale_date', '2099-07-13', 'payment_method', 'bank_transfer'
      )
    );
    void_result := public.execute_product_commerce_command(
      '11111111-1111-4111-8111-111111111111',
      '61616161-6161-4161-8161-616161616161',
      'ae400029-0000-4000-8000-000000000029',
      'ae400030-0000-4000-8000-000000000030',
      'sale_void',
      '{"sale_id":"ae400028-0000-4000-8000-000000000028","expected_version":1,"reason":"Customer returned unopened unit","return_disposition":"sellable"}'::jsonb
    );
    third_handover := public.execute_product_commerce_command(
      '11111111-1111-4111-8111-111111111111',
      '61616161-6161-4161-8161-616161616161',
      'ae400031-0000-4000-8000-000000000031',
      'ae400032-0000-4000-8000-000000000032',
      'handover_issue',
      jsonb_build_object(
        'handover_id', 'ae400033-0000-4000-8000-000000000033',
        'warehouse_id', warehouse_id_value,
        'agent_id', 'b7b7b7b7-b7b7-47b7-87b7-b7b7b7b7b7b7',
        'require_acknowledgment', false,
        'units', jsonb_build_array(jsonb_build_object(
          'unit_id', unit_ids[3], 'minimum_sale_price', 99, 'maximum_sale_price', 121
        ))
      )
    );

    IF handover_result IS DISTINCT FROM handover_replay
       OR accepted_result IS DISTINCT FROM accepted_replay
       OR override_result IS DISTINCT FROM override_replay
       OR sale_result IS DISTINCT FROM sale_replay
       OR collection_result IS DISTINCT FROM collection_replay
       OR return_result IS DISTINCT FROM return_replay
       OR NOT policy_denied
       OR handover_result->'handover'->>'status' <> 'issued'
       OR accepted_result->'handover'->>'status' <> 'accepted'
       OR review_result->'request'->>'status' <> 'approved'
       OR sale_result->'sale'->>'status' <> 'active'
       OR collection_result->'collection'->>'status' <> 'posted'
       OR second_handover->'handover'->>'status' <> 'accepted'
       OR second_sale->'sale'->>'status' <> 'active'
       OR void_result->'sale'->>'status' <> 'voided'
       OR third_handover->'handover'->>'status' <> 'accepted'
       OR (SELECT status FROM public.product_inventory_units WHERE id = unit_ids[1]) <> 'sold'
       OR (SELECT status FROM public.product_inventory_units WHERE id = unit_ids[2]) <> 'in_stock'
       OR (SELECT unit_cost_snapshot FROM public.product_inventory_units WHERE id = unit_ids[2]) <> 60
       OR (SELECT status FROM public.product_inventory_units WHERE id = unit_ids[3]) <> 'with_agent'
       OR (SELECT status FROM public.product_price_override_requests
           WHERE id = 'ae400008-0000-4000-8000-000000000008') <> 'used'
       OR (SELECT count(*) FROM public.product_handovers
           WHERE id IN (
             'ae400003-0000-4000-8000-000000000003',
             'ae400025-0000-4000-8000-000000000025',
             'ae400033-0000-4000-8000-000000000033'
           )) <> 3
       OR (SELECT count(*) FROM public.agent_product_sales
           WHERE id IN (
             'ae400016-0000-4000-8000-000000000016',
             'ae400028-0000-4000-8000-000000000028'
           )) <> 2
       OR (SELECT count(*) FROM public.agent_product_collections
           WHERE id = 'ae400019-0000-4000-8000-000000000019'
             AND amount = 20 AND accounting_status = 'pending') <> 1
       OR (SELECT count(*) FROM public.product_inventory_movements
           WHERE unit_id = ANY(unit_ids)
             AND movement_type IN (
               'handover_issued', 'handover_accepted', 'agent_return', 'sale', 'sale_void'
             )) <> 12
       OR (SELECT count(*) FROM public.product_inventory_commands
           WHERE idempotency_key IN (
             'ae400002-0000-4000-8000-000000000002',
             'ae400005-0000-4000-8000-000000000005',
             'ae400007-0000-4000-8000-000000000007',
             'ae400013-0000-4000-8000-000000000013',
             'ae400015-0000-4000-8000-000000000015',
             'ae400018-0000-4000-8000-000000000018',
             'ae400021-0000-4000-8000-000000000021',
             'ae400024-0000-4000-8000-000000000024',
             'ae400027-0000-4000-8000-000000000027',
             'ae400030-0000-4000-8000-000000000030',
             'ae400032-0000-4000-8000-000000000032'
           )) <> 11
       OR (SELECT count(*) FROM public.event_outbox
           WHERE topic IN (
             'product_inventory.handover_issued',
             'product_inventory.handover_accepted',
             'product_inventory.agent_returned',
             'product_inventory.price_override_requested',
             'product_inventory.price_override_reviewed',
             'product_inventory.sale_recorded',
             'product_inventory.sale_voided',
             'product_inventory.collection_posted'
           )
           AND payload->>'agent_id' = 'b7b7b7b7-b7b7-47b7-87b7-b7b7b7b7b7b7') <> 11 THEN
      RAISE EXCEPTION 'Phase 4 custody, pricing, sale, collection, return, void, replay, or audit proof failed.';
    END IF;
  END
  $test$;

  -- Phase 6 product inventory: tenant/suspension guards, transaction rollback
  -- under injected outbox failures, accounting failure atomicity, and exact
  -- uncapped summary functions remain independently verifiable.
  INSERT INTO public.sales_companies (
    id, organization_id, name, slug, code
  ) VALUES (
    'af6b0001-0000-4000-8000-000000000001',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'Tenant B Inventory Supplier', 'tenant-b-inventory-supplier', 'TBIS'
  );
  INSERT INTO public.sales_products (
    id, organization_id, company_id, name, sku, price,
    default_cost, inventory_enabled, tracking_mode, created_by
  ) VALUES (
    'af6b0002-0000-4000-8000-000000000002',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'af6b0001-0000-4000-8000-000000000001',
    'Tenant B Serialized Product', 'TENANT-B-SERIAL', 100,
    60, true, 'serialized', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  );

  DO $test$
  DECLARE
    warehouse_id_value uuid;
    cross_tenant_denied boolean := false;
    suspended_denied boolean := false;
    receipt_failure_observed boolean := false;
    sale_failure_observed boolean := false;
    accounting_failure_observed boolean := false;
    receipt_payload jsonb;
    stock_summary jsonb;
    finance_summary jsonb;
    agent_balance_count integer := 0;
    sale_test_unit_id uuid;
  BEGIN
    SELECT id INTO warehouse_id_value
    FROM public.inventory_warehouses
    WHERE organization_id = '11111111-1111-4111-8111-111111111111'
      AND is_default = true
    LIMIT 1;

    receipt_payload := jsonb_build_object(
      'receipt_id', 'af610001-0000-4000-8000-000000000001',
      'expected_version', 0,
      'supplier_company_id', 'e1e1e1e1-e1e1-41e1-81e1-e1e1e1e1e1e1',
      'warehouse_id', warehouse_id_value,
      'ownership_type', 'purchased',
      'receipt_date', '2099-07-18',
      'currency', 'SAR',
      'groups', jsonb_build_array(jsonb_build_object(
        'product_id', 'af6b0002-0000-4000-8000-000000000002',
        'unit_cost', 60,
        'planned_sale_price', 100,
        'currency', 'SAR',
        'tax_included', true,
        'condition', 'new',
        'serial_numbers', jsonb_build_array('VG-PHASE6-CROSS-TENANT')
      ))
    );
    BEGIN
      PERFORM public.execute_product_receipt_command(
        '11111111-1111-4111-8111-111111111111',
        '61616161-6161-4161-8161-616161616161',
        'af610002-0000-4000-8000-000000000002',
        'af610003-0000-4000-8000-000000000003',
        'receipt_draft_save', receipt_payload
      );
    EXCEPTION WHEN check_violation THEN
      cross_tenant_denied := true;
    END;

    UPDATE public.profiles
    SET account_status = 'suspended'
    WHERE org_id = '11111111-1111-4111-8111-111111111111'
      AND user_id = '61616161-6161-4161-8161-616161616161';
    BEGIN
      PERFORM public.execute_product_receipt_command(
        '11111111-1111-4111-8111-111111111111',
        '61616161-6161-4161-8161-616161616161',
        'af610004-0000-4000-8000-000000000004',
        'af610005-0000-4000-8000-000000000005',
        'receipt_draft_save',
        receipt_payload
          || '{"receipt_id":"af610006-0000-4000-8000-000000000006","groups":[{"product_id":"e2e2e2e2-e2e2-42e2-82e2-e2e2e2e2e2e2","unit_cost":60,"planned_sale_price":100,"currency":"SAR","tax_included":true,"condition":"new","serial_numbers":["VG-PHASE6-SUSPENDED"]}]}'::jsonb
      );
    EXCEPTION WHEN insufficient_privilege THEN
      suspended_denied := true;
    END;
    UPDATE public.profiles
    SET account_status = 'active'
    WHERE org_id = '11111111-1111-4111-8111-111111111111'
      AND user_id = '61616161-6161-4161-8161-616161616161';

    receipt_payload := receipt_payload
      || '{"receipt_id":"af610007-0000-4000-8000-000000000007","groups":[{"product_id":"e2e2e2e2-e2e2-42e2-82e2-e2e2e2e2e2e2","unit_cost":60,"planned_sale_price":100,"currency":"SAR","tax_included":true,"condition":"new","serial_numbers":["VG-PHASE6-ROLLBACK-RECEIPT"]}]}'::jsonb;
    PERFORM public.execute_product_receipt_command(
      '11111111-1111-4111-8111-111111111111',
      '61616161-6161-4161-8161-616161616161',
      'af610008-0000-4000-8000-000000000008',
      'af610009-0000-4000-8000-000000000009',
      'receipt_draft_save', receipt_payload
    );

    CREATE FUNCTION pg_temp.reject_phase6_product_outbox()
    RETURNS trigger LANGUAGE plpgsql AS $fn$
    BEGIN
      IF (
        NEW.topic = 'product_inventory.receipt_confirmed'
        AND NEW.payload->>'receipt_id' = 'af610007-0000-4000-8000-000000000007'
      ) OR (
        NEW.topic = 'product_inventory.sale_recorded'
        AND NEW.payload->>'sale_id' = 'af610012-0000-4000-8000-000000000012'
      ) OR NEW.topic = 'product_inventory.accounting_failed' THEN
        RAISE EXCEPTION 'Injected Phase 6 product outbox failure';
      END IF;
      RETURN NEW;
    END
    $fn$;
    CREATE TRIGGER reject_phase6_product_outbox_trigger
      BEFORE INSERT ON public.event_outbox
      FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_phase6_product_outbox();

    BEGIN
      PERFORM public.execute_product_receipt_command(
        '11111111-1111-4111-8111-111111111111',
        '61616161-6161-4161-8161-616161616161',
        'af610010-0000-4000-8000-000000000010',
        'af610011-0000-4000-8000-000000000011',
        'receipt_confirm',
        '{"receipt_id":"af610007-0000-4000-8000-000000000007","expected_version":1}'::jsonb
      );
    EXCEPTION WHEN raise_exception THEN
      receipt_failure_observed := SQLERRM = 'Injected Phase 6 product outbox failure';
    END;

    SELECT id INTO sale_test_unit_id
    FROM public.product_inventory_units
    WHERE organization_id = '11111111-1111-4111-8111-111111111111'
      AND raw_serial_number = 'VG-PHASE3-0003'
      AND status = 'with_agent';
    BEGIN
      PERFORM public.execute_product_commerce_command(
        '11111111-1111-4111-8111-111111111111',
        '71717171-7171-4171-8171-717171717171',
        'af610013-0000-4000-8000-000000000013',
        'af610014-0000-4000-8000-000000000014',
        'sale',
        jsonb_build_object(
          'sale_id', 'af610012-0000-4000-8000-000000000012',
          'unit_id', sale_test_unit_id,
          'actual_sale_price', 110,
          'sale_date', '2099-07-18',
          'payment_method', 'cash',
          'customer_name', 'Rollback drill buyer'
        )
      );
    EXCEPTION WHEN raise_exception THEN
      sale_failure_observed := SQLERRM = 'Injected Phase 6 product outbox failure';
    END;

    BEGIN
      PERFORM public.mark_product_inventory_accounting(
        '11111111-1111-4111-8111-111111111111',
        'receipt',
        'ae100001-0000-4000-8000-000000000001',
        'failed',
        NULL, NULL,
        'Injected accounting failure drill',
        '{}'::jsonb
      );
    EXCEPTION WHEN raise_exception THEN
      accounting_failure_observed := SQLERRM = 'Injected Phase 6 product outbox failure';
    END;

    DROP TRIGGER reject_phase6_product_outbox_trigger ON public.event_outbox;

    stock_summary := public.get_product_inventory_stock_summary(
      '11111111-1111-4111-8111-111111111111'
    );
    finance_summary := public.get_product_inventory_finance_summary(
      '11111111-1111-4111-8111-111111111111'
    );
    SELECT count(*) INTO agent_balance_count
    FROM public.get_product_inventory_agent_balances(
      '11111111-1111-4111-8111-111111111111',
      NULL
    );

    IF NOT cross_tenant_denied
       OR NOT suspended_denied
       OR NOT receipt_failure_observed
       OR NOT sale_failure_observed
       OR NOT accounting_failure_observed
       OR EXISTS (
         SELECT 1 FROM public.product_receipts
         WHERE id = 'af610006-0000-4000-8000-000000000006'
       )
       OR (SELECT status FROM public.product_receipts
           WHERE id = 'af610007-0000-4000-8000-000000000007') <> 'ready_to_confirm'
       OR EXISTS (
         SELECT 1 FROM public.product_inventory_units
         WHERE receipt_id = 'af610007-0000-4000-8000-000000000007'
       )
       OR EXISTS (
         SELECT 1 FROM public.product_inventory_movements
         WHERE receipt_id = 'af610007-0000-4000-8000-000000000007'
       )
       OR (SELECT status FROM public.product_inventory_units
           WHERE id = sale_test_unit_id) <> 'with_agent'
       OR EXISTS (
         SELECT 1 FROM public.agent_product_sales
         WHERE id = 'af610012-0000-4000-8000-000000000012'
       )
       OR (SELECT accounting_status FROM public.product_receipts
           WHERE id = 'ae100001-0000-4000-8000-000000000001') <> 'pending'
       OR EXISTS (
         SELECT 1 FROM public.product_inventory_accounting_postings
         WHERE source_type = 'receipt'
           AND source_id = 'ae100001-0000-4000-8000-000000000001'
       )
       OR (stock_summary->>'units')::integer < 1
       OR (finance_summary ? 'inventoryGlBalance') IS FALSE
       OR agent_balance_count < 1 THEN
      RAISE EXCEPTION 'Phase 6 product hardening or rollback drill failed.';
    END IF;
  END
  $test$;

  -- Browser clients cannot bypass the new command boundaries or invoke their
  -- service-only functions directly.
  DO $test$
  DECLARE sim_denied boolean:=false; accounting_denied boolean:=false;
    promoter_denied boolean:=false; eosb_denied boolean:=false; function_denied boolean:=false;
    product_inventory_denied boolean:=false; product_function_denied boolean:=false;
    workbook_rows_denied boolean:=false; workbook_function_denied boolean:=false;
    photo_rows_denied boolean:=false; photo_function_denied boolean:=false;
    commerce_rows_denied boolean:=false; commerce_function_denied boolean:=false;
    posting_rows_denied boolean:=false; accounting_function_denied boolean:=false;
    summary_function_denied boolean:=false;
    product_inventory_rows integer:=0; workbook_rows integer:=0; photo_rows integer:=0;
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claim.role','authenticated',true);
    PERFORM set_config('request.jwt.claim.sub','61616161-6161-4161-8161-616161616161',true);
    BEGIN
      INSERT INTO public.sim_units(organization_id,iccid,provider,sim_type,price,added_by)
      VALUES('11111111-1111-4111-8111-111111111111','899999999999991199','virgin','prepaid',1,
        '61616161-6161-4161-8161-616161616161');
    EXCEPTION WHEN insufficient_privilege THEN sim_denied:=true;
    END;
    BEGIN
      INSERT INTO public.accounting_accounts(organization_id,code,name_ar,type,normal_balance,created_by)
      VALUES('11111111-1111-4111-8111-111111111111','BROWSER-FAIL','Browser fail','expense','debit',
        '61616161-6161-4161-8161-616161616161');
    EXCEPTION WHEN insufficient_privilege THEN accounting_denied:=true;
    END;
    BEGIN
      INSERT INTO public.telecom_offers(organization_id,name_ar,offer_target,created_by)
      VALUES('11111111-1111-4111-8111-111111111111','Browser fail','mobile',
        '61616161-6161-4161-8161-616161616161');
    EXCEPTION WHEN insufficient_privilege THEN promoter_denied:=true;
    END;
    BEGIN
      INSERT INTO public.eosb_accruals(
        organization_id,employee_id,month,years_of_service,daily_rate,monthly_accrual,cumulative_accrual
      ) VALUES(
        '11111111-1111-4111-8111-111111111111','12121212-1212-4212-8212-121212121212',
        '2111-03',1,1,1,1
      );
    EXCEPTION WHEN insufficient_privilege THEN eosb_denied:=true;
    END;
    BEGIN
      PERFORM public.execute_sim_inventory_command(
        '11111111-1111-4111-8111-111111111111','61616161-6161-4161-8161-616161616161',
        'ad300013-0000-4000-8000-000000000013','ad300014-0000-4000-8000-000000000014',
        'inventory_import','{"sims":[]}'::jsonb);
    EXCEPTION WHEN insufficient_privilege THEN function_denied:=true;
    END;
    BEGIN
      UPDATE public.product_inventory_units
      SET status = 'sold'
      WHERE receipt_id = 'ae100001-0000-4000-8000-000000000001';
      GET DIAGNOSTICS product_inventory_rows = ROW_COUNT;
      product_inventory_denied := product_inventory_rows = 0;
    EXCEPTION WHEN insufficient_privilege THEN product_inventory_denied:=true;
    END;
    BEGIN
      PERFORM public.execute_product_receipt_command(
        '11111111-1111-4111-8111-111111111111','61616161-6161-4161-8161-616161616161',
        'ae100011-0000-4000-8000-000000000011','ae100012-0000-4000-8000-000000000012',
        'receipt_confirm','{"receipt_id":"ae100001-0000-4000-8000-000000000001","expected_version":2}'::jsonb);
    EXCEPTION WHEN insufficient_privilege THEN product_function_denied:=true;
    END;
    BEGIN
      UPDATE public.product_inventory_import_rows
      SET unit_cost = 1
      WHERE source_id = 'ae200004-0000-4000-8000-000000000004';
      GET DIAGNOSTICS workbook_rows = ROW_COUNT;
      workbook_rows_denied := workbook_rows = 0;
    EXCEPTION WHEN insufficient_privilege THEN workbook_rows_denied:=true;
    END;
    BEGIN
      PERFORM public.execute_product_workbook_commit(
        '11111111-1111-4111-8111-111111111111','61616161-6161-4161-8161-616161616161',
        'ae200012-0000-4000-8000-000000000012','ae200013-0000-4000-8000-000000000013',
        'ae200001-0000-4000-8000-000000000001','ae200004-0000-4000-8000-000000000004',
        3,'[]'::jsonb);
    EXCEPTION WHEN insufficient_privilege THEN workbook_function_denied:=true;
    END;
    BEGIN
      UPDATE public.product_inventory_photo_candidates
      SET unit_cost = 1
      WHERE receipt_id = 'ae300001-0000-4000-8000-000000000001';
      GET DIAGNOSTICS photo_rows = ROW_COUNT;
      photo_rows_denied := photo_rows = 0;
    EXCEPTION WHEN insufficient_privilege THEN photo_rows_denied:=true;
    END;
    BEGIN
      PERFORM public.execute_product_photo_commit(
        '11111111-1111-4111-8111-111111111111','61616161-6161-4161-8161-616161616161',
        'ae300016-0000-4000-8000-000000000016','ae300017-0000-4000-8000-000000000017',
        'ae300001-0000-4000-8000-000000000001',3,true,'[]'::jsonb);
    EXCEPTION WHEN insufficient_privilege THEN photo_function_denied:=true;
    END;
    BEGIN
      UPDATE public.product_handovers
      SET notes = 'Forbidden browser mutation'
      WHERE id = 'ae400003-0000-4000-8000-000000000003';
      GET DIAGNOSTICS product_inventory_rows = ROW_COUNT;
      commerce_rows_denied := product_inventory_rows = 0;
    EXCEPTION WHEN insufficient_privilege THEN commerce_rows_denied:=true;
    END;
    BEGIN
      PERFORM public.execute_product_commerce_command(
        '11111111-1111-4111-8111-111111111111',
        '61616161-6161-4161-8161-616161616161',
        'ae400034-0000-4000-8000-000000000034',
        'ae400035-0000-4000-8000-000000000035',
        'sale_void',
        '{"sale_id":"ae400016-0000-4000-8000-000000000016","expected_version":1,"reason":"Forbidden browser command","return_disposition":"sellable"}'::jsonb
      );
    EXCEPTION WHEN insufficient_privilege THEN commerce_function_denied:=true;
    END;
    BEGIN
      INSERT INTO public.product_inventory_accounting_postings (
        organization_id, source_type, source_id, status
      ) VALUES (
        '11111111-1111-4111-8111-111111111111',
        'receipt', 'ae100001-0000-4000-8000-000000000001', 'pending'
      );
    EXCEPTION WHEN insufficient_privilege THEN posting_rows_denied:=true;
    END;
    BEGIN
      PERFORM public.mark_product_inventory_accounting(
        '11111111-1111-4111-8111-111111111111',
        'receipt', 'ae100001-0000-4000-8000-000000000001',
        'failed', NULL, NULL, 'Forbidden browser accounting call', '{}'::jsonb
      );
    EXCEPTION WHEN insufficient_privilege THEN accounting_function_denied:=true;
    END;
    BEGIN
      PERFORM public.get_product_inventory_finance_summary(
        '11111111-1111-4111-8111-111111111111'
      );
    EXCEPTION WHEN insufficient_privilege THEN summary_function_denied:=true;
    END;
    RESET ROLE;
    IF NOT sim_denied OR NOT accounting_denied OR NOT promoter_denied OR NOT eosb_denied
       OR NOT function_denied OR NOT product_inventory_denied OR NOT product_function_denied
       OR NOT workbook_rows_denied OR NOT workbook_function_denied
       OR NOT photo_rows_denied OR NOT photo_function_denied
       OR NOT commerce_rows_denied OR NOT commerce_function_denied
       OR NOT posting_rows_denied OR NOT accounting_function_denied
       OR NOT summary_function_denied THEN
      RAISE EXCEPTION 'One or more atomic command boundaries allowed a direct browser write.';
    END IF;
  END
  $test$;
`;

try {
  docker(["info", "--format", "{{.ServerVersion}}"]);
  docker([
    "run",
    "--rm",
    "--name",
    containerName,
    "-e",
    `POSTGRES_PASSWORD=${postgresPassword}`,
    "-p",
    "127.0.0.1::5432",
    "-d",
    "postgres:16-alpine",
  ]);
  containerStarted = true;
  await waitForPostgres();
  psql(supabaseStubs);

  const portOutput = docker(["port", containerName, "5432/tcp"]);
  const port = /:(\d+)$/u.exec(portOutput)?.[1];
  if (!port) throw new Error(`Unable to resolve disposable PostgreSQL port: ${portOutput}`);
  const databaseUrl = `postgresql://postgres:${postgresPassword}@127.0.0.1:${port}/postgres`;
  await waitForHostPostgres(databaseUrl);

  const migration = spawnSync(
    process.execPath,
    ["scripts/apply-migrations.mjs", "--fresh"],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        SUPABASE_DB_URL: "",
        POSTGRES_URL: "",
        DATABASE_URL: databaseUrl,
        MIGRATION_ACTOR: "database-smoke-test",
      },
      encoding: "utf8",
    }
  );
  if (migration.status !== 0) {
    process.stdout.write(migration.stdout ?? "");
    process.stderr.write(migration.stderr ?? "");
    try {
      process.stderr.write(`${docker(["logs", containerName])}\n`);
    } catch {
      // The migration error above remains the primary failure.
    }
    throw new Error("Fresh migration chain failed.");
  }

  psql(launchAssertions);
  await testConcurrentSimSale(databaseUrl);
  await testConcurrentAccountingNumbers(databaseUrl);
  await testConcurrentLmsQuizAttempt(databaseUrl);
  await testConcurrentProductSale(databaseUrl);
  await testConcurrentProductReceiptConfirmation(databaseUrl);
  console.log("Database migration/RLS smoke test passed on disposable PostgreSQL 16.");
} finally {
  if (containerStarted) {
    spawnSync("docker", ["stop", containerName], { encoding: "utf8" });
  }
}
