-- Launch foundations: capability-based tenant authorization, business time,
-- durable business events/outbox, and request-correlated operational auditing.
-- Forward-only and additive except for replacing superseded RLS policies.

-- ---------------------------------------------------------------------------
-- 1. Deterministic role capabilities
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.has_org_role(allowed_roles text[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.role() = 'service_role'
    OR COALESCE(public.current_role() = ANY(allowed_roles), false);
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_org_role(ARRAY['admin', 'super_admin']);
$$;

CREATE OR REPLACE FUNCTION public.can_manage_people()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_org_role(ARRAY['admin', 'hr_admin']);
$$;

CREATE OR REPLACE FUNCTION public.can_manage_attendance()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_org_role(ARRAY['admin', 'hr_admin']);
$$;

CREATE OR REPLACE FUNCTION public.can_manage_leave()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_org_role(ARRAY['admin', 'hr_admin']);
$$;

CREATE OR REPLACE FUNCTION public.can_manage_recruitment()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_org_role(ARRAY['admin', 'hr_admin', 'hr_recruitment']);
$$;

CREATE OR REPLACE FUNCTION public.can_manage_payroll()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_org_role(ARRAY['admin', 'hr_admin', 'finance_manager']);
$$;

CREATE OR REPLACE FUNCTION public.can_manage_assets()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_org_role(ARRAY['admin', 'hr_admin']);
$$;

CREATE OR REPLACE FUNCTION public.can_manage_locations()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_org_role(ARRAY['admin', 'hr_admin', 'training_manager', 'sales_manager']);
$$;

CREATE OR REPLACE FUNCTION public.can_manage_employee_scope(target_employee_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    public.can_manage_people()
    OR target_employee_id = public.current_employee_id()
    OR (
      public.current_role() = 'training_manager'
      AND EXISTS (
        SELECT 1
        FROM public.employees target
        JOIN public.employees me
          ON me.id = public.current_employee_id()
         AND me.org_id = public.current_org_id()
        LEFT JOIN public.departments dept
          ON dept.id = target.department_id
         AND dept.org_id = target.org_id
        LEFT JOIN public.locations loc
          ON loc.id = target.location_id
         AND loc.org_id = target.org_id
        WHERE target.id = target_employee_id
          AND target.org_id = public.current_org_id()
          AND (
            target.manager_id = me.id
            OR dept.manager_employee_id = me.id
            OR loc.manager_employee_id = me.id
            OR (me.location_id IS NOT NULL AND target.location_id = me.location_id)
          )
      )
    ),
    false
  );
$$;

-- Restore HR-admin writes that were accidentally lost when is_admin() was
-- correctly narrowed to organization administrators in v41.
DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'departments', 'locations', 'employees', 'employee_documents',
    'salary_history', 'employee_kpis', 'employee_reviews', 'employee_actions',
    'shifts', 'employee_shifts', 'leave_balances'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS org_select_%I ON public.%I', table_name, table_name);
    EXECUTE format('DROP POLICY IF EXISTS org_insert_%I ON public.%I', table_name, table_name);
    EXECUTE format('DROP POLICY IF EXISTS org_update_%I ON public.%I', table_name, table_name);
    EXECUTE format('DROP POLICY IF EXISTS org_delete_%I ON public.%I', table_name, table_name);
    EXECUTE format('DROP POLICY IF EXISTS launch_select_%I ON public.%I', table_name, table_name);
    EXECUTE format('DROP POLICY IF EXISTS launch_insert_%I ON public.%I', table_name, table_name);
    EXECUTE format('DROP POLICY IF EXISTS launch_update_%I ON public.%I', table_name, table_name);
    EXECUTE format('DROP POLICY IF EXISTS launch_delete_%I ON public.%I', table_name, table_name);
  END LOOP;
END $$;

DROP POLICY IF EXISTS employees_self ON public.employees;

CREATE POLICY launch_select_departments ON public.departments
  FOR SELECT USING (org_id = public.current_org_id() OR auth.role() = 'service_role');
CREATE POLICY launch_insert_departments ON public.departments
  FOR INSERT WITH CHECK (org_id = public.current_org_id() AND public.can_manage_people());
CREATE POLICY launch_update_departments ON public.departments
  FOR UPDATE USING (org_id = public.current_org_id() AND public.can_manage_people())
  WITH CHECK (org_id = public.current_org_id() AND public.can_manage_people());
CREATE POLICY launch_delete_departments ON public.departments
  FOR DELETE USING (org_id = public.current_org_id() AND public.can_manage_people());

CREATE POLICY launch_select_locations ON public.locations
  FOR SELECT USING (org_id = public.current_org_id() OR auth.role() = 'service_role');
CREATE POLICY launch_insert_locations ON public.locations
  FOR INSERT WITH CHECK (org_id = public.current_org_id() AND public.can_manage_locations());
CREATE POLICY launch_update_locations ON public.locations
  FOR UPDATE USING (org_id = public.current_org_id() AND public.can_manage_locations())
  WITH CHECK (org_id = public.current_org_id() AND public.can_manage_locations());
CREATE POLICY launch_delete_locations ON public.locations
  FOR DELETE USING (org_id = public.current_org_id() AND public.can_manage_people());

CREATE POLICY launch_select_employees ON public.employees
  FOR SELECT USING (
    org_id = public.current_org_id()
    AND (
      public.can_manage_people()
      OR public.can_manage_recruitment()
      OR user_id = auth.uid()
      OR public.can_manage_employee_scope(id)
    )
  );
CREATE POLICY launch_insert_employees ON public.employees
  FOR INSERT WITH CHECK (org_id = public.current_org_id() AND public.can_manage_people());
CREATE POLICY launch_update_employees ON public.employees
  FOR UPDATE USING (org_id = public.current_org_id() AND public.can_manage_people())
  WITH CHECK (org_id = public.current_org_id() AND public.can_manage_people());
CREATE POLICY launch_delete_employees ON public.employees
  FOR DELETE USING (org_id = public.current_org_id() AND public.can_manage_people());

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'employee_documents', 'salary_history', 'employee_kpis',
    'employee_reviews', 'employee_actions', 'employee_shifts', 'leave_balances'
  ]
  LOOP
    EXECUTE format(
      'CREATE POLICY launch_select_%I ON public.%I FOR SELECT USING '
      || '(org_id = public.current_org_id() AND public.can_manage_employee_scope(employee_id))',
      table_name, table_name
    );
    EXECUTE format(
      'CREATE POLICY launch_insert_%I ON public.%I FOR INSERT WITH CHECK '
      || '(org_id = public.current_org_id() AND public.can_manage_people())',
      table_name, table_name
    );
    EXECUTE format(
      'CREATE POLICY launch_update_%I ON public.%I FOR UPDATE USING '
      || '(org_id = public.current_org_id() AND public.can_manage_people()) WITH CHECK '
      || '(org_id = public.current_org_id() AND public.can_manage_people())',
      table_name, table_name
    );
    EXECUTE format(
      'CREATE POLICY launch_delete_%I ON public.%I FOR DELETE USING '
      || '(org_id = public.current_org_id() AND public.can_manage_people())',
      table_name, table_name
    );
  END LOOP;
END $$;

CREATE POLICY launch_select_shifts ON public.shifts
  FOR SELECT USING (org_id = public.current_org_id() OR auth.role() = 'service_role');
CREATE POLICY launch_insert_shifts ON public.shifts
  FOR INSERT WITH CHECK (org_id = public.current_org_id() AND public.can_manage_attendance());
CREATE POLICY launch_update_shifts ON public.shifts
  FOR UPDATE USING (org_id = public.current_org_id() AND public.can_manage_attendance())
  WITH CHECK (org_id = public.current_org_id() AND public.can_manage_attendance());
CREATE POLICY launch_delete_shifts ON public.shifts
  FOR DELETE USING (org_id = public.current_org_id() AND public.can_manage_attendance());

DROP POLICY IF EXISTS leave_balance_transactions_org_members_select ON public.leave_balance_transactions;
DROP POLICY IF EXISTS leave_balance_transactions_admin_insert ON public.leave_balance_transactions;
CREATE POLICY leave_balance_transactions_scoped_select ON public.leave_balance_transactions
  FOR SELECT USING (
    org_id = public.current_org_id()
    AND public.can_manage_employee_scope(employee_id)
  );
CREATE POLICY leave_balance_transactions_manager_insert ON public.leave_balance_transactions
  FOR INSERT WITH CHECK (
    org_id = public.current_org_id()
    AND public.can_manage_leave()
  );

-- ---------------------------------------------------------------------------
-- 2. Tenant business time
-- ---------------------------------------------------------------------------

ALTER TABLE public.organization_features
  ADD COLUMN IF NOT EXISTS lms_enabled boolean NOT NULL DEFAULT true;

ALTER TABLE public.organization_features
  ALTER COLUMN enabled_modules
  SET DEFAULT '["hr", "sales", "recruitment", "accounting", "chat", "assets", "payroll", "personnel", "lms"]'::jsonb;

UPDATE public.organization_features
SET enabled_modules = enabled_modules || '["lms"]'::jsonb,
    updated_at = now()
WHERE NOT (enabled_modules @> '["lms"]'::jsonb);

UPDATE public.plans
SET features = jsonb_set(features, '{lms}',
    CASE WHEN code IN ('pro', 'enterprise') THEN 'true'::jsonb ELSE 'false'::jsonb END,
    true),
    updated_at = now()
WHERE code IN ('starter', 'pro', 'enterprise');

-- Existing organizations predate subscription enforcement. Preserve their
-- current entitlements through an explicit grandfathered plan instead of
-- treating a missing subscription as unlimited access.
INSERT INTO public.plans (
  code,
  name,
  description,
  features,
  limits,
  price_monthly,
  price_yearly,
  currency,
  is_active
)
VALUES (
  'legacy',
  'Legacy Grandfathered',
  'Launch migration plan for organizations created before plan enforcement.',
  '{"hr":true,"sales":true,"recruitment":true,"accounting":true,"chat":true,"assets":true,"payroll":true,"personnel":true,"lms":true,"source":"schema_v55_launch_foundations"}'::jsonb,
  '{}'::jsonb,
  0,
  0,
  'SAR',
  true
)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.organization_settings (org_id)
SELECT id FROM public.organizations
ON CONFLICT (org_id) DO NOTHING;

INSERT INTO public.organization_features (org_id, plan_code)
SELECT id, 'legacy' FROM public.organizations
ON CONFLICT (org_id) DO NOTHING;

UPDATE public.organization_features
SET plan_code = 'legacy', updated_at = now()
WHERE plan_code IS NULL;

INSERT INTO public.organization_subscriptions (
  org_id,
  plan_code,
  status,
  provider,
  metadata
)
SELECT
  id,
  'legacy',
  'active',
  'internal',
  '{"grandfathered":true,"source":"schema_v55_launch_foundations"}'::jsonb
FROM public.organizations
ON CONFLICT (org_id) DO NOTHING;

DO $$
DECLARE
  invalid_setting record;
BEGIN
  SELECT os.org_id, os.timezone
  INTO invalid_setting
  FROM public.organization_settings os
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_timezone_names tz WHERE tz.name = os.timezone
  )
  LIMIT 1;

  IF invalid_setting.org_id IS NOT NULL THEN
    RAISE EXCEPTION 'Organization % has invalid IANA timezone %.',
      invalid_setting.org_id, invalid_setting.timezone;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.validate_organization_timezone()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_timezone_names tz WHERE tz.name = NEW.timezone
  ) THEN
    RAISE EXCEPTION 'Invalid IANA timezone: %', NEW.timezone
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_organization_timezone_trigger
  ON public.organization_settings;
