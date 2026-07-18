-- Carrier Sales Dashboard & Verification System
-- Virgin/FRiENDi activation data from daily Excel uploads, matched to employees via dealer codes.

-- ---------------------------------------------------------------------------
-- 1. Employee table additions
-- ---------------------------------------------------------------------------
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS gosi_registered boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS gosi_number text,
  ADD COLUMN IF NOT EXISTS carrier_supervisor_id uuid REFERENCES public.employees(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- 2. carrier_activation_imports — tracks each Excel upload
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.carrier_activation_imports (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  file_name         text NOT NULL,
  file_path         text,
  import_date       date NOT NULL DEFAULT current_date,
  activation_month  date NOT NULL,
  date_range_start  date NOT NULL,
  date_range_end    date NOT NULL,
  total_rows        integer NOT NULL DEFAULT 0,
  new_rows          integer NOT NULL DEFAULT 0,
  duplicate_rows    integer NOT NULL DEFAULT 0,
  matched_rows      integer NOT NULL DEFAULT 0,
  unmatched_rows    integer NOT NULL DEFAULT 0,
  status            text NOT NULL DEFAULT 'processing'
                    CHECK (status IN ('processing','completed','partial','failed')),
  uploaded_by       uuid NOT NULL REFERENCES auth.users(id),
  error_message     text,
  processing_log    jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_carrier_imports_org_month
  ON public.carrier_activation_imports(organization_id, activation_month DESC);
CREATE INDEX IF NOT EXISTS idx_carrier_imports_org_status
  ON public.carrier_activation_imports(organization_id, status);

-- ---------------------------------------------------------------------------
-- 3. carrier_activations — every activation row from the Excel
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.carrier_activations (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  import_id             uuid NOT NULL REFERENCES public.carrier_activation_imports(id) ON DELETE CASCADE,

  -- Raw Excel columns (columns A–AJ)
  activation_count      integer NOT NULL DEFAULT 1,
  bundle_type           text,
  activation_month      date,
  activation_date       date NOT NULL,
  region                text,
  city                  text,
  distributor_name      text,
  channel               text CHECK (channel IN ('Direct Sales', 'Modern trade')),
  dealer_name           text,
  dealer_code           text NOT NULL,
  key_account_manager   text,
  account_manager       text,
  team_leader           text,
  sales_champion        text,
  segment_brand         text CHECK (segment_brand IN ('Virgin Mobile', 'FRiENDi mobile')),
  segment_group         text,
  customer_nationality  text,
  customer_id_type      text,
  latitude              numeric,
  longitude             numeric,
  activated_at          timestamptz,
  cas_location_id       text,
  cas_location_name     text,
  bundle_description    text,
  fpe_count             integer NOT NULL DEFAULT 0,
  ibr_value             numeric NOT NULL DEFAULT 0,
  ibr_value_excl_vat    numeric NOT NULL DEFAULT 0,
  first_recharge_value  numeric NOT NULL DEFAULT 0,
  second_recharge_value numeric NOT NULL DEFAULT 0,
  uid_percent           numeric NOT NULL DEFAULT 0,
  first_bundle_qty      integer NOT NULL DEFAULT 0,
  first_bundle_revenue  numeric NOT NULL DEFAULT 0,
  lifetime_recharge     numeric NOT NULL DEFAULT 0,
  initial_balance_total numeric NOT NULL DEFAULT 0,
  dealer_partner        text,
  subscription_type     text,

  -- Computed fields set during import matching
  matched_employee_id   uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  matched_supervisor_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  bundle_category       text,
  shift_type            text CHECK (shift_type IN ('morning', 'night')),
  is_duplicate          boolean NOT NULL DEFAULT false,

  created_at            timestamptz NOT NULL DEFAULT now(),

  -- Dedup: same activation identified by (org, dealer_code, activated_at)
  UNIQUE (organization_id, dealer_code, activated_at)
);

CREATE INDEX IF NOT EXISTS idx_carrier_act_org_date     ON public.carrier_activations(organization_id, activation_date);
CREATE INDEX IF NOT EXISTS idx_carrier_act_org_month    ON public.carrier_activations(organization_id, activation_month);
CREATE INDEX IF NOT EXISTS idx_carrier_act_dealer       ON public.carrier_activations(organization_id, dealer_code, activation_date);
CREATE INDEX IF NOT EXISTS idx_carrier_act_employee     ON public.carrier_activations(organization_id, matched_employee_id, activation_date);
CREATE INDEX IF NOT EXISTS idx_carrier_act_supervisor   ON public.carrier_activations(organization_id, matched_supervisor_id, activation_date);
CREATE INDEX IF NOT EXISTS idx_carrier_act_brand        ON public.carrier_activations(organization_id, segment_brand, activation_date);
CREATE INDEX IF NOT EXISTS idx_carrier_act_channel      ON public.carrier_activations(organization_id, channel, activation_date);
CREATE INDEX IF NOT EXISTS idx_carrier_act_region       ON public.carrier_activations(organization_id, region, activation_date);
CREATE INDEX IF NOT EXISTS idx_carrier_act_import       ON public.carrier_activations(import_id);

-- ---------------------------------------------------------------------------
-- 4. employee_dealer_codes — date-range based dealer code assignments
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.employee_dealer_codes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  employee_id     uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  dealer_code     text NOT NULL,
  dealer_name     text,
  channel         text CHECK (channel IN ('Direct Sales', 'Modern trade')),
  region          text,
  city            text,
  location_name   text,
  start_date      date NOT NULL,
  end_date        date,
  is_active       boolean NOT NULL DEFAULT true,
  notes           text,
  assigned_by     uuid REFERENCES auth.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dealer_codes_org_employee
  ON public.employee_dealer_codes(organization_id, employee_id, start_date DESC);
CREATE INDEX IF NOT EXISTS idx_dealer_codes_org_code
  ON public.employee_dealer_codes(organization_id, dealer_code, start_date DESC);
CREATE INDEX IF NOT EXISTS idx_dealer_codes_active
  ON public.employee_dealer_codes(organization_id, is_active, dealer_code);

-- ---------------------------------------------------------------------------
-- 5. carrier_sales_targets — monthly targets set by HR per employee
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.carrier_sales_targets (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  target_month        date NOT NULL,
  employee_id         uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  supervisor_id       uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  fpe_target          integer NOT NULL DEFAULT 0,
  revenue_target      numeric NOT NULL DEFAULT 0,
  friendi_target      integer NOT NULL DEFAULT 0,
  virgin_target       integer NOT NULL DEFAULT 0,
  postpaid_target     integer NOT NULL DEFAULT 0,
  hbb_target          integer NOT NULL DEFAULT 0,
  working_days        integer NOT NULL DEFAULT 25 CHECK (working_days BETWEEN 1 AND 31),
  set_by              uuid REFERENCES auth.users(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, target_month, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_carrier_targets_org_month
  ON public.carrier_sales_targets(organization_id, target_month);
CREATE INDEX IF NOT EXISTS idx_carrier_targets_supervisor
  ON public.carrier_sales_targets(organization_id, supervisor_id, target_month);

-- ---------------------------------------------------------------------------
-- 6. carrier_sales_verifications — discrepancy tracking
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.carrier_sales_verifications (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  import_id           uuid NOT NULL REFERENCES public.carrier_activation_imports(id) ON DELETE CASCADE,
  employee_id         uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  verification_date   date NOT NULL,

  carrier_fpe         integer NOT NULL DEFAULT 0,
  carrier_ibr         numeric NOT NULL DEFAULT 0,
  carrier_friendi     integer NOT NULL DEFAULT 0,
  carrier_virgin      integer NOT NULL DEFAULT 0,
  carrier_postpaid    integer NOT NULL DEFAULT 0,

  logged_fpe          integer NOT NULL DEFAULT 0,
  logged_ibr          numeric NOT NULL DEFAULT 0,
  logged_friendi      integer NOT NULL DEFAULT 0,
  logged_virgin       integer NOT NULL DEFAULT 0,
  logged_postpaid     integer NOT NULL DEFAULT 0,

  has_discrepancy     boolean NOT NULL DEFAULT false,
  discrepancy_type    text CHECK (discrepancy_type IN (
    'over_reported', 'under_reported', 'missing_log', 'extra_log'
  )),
  fpe_difference      integer NOT NULL DEFAULT 0,
  ibr_difference      numeric NOT NULL DEFAULT 0,

  seen_by_employee    boolean NOT NULL DEFAULT false,
  seen_by_hr          boolean NOT NULL DEFAULT false,
  seen_at_employee    timestamptz,
  seen_at_hr          timestamptz,
  employee_note       text,
  status              text NOT NULL DEFAULT 'open'
                      CHECK (status IN ('open','acknowledged','resolved')),

  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, import_id, employee_id, verification_date)
);

CREATE INDEX IF NOT EXISTS idx_verifications_org_employee
  ON public.carrier_sales_verifications(organization_id, employee_id, verification_date DESC);
CREATE INDEX IF NOT EXISTS idx_verifications_org_status
  ON public.carrier_sales_verifications(organization_id, status, has_discrepancy);
CREATE INDEX IF NOT EXISTS idx_verifications_unseen_employee
  ON public.carrier_sales_verifications(organization_id, employee_id, seen_by_employee)
  WHERE has_discrepancy = true AND seen_by_employee = false;

-- ---------------------------------------------------------------------------
-- 7. carrier_bundle_categories — configurable bundle tiers
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.carrier_bundle_categories (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  category_label  text NOT NULL,
  min_value       numeric NOT NULL,
  max_value       numeric,
  display_order   integer NOT NULL DEFAULT 0,
  color           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, category_label)
);

-- ---------------------------------------------------------------------------
-- 8. carrier_dashboard_config — global settings (shift times, thresholds)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.carrier_dashboard_config (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  config_key      text NOT NULL,
  config_value    text NOT NULL,
  updated_by      uuid REFERENCES auth.users(id),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, config_key)
);

-- ---------------------------------------------------------------------------
-- RLS Policies
-- ---------------------------------------------------------------------------

ALTER TABLE public.carrier_activation_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.carrier_activations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_dealer_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.carrier_sales_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.carrier_sales_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.carrier_bundle_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.carrier_dashboard_config ENABLE ROW LEVEL SECURITY;

-- carrier_activation_imports: org-scoped read; service role writes
CREATE POLICY "carrier_imports_select" ON public.carrier_activation_imports
  FOR SELECT USING (
    organization_id = public.current_org_id()
    OR auth.role() = 'service_role'
  );

-- carrier_activations: org-scoped read for all sales roles; service role writes
CREATE POLICY "carrier_activations_select" ON public.carrier_activations
  FOR SELECT USING (
    organization_id = public.current_org_id()
    OR auth.role() = 'service_role'
  );

-- employee_dealer_codes: org-scoped
CREATE POLICY "dealer_codes_select" ON public.employee_dealer_codes
  FOR SELECT USING (
    organization_id = public.current_org_id()
    OR auth.role() = 'service_role'
  );
CREATE POLICY "dealer_codes_modify" ON public.employee_dealer_codes
  FOR ALL USING (
    auth.role() = 'service_role'
    OR (
      organization_id = public.current_org_id()
      AND public.current_role() IN ('admin', 'hr_admin')
    )
  );

-- carrier_sales_targets: org-scoped
CREATE POLICY "carrier_targets_select" ON public.carrier_sales_targets
  FOR SELECT USING (
    organization_id = public.current_org_id()
    OR auth.role() = 'service_role'
  );
CREATE POLICY "carrier_targets_modify" ON public.carrier_sales_targets
  FOR ALL USING (
    auth.role() = 'service_role'
    OR (
      organization_id = public.current_org_id()
      AND public.current_role() IN ('admin', 'hr_admin')
    )
  );

-- carrier_sales_verifications: HR/manager sees all; employee sees own
CREATE POLICY "verifications_hr_select" ON public.carrier_sales_verifications
  FOR SELECT USING (
    auth.role() = 'service_role'
    OR (
      organization_id = public.current_org_id()
      AND public.current_role() IN ('admin', 'hr_admin', 'sales_manager')
    )
  );
CREATE POLICY "verifications_employee_select" ON public.carrier_sales_verifications
  FOR SELECT USING (
    employee_id IN (
      SELECT id FROM public.employees WHERE user_id = auth.uid()
    )
  );
CREATE POLICY "verifications_employee_update" ON public.carrier_sales_verifications
  FOR UPDATE USING (
    auth.role() = 'service_role'
    OR employee_id IN (
      SELECT id FROM public.employees WHERE user_id = auth.uid()
    )
  );

-- carrier_bundle_categories: org-scoped
CREATE POLICY "bundle_categories_select" ON public.carrier_bundle_categories
  FOR SELECT USING (
    organization_id = public.current_org_id()
    OR auth.role() = 'service_role'
  );
CREATE POLICY "bundle_categories_modify" ON public.carrier_bundle_categories
  FOR ALL USING (
    auth.role() = 'service_role'
    OR (
      organization_id = public.current_org_id()
      AND public.current_role() IN ('admin', 'hr_admin')
    )
  );

-- carrier_dashboard_config: org-scoped
CREATE POLICY "dashboard_config_select" ON public.carrier_dashboard_config
  FOR SELECT USING (
    organization_id = public.current_org_id()
    OR auth.role() = 'service_role'
  );
CREATE POLICY "dashboard_config_modify" ON public.carrier_dashboard_config
  FOR ALL USING (
    auth.role() = 'service_role'
    OR (
      organization_id = public.current_org_id()
      AND public.current_role() IN ('admin', 'hr_admin')
    )
  );

-- ---------------------------------------------------------------------------
-- Seed default bundle categories for every existing organization
-- (idempotent via ON CONFLICT DO NOTHING)
-- ---------------------------------------------------------------------------
INSERT INTO public.carrier_bundle_categories
  (organization_id, category_label, min_value, max_value, display_order, color)
SELECT
  o.id,
  c.category_label,
  c.min_value,
  c.max_value,
  c.display_order,
  c.color
FROM public.organizations o
CROSS JOIN (VALUES
  ('+10', 10,   20,   1, '#ddd6fe'),
  ('+20', 20,   30,   2, '#c4b5fd'),
  ('+30', 30,   50,   3, '#a78bfa'),
  ('+45', 50,   70,   4, '#8b5cf6'),
  ('+70', 70,   100,  5, '#6366f1'),
  ('+90', 100,  NULL, 6, '#3b82f6')
) AS c(category_label, min_value, max_value, display_order, color)
ON CONFLICT (organization_id, category_label) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Seed default dashboard config for every existing organization
-- (idempotent via ON CONFLICT DO NOTHING)
-- ---------------------------------------------------------------------------
INSERT INTO public.carrier_dashboard_config
  (organization_id, config_key, config_value)
SELECT o.id, k.config_key, k.config_value
FROM public.organizations o
CROSS JOIN (VALUES
  ('shift_morning_start',           '08:00'),
  ('shift_night_start',             '16:00'),
  ('verification_tolerance_percent','5'),
  ('location_active_threshold',     '100'),
  ('location_acceptable_threshold', '85'),
  ('location_warning_threshold',    '70')
) AS k(config_key, config_value)
ON CONFLICT (organization_id, config_key) DO NOTHING;
