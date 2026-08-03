-- Tenant platform completion from documentations/audit.md.
-- Adds tenant configuration, lifecycle, billing/usage foundations, storage privacy,
-- and shared quota metadata without dropping existing data.

DO $$
DECLARE
  duplicate_user uuid;
BEGIN
  SELECT user_id
  INTO duplicate_user
  FROM public.org_members
  WHERE role::text <> 'super_admin'
  GROUP BY user_id
  HAVING COUNT(*) > 1
  LIMIT 1;

  IF duplicate_user IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot enforce single organization membership; user % belongs to multiple organizations.', duplicate_user;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS org_members_single_workspace_org_user_idx
  ON public.org_members(user_id)
  WHERE role <> 'super_admin';

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deletion_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS deletion_requested_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS deletion_reason text,
  ADD COLUMN IF NOT EXISTS data_export_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS data_export_path text;

CREATE INDEX IF NOT EXISTS idx_organizations_status_deleted
  ON public.organizations(status, deleted_at);

CREATE OR REPLACE FUNCTION public.is_platform_superadmin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.platform_admins pa
    WHERE pa.user_id = auth.uid()
      AND pa.role = 'superadmin'
      AND pa.status = 'active'
  );
$$;

CREATE TABLE IF NOT EXISTS public.plans (
  code text PRIMARY KEY,
  name text NOT NULL,
  description text,
  features jsonb NOT NULL DEFAULT '{}'::jsonb,
  limits jsonb NOT NULL DEFAULT '{}'::jsonb,
  price_monthly numeric NOT NULL DEFAULT 0,
  price_yearly numeric NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'SAR',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.organization_settings (
  org_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  brand_name text,
  tagline text,
  primary_color text NOT NULL DEFAULT '#0f766e',
  locale text NOT NULL DEFAULT 'ar-SA',
  timezone text NOT NULL DEFAULT 'Asia/Riyadh',
  attendance_default_radius_meters integer NOT NULL DEFAULT 100,
  allow_out_of_geofence_checkin boolean NOT NULL DEFAULT false,
  leave_defaults jsonb NOT NULL DEFAULT '{"sick": 30, "vacation": 21, "emergency": 5}'::jsonb,
  approval_workflows jsonb NOT NULL DEFAULT '{}'::jsonb,
  shift_rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.organization_features (
  org_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  plan_code text REFERENCES public.plans(code) ON DELETE SET NULL,
  hr_enabled boolean NOT NULL DEFAULT true,
  sales_enabled boolean NOT NULL DEFAULT true,
  recruitment_enabled boolean NOT NULL DEFAULT true,
  accounting_enabled boolean NOT NULL DEFAULT true,
  chat_enabled boolean NOT NULL DEFAULT true,
  assets_enabled boolean NOT NULL DEFAULT true,
  payroll_enabled boolean NOT NULL DEFAULT true,
  personnel_enabled boolean NOT NULL DEFAULT true,
  enabled_modules jsonb NOT NULL DEFAULT '["hr", "sales", "recruitment", "accounting", "chat", "assets", "payroll", "personnel"]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.organization_subscriptions (
  org_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  plan_code text NOT NULL REFERENCES public.plans(code) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'trialing'
    CHECK (status IN ('trialing', 'active', 'past_due', 'paused', 'canceled', 'expired')),
  provider text,
  provider_customer_id text,
  provider_subscription_id text,
  period_start timestamptz,
  period_end timestamptz,
  trial_end timestamptz,
  cancel_at timestamptz,
  canceled_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.organization_usage (
  org_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  employee_count integer NOT NULL DEFAULT 0,
  active_employee_count integer NOT NULL DEFAULT 0,
  storage_bytes bigint NOT NULL DEFAULT 0,
  api_requests_current_month integer NOT NULL DEFAULT 0,
  sales_agent_count integer NOT NULL DEFAULT 0,
  accounting_entry_count integer NOT NULL DEFAULT 0,
  last_calculated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.organization_quota_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  quota_key text NOT NULL,
  measured_value numeric NOT NULL DEFAULT 0,
  limit_value numeric,
  action text NOT NULL DEFAULT 'observed'
    CHECK (action IN ('observed', 'warned', 'blocked', 'increased')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.approval_workflows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, entity_type)
);

CREATE INDEX IF NOT EXISTS idx_organization_subscriptions_status
  ON public.organization_subscriptions(status, period_end);
CREATE INDEX IF NOT EXISTS idx_organization_quota_events_org_created
  ON public.organization_quota_events(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_approval_workflows_org_entity
  ON public.approval_workflows(org_id, entity_type);

ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_features ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_quota_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_workflows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS plans_select ON public.plans;
CREATE POLICY plans_select ON public.plans
  FOR SELECT USING (is_active OR public.is_platform_superadmin() OR auth.role() = 'service_role');

DROP POLICY IF EXISTS plans_service_write ON public.plans;
CREATE POLICY plans_service_write ON public.plans
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS organization_settings_select ON public.organization_settings;
CREATE POLICY organization_settings_select ON public.organization_settings
  FOR SELECT USING (
    org_id = public.current_org_id()
    OR public.is_platform_superadmin()
    OR auth.role() = 'service_role'
  );

DROP POLICY IF EXISTS organization_settings_insert ON public.organization_settings;
CREATE POLICY organization_settings_insert ON public.organization_settings
  FOR INSERT WITH CHECK (
    auth.role() = 'service_role'
    OR (public.is_admin() AND org_id = public.current_org_id())
  );

DROP POLICY IF EXISTS organization_settings_update ON public.organization_settings;
CREATE POLICY organization_settings_update ON public.organization_settings
  FOR UPDATE USING (
    auth.role() = 'service_role'
    OR (public.is_admin() AND org_id = public.current_org_id())
  )
  WITH CHECK (
    auth.role() = 'service_role'
    OR (public.is_admin() AND org_id = public.current_org_id())
  );

DROP POLICY IF EXISTS organization_features_select ON public.organization_features;
CREATE POLICY organization_features_select ON public.organization_features
  FOR SELECT USING (
    org_id = public.current_org_id()
    OR public.is_platform_superadmin()
    OR auth.role() = 'service_role'
  );

DROP POLICY IF EXISTS organization_features_service_write ON public.organization_features;
CREATE POLICY organization_features_service_write ON public.organization_features
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS organization_subscriptions_select ON public.organization_subscriptions;
CREATE POLICY organization_subscriptions_select ON public.organization_subscriptions
  FOR SELECT USING (
    org_id = public.current_org_id()
    OR public.is_platform_superadmin()
    OR auth.role() = 'service_role'
  );

DROP POLICY IF EXISTS organization_subscriptions_service_write ON public.organization_subscriptions;
CREATE POLICY organization_subscriptions_service_write ON public.organization_subscriptions
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS organization_usage_select ON public.organization_usage;
CREATE POLICY organization_usage_select ON public.organization_usage
  FOR SELECT USING (
    org_id = public.current_org_id()
    OR public.is_platform_superadmin()
    OR auth.role() = 'service_role'
  );

DROP POLICY IF EXISTS organization_usage_service_write ON public.organization_usage;
CREATE POLICY organization_usage_service_write ON public.organization_usage
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS organization_quota_events_select ON public.organization_quota_events;
CREATE POLICY organization_quota_events_select ON public.organization_quota_events
  FOR SELECT USING (
    org_id = public.current_org_id()
    OR public.is_platform_superadmin()
    OR auth.role() = 'service_role'
  );

DROP POLICY IF EXISTS organization_quota_events_service_write ON public.organization_quota_events;
CREATE POLICY organization_quota_events_service_write ON public.organization_quota_events
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS approval_workflows_select ON public.approval_workflows;
CREATE POLICY approval_workflows_select ON public.approval_workflows
  FOR SELECT USING (
    org_id = public.current_org_id()
    OR public.is_platform_superadmin()
    OR auth.role() = 'service_role'
  );

DROP POLICY IF EXISTS approval_workflows_insert ON public.approval_workflows;
CREATE POLICY approval_workflows_insert ON public.approval_workflows
  FOR INSERT WITH CHECK (
    auth.role() = 'service_role'
    OR (public.is_admin() AND org_id = public.current_org_id())
  );

DROP POLICY IF EXISTS approval_workflows_update ON public.approval_workflows;
CREATE POLICY approval_workflows_update ON public.approval_workflows
  FOR UPDATE USING (
    auth.role() = 'service_role'
    OR (public.is_admin() AND org_id = public.current_org_id())
  )
  WITH CHECK (
    auth.role() = 'service_role'
    OR (public.is_admin() AND org_id = public.current_org_id())
  );

DROP POLICY IF EXISTS approval_workflows_delete ON public.approval_workflows;
CREATE POLICY approval_workflows_delete ON public.approval_workflows
  FOR DELETE USING (
    auth.role() = 'service_role'
    OR (public.is_admin() AND org_id = public.current_org_id())
  );

INSERT INTO public.plans (code, name, description, features, limits, price_monthly, price_yearly, currency, is_active)
VALUES
  (
    'starter',
    'Starter',
    'Core HR workspace with conservative tenant limits.',
    '{"hr": true, "sales": false, "recruitment": false, "accounting": false, "chat": true, "assets": true, "payroll": true, "personnel": true, "lms": true}'::jsonb,
    '{"employees": 50, "storage_mb": 1024, "sales_agents": 0, "accounting_entries_monthly": 0, "api_requests_monthly": 10000}'::jsonb,
    0,
    0,
    'SAR',
    true
  ),
  (
    'pro',
    'Pro',
    'HR, sales, recruitment, and accounting for growing teams.',
    '{"hr": true, "sales": true, "recruitment": true, "accounting": true, "chat": true, "assets": true, "payroll": true, "personnel": true, "lms": true}'::jsonb,
    '{"employees": 250, "storage_mb": 10240, "sales_agents": 50, "accounting_entries_monthly": 10000, "api_requests_monthly": 50000}'::jsonb,
    0,
    0,
    'SAR',
    true
  ),
  (
    'enterprise',
    'Enterprise',
    'Full platform with negotiated limits and support.',
    '{"hr": true, "sales": true, "recruitment": true, "accounting": true, "chat": true, "assets": true, "payroll": true, "personnel": true, "lms": true}'::jsonb,
    '{"employees": 10000, "storage_mb": 102400, "sales_agents": 1000, "accounting_entries_monthly": 1000000, "api_requests_monthly": 1000000}'::jsonb,
    0,
    0,
    'SAR',
    true
  )
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  features = EXCLUDED.features,
  limits = EXCLUDED.limits,
  updated_at = now();

CREATE OR REPLACE FUNCTION public.create_organization_defaults(
  p_org_id uuid,
  p_actor_user_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  org_name text;
BEGIN
  SELECT name INTO org_name
  FROM public.organizations
  WHERE id = p_org_id;

  IF org_name IS NULL THEN
    RAISE EXCEPTION 'Organization % does not exist.', p_org_id;
  END IF;

  INSERT INTO public.organization_settings (org_id, brand_name)
  VALUES (p_org_id, org_name)
  ON CONFLICT (org_id) DO UPDATE SET
    brand_name = COALESCE(public.organization_settings.brand_name, EXCLUDED.brand_name),
    updated_at = now();

  INSERT INTO public.organization_features (org_id, plan_code)
  VALUES (p_org_id, 'pro')
  ON CONFLICT (org_id) DO NOTHING;

  INSERT INTO public.organization_subscriptions (org_id, plan_code, status, period_start, trial_end)
  VALUES (p_org_id, 'pro', 'trialing', now(), now() + interval '14 days')
  ON CONFLICT (org_id) DO NOTHING;

  INSERT INTO public.organization_usage (org_id, last_calculated_at)
  VALUES (p_org_id, now())
  ON CONFLICT (org_id) DO NOTHING;

  INSERT INTO public.approval_workflows (org_id, entity_type, steps)
  VALUES
    (p_org_id, 'leave_request', '[{"role": "manager", "order": 1}, {"role": "hr_admin", "order": 2}]'::jsonb),
    (p_org_id, 'advance_request', '[{"role": "hr_admin", "order": 1}]'::jsonb)
  ON CONFLICT (org_id, entity_type) DO NOTHING;

  INSERT INTO public.organization_quota_events (org_id, quota_key, action, metadata)
  VALUES (
    p_org_id,
    'tenant_defaults',
    'observed',
    jsonb_build_object('actor_user_id', p_actor_user_id, 'created_at', now())
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_organization_usage(p_org_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage
AS $$
DECLARE
  total_employees integer;
  active_employees integer;
  total_storage bigint;
  sales_agents integer;
  accounting_entries integer;
BEGIN
  SELECT COUNT(*), COUNT(*) FILTER (WHERE COALESCE(status, 'Active') ILIKE 'active')
  INTO total_employees, active_employees
  FROM public.employees
  WHERE org_id = p_org_id;

  SELECT COALESCE(SUM(COALESCE((metadata->>'size')::bigint, 0)), 0)
  INTO total_storage
  FROM storage.objects
  WHERE bucket_id IN (
      'task-attachments',
      'chat-attachments',
      'balance-attachments',
      'recruitment',
      'employee-documents',
      'attendance-selfies'
    )
    AND (
      (storage.foldername(name))[1] = p_org_id::text
      OR ((storage.foldername(name))[1] = 'leave-requests' AND (storage.foldername(name))[2] = p_org_id::text)
    );

  SELECT COUNT(*)
  INTO sales_agents
  FROM public.org_members
  WHERE org_id = p_org_id
    AND role::text IN ('sales', 'sales_manager');

  SELECT COUNT(*)
  INTO accounting_entries
  FROM public.accounting_journal_entries
  WHERE organization_id = p_org_id;

  INSERT INTO public.organization_usage (
    org_id,
    employee_count,
    active_employee_count,
    storage_bytes,
    sales_agent_count,
    accounting_entry_count,
    last_calculated_at,
    updated_at
  )
  VALUES (
    p_org_id,
    COALESCE(total_employees, 0),
    COALESCE(active_employees, 0),
    COALESCE(total_storage, 0),
    COALESCE(sales_agents, 0),
    COALESCE(accounting_entries, 0),
    now(),
    now()
  )
  ON CONFLICT (org_id) DO UPDATE SET
    employee_count = EXCLUDED.employee_count,
    active_employee_count = EXCLUDED.active_employee_count,
    storage_bytes = EXCLUDED.storage_bytes,
    sales_agent_count = EXCLUDED.sales_agent_count,
    accounting_entry_count = EXCLUDED.accounting_entry_count,
    last_calculated_at = EXCLUDED.last_calculated_at,
    updated_at = now();
END;
$$;

SELECT public.create_organization_defaults(id, NULL)
FROM public.organizations
WHERE deleted_at IS NULL;

SELECT public.refresh_organization_usage(id)
FROM public.organizations
WHERE deleted_at IS NULL;

INSERT INTO storage.buckets (id, name, public)
VALUES
  ('balance-attachments', 'balance-attachments', false),
  ('recruitment', 'recruitment', false)
ON CONFLICT (id) DO UPDATE SET public = false;

DROP POLICY IF EXISTS balance_attachments_select ON storage.objects;
CREATE POLICY balance_attachments_select ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'balance-attachments'
    AND (
      auth.role() = 'service_role'
      OR (storage.foldername(name))[1] = public.current_org_id()::text
      OR ((storage.foldername(name))[1] = 'leave-requests' AND (storage.foldername(name))[2] = public.current_org_id()::text)
      OR EXISTS (
        SELECT 1
        FROM public.financial_balances fb
        WHERE fb.id::text = (storage.foldername(name))[1]
          AND fb.org_id = public.current_org_id()
      )
      OR EXISTS (
        SELECT 1
        FROM public.employee_assets ea
        WHERE ea.id::text = (storage.foldername(name))[1]
          AND ea.org_id = public.current_org_id()
      )
    )
  );

DROP POLICY IF EXISTS balance_attachments_insert ON storage.objects;
CREATE POLICY balance_attachments_insert ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'balance-attachments'
    AND (
      auth.role() = 'service_role'
      OR (storage.foldername(name))[1] = public.current_org_id()::text
      OR ((storage.foldername(name))[1] = 'leave-requests' AND (storage.foldername(name))[2] = public.current_org_id()::text)
    )
  );

DROP POLICY IF EXISTS balance_attachments_update ON storage.objects;
CREATE POLICY balance_attachments_update ON storage.objects
  FOR UPDATE
  USING (
    bucket_id = 'balance-attachments'
    AND (
      auth.role() = 'service_role'
      OR (storage.foldername(name))[1] = public.current_org_id()::text
      OR ((storage.foldername(name))[1] = 'leave-requests' AND (storage.foldername(name))[2] = public.current_org_id()::text)
    )
  )
  WITH CHECK (
    bucket_id = 'balance-attachments'
    AND (
      auth.role() = 'service_role'
      OR (storage.foldername(name))[1] = public.current_org_id()::text
      OR ((storage.foldername(name))[1] = 'leave-requests' AND (storage.foldername(name))[2] = public.current_org_id()::text)
    )
  );

DROP POLICY IF EXISTS balance_attachments_delete ON storage.objects;
CREATE POLICY balance_attachments_delete ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'balance-attachments'
    AND (
      auth.role() = 'service_role'
      OR (public.is_admin() AND (storage.foldername(name))[1] = public.current_org_id()::text)
      OR (public.is_admin() AND (storage.foldername(name))[1] = 'leave-requests' AND (storage.foldername(name))[2] = public.current_org_id()::text)
    )
  );

DROP POLICY IF EXISTS recruitment_attachments_select ON storage.objects;
CREATE POLICY recruitment_attachments_select ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'recruitment'
    AND (
      auth.role() = 'service_role'
      OR (storage.foldername(name))[1] = public.current_org_id()::text
      OR (
        (storage.foldername(name))[1] = 'cv'
        AND EXISTS (
          SELECT 1
          FROM public.job_postings jp
          WHERE jp.id::text = (storage.foldername(name))[2]
            AND jp.org_id = public.current_org_id()
        )
      )
    )
  );

DROP POLICY IF EXISTS recruitment_attachments_insert ON storage.objects;
CREATE POLICY recruitment_attachments_insert ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'recruitment'
    AND (
      auth.role() = 'service_role'
      OR (storage.foldername(name))[1] = public.current_org_id()::text
    )
  );

DROP POLICY IF EXISTS recruitment_attachments_update ON storage.objects;
CREATE POLICY recruitment_attachments_update ON storage.objects
  FOR UPDATE
  USING (
    bucket_id = 'recruitment'
    AND (
      auth.role() = 'service_role'
      OR (storage.foldername(name))[1] = public.current_org_id()::text
    )
  )
  WITH CHECK (
    bucket_id = 'recruitment'
    AND (
      auth.role() = 'service_role'
      OR (storage.foldername(name))[1] = public.current_org_id()::text
    )
  );

DROP POLICY IF EXISTS recruitment_attachments_delete ON storage.objects;
CREATE POLICY recruitment_attachments_delete ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'recruitment'
    AND (
      auth.role() = 'service_role'
      OR (public.is_admin() AND (storage.foldername(name))[1] = public.current_org_id()::text)
    )
  );

CREATE INDEX IF NOT EXISTS idx_attendance_records_org_work_employee
  ON public.attendance_records(org_id, work_date DESC, employee_id);
CREATE INDEX IF NOT EXISTS idx_tasks_org_status_due
  ON public.tasks(org_id, status, due_date);
CREATE INDEX IF NOT EXISTS idx_task_assignments_org_employee_status
  ON public.task_assignments(org_id, employee_id, status);
CREATE INDEX IF NOT EXISTS idx_leave_requests_org_status_dates
  ON public.leave_requests(org_id, status, start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_notifications_org_user_read_created
  ON public.notifications(org_id, user_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_advance_requests_org_status_created
  ON public.advance_requests(organization_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_asset_inventory_org_status_created
  ON public.asset_inventory(org_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_employee_assets_org_employee_status
  ON public.employee_assets(org_id, employee_id, status);
CREATE INDEX IF NOT EXISTS idx_job_applications_org_posting_status
  ON public.job_applications(org_id, job_posting_id, status);
CREATE INDEX IF NOT EXISTS idx_accounting_journal_entries_org_date_status
  ON public.accounting_journal_entries(organization_id, entry_date DESC, status);