CREATE TRIGGER validate_organization_timezone_trigger
  BEFORE INSERT OR UPDATE OF timezone ON public.organization_settings
  FOR EACH ROW EXECUTE FUNCTION public.validate_organization_timezone();

CREATE OR REPLACE FUNCTION public.organization_business_date(
  target_org_id uuid,
  instant timestamptz DEFAULT now()
)
RETURNS date
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  org_timezone text;
BEGIN
  IF auth.role() <> 'service_role' AND target_org_id <> public.current_org_id() THEN
    RAISE EXCEPTION 'Cross-organization business time access is forbidden.'
      USING ERRCODE = '42501';
  END IF;

  SELECT timezone INTO org_timezone
  FROM public.organization_settings
  WHERE org_id = target_org_id;

  IF org_timezone IS NULL THEN
    RAISE EXCEPTION 'Organization settings are missing for %.', target_org_id;
  END IF;

  RETURN (instant AT TIME ZONE org_timezone)::date;
END;
$$;

REVOKE ALL ON FUNCTION public.create_organization_defaults(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_organization_defaults(uuid, uuid)
  TO service_role;
REVOKE ALL ON FUNCTION public.refresh_organization_usage(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_organization_usage(uuid)
  TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Durable business events, outbox delivery, and operational auditing
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.business_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  source_type text NOT NULL CHECK (length(btrim(source_type)) > 0),
  business_key text NOT NULL CHECK (length(btrim(business_key)) > 0),
  event_version integer NOT NULL DEFAULT 1 CHECK (event_version > 0),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  payload_hash text NOT NULL CHECK (length(payload_hash) = 64),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'dead_letter')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  request_id uuid,
  correlation_id uuid,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  last_error text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  processing_started_at timestamptz,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, org_id),
  UNIQUE (org_id, source_type, business_key)
);

CREATE TABLE IF NOT EXISTS public.event_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  business_event_id uuid NOT NULL,
  topic text NOT NULL CHECK (length(btrim(topic)) > 0),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  payload_hash text NOT NULL CHECK (length(payload_hash) = 64),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'dead_letter')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (business_event_id, org_id)
    REFERENCES public.business_events(id, org_id) ON DELETE CASCADE,
  UNIQUE (business_event_id, topic)
);

CREATE TABLE IF NOT EXISTS public.operational_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  request_id uuid NOT NULL,
  correlation_id uuid,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_role text,
  action text NOT NULL CHECK (length(btrim(action)) > 0),
  target_type text,
  target_id text,
  outcome text NOT NULL CHECK (outcome IN ('success', 'denied', 'failed')),
  status_code integer CHECK (status_code BETWEEN 100 AND 599),
  duration_ms integer CHECK (duration_ms IS NULL OR duration_ms >= 0),
  error_code text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_business_events_pending
  ON public.business_events(status, created_at)
  WHERE status IN ('pending', 'failed');
CREATE INDEX IF NOT EXISTS idx_business_events_org_created
  ON public.business_events(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_event_outbox_delivery
  ON public.event_outbox(status, available_at, created_at)
  WHERE status IN ('pending', 'failed');
CREATE INDEX IF NOT EXISTS idx_event_outbox_org_created
  ON public.event_outbox(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_operational_audit_request
  ON public.operational_audit_logs(request_id);
CREATE INDEX IF NOT EXISTS idx_operational_audit_org_created
  ON public.operational_audit_logs(org_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.claim_business_event(
  target_event_id uuid,
  target_org_id uuid
)
RETURNS SETOF public.business_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  UPDATE public.business_events event
  SET status = 'processing',
      attempts = event.attempts + 1,
      processing_started_at = now(),
      last_error = NULL,
      updated_at = now()
  WHERE event.id = target_event_id
    AND event.org_id = target_org_id
    AND (
      event.status IN ('pending', 'failed')
      OR (
        event.status = 'processing'
        AND event.processing_started_at < now() - interval '5 minutes'
      )
    )
  RETURNING event.*;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_event_outbox(
  worker_id text,
  batch_size integer DEFAULT 25
)
RETURNS SETOF public.event_outbox
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501';
  END IF;
  IF length(btrim(worker_id)) = 0 THEN
    RAISE EXCEPTION 'worker_id is required.' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT outbox.id
    FROM public.event_outbox outbox
    WHERE outbox.attempts < 10
      AND (
        (
          outbox.status IN ('pending', 'failed')
          AND outbox.available_at <= now()
        )
        OR (
          outbox.status = 'processing'
          AND outbox.locked_at < now() - interval '5 minutes'
        )
      )
    ORDER BY outbox.available_at ASC, outbox.created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT LEAST(GREATEST(batch_size, 1), 100)
  )
  UPDATE public.event_outbox outbox
  SET status = 'processing',
      attempts = outbox.attempts + 1,
      locked_at = now(),
      locked_by = worker_id,
      last_error = NULL,
      updated_at = now()
  FROM candidates
  WHERE outbox.id = candidates.id
  RETURNING outbox.*;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_business_event(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_business_event(uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.claim_event_outbox(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_event_outbox(text, integer) TO service_role;

DROP TRIGGER IF EXISTS touch_business_events_updated_at ON public.business_events;
CREATE TRIGGER touch_business_events_updated_at
  BEFORE UPDATE ON public.business_events
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
DROP TRIGGER IF EXISTS touch_event_outbox_updated_at ON public.event_outbox;
CREATE TRIGGER touch_event_outbox_updated_at
  BEFORE UPDATE ON public.event_outbox
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.business_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operational_audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS business_events_admin_select ON public.business_events;
DROP POLICY IF EXISTS business_events_service_write ON public.business_events;
CREATE POLICY business_events_admin_select ON public.business_events
  FOR SELECT USING (
    auth.role() = 'service_role'
    OR (org_id = public.current_org_id() AND public.is_admin())
  );
CREATE POLICY business_events_service_write ON public.business_events
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS event_outbox_admin_select ON public.event_outbox;
DROP POLICY IF EXISTS event_outbox_service_write ON public.event_outbox;
CREATE POLICY event_outbox_admin_select ON public.event_outbox
  FOR SELECT USING (
    auth.role() = 'service_role'
    OR (org_id = public.current_org_id() AND public.is_admin())
  );
CREATE POLICY event_outbox_service_write ON public.event_outbox
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS operational_audit_admin_select ON public.operational_audit_logs;
DROP POLICY IF EXISTS operational_audit_service_insert ON public.operational_audit_logs;
CREATE POLICY operational_audit_admin_select ON public.operational_audit_logs
  FOR SELECT USING (
    auth.role() = 'service_role'
    OR (org_id = public.current_org_id() AND public.is_admin())
    OR (org_id IS NULL AND public.is_platform_superadmin())
  );
CREATE POLICY operational_audit_service_insert ON public.operational_audit_logs
  FOR INSERT WITH CHECK (auth.role() = 'service_role');

COMMENT ON TABLE public.business_events IS
  'Idempotent source-of-truth events for cross-module business operations.';
COMMENT ON TABLE public.event_outbox IS
  'Transactional delivery queue; workers retry and dead-letter failed side effects.';
COMMENT ON TABLE public.operational_audit_logs IS
  'Append-only request-correlated audit trail written by trusted server code.';
