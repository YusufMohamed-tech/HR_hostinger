-- Complete SQL-side Carrier reporting and immutable, versioned reconciliation.

CREATE TABLE IF NOT EXISTS public.carrier_product_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  sales_product_id uuid NOT NULL REFERENCES public.sales_products(id) ON DELETE CASCADE,
  segment_brand text NOT NULL CHECK (segment_brand IN ('Virgin Mobile', 'FRiENDi mobile')),
  segment_group text NOT NULL,
  fpe_multiplier numeric(12,4) NOT NULL DEFAULT 1 CHECK (fpe_multiplier >= 0),
  ibr_source text NOT NULL DEFAULT 'line_total' CHECK (ibr_source IN ('line_total', 'fixed')),
  fixed_ibr_value numeric(14,2) CHECK (fixed_ibr_value IS NULL OR fixed_ibr_value >= 0),
  effective_from date NOT NULL DEFAULT CURRENT_DATE,
  effective_to date,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, sales_product_id),
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CHECK (ibr_source <> 'fixed' OR fixed_ibr_value IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS carrier_product_mappings_org_active_idx
  ON public.carrier_product_mappings(organization_id, is_active, sales_product_id);

CREATE TABLE IF NOT EXISTS public.carrier_verification_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  import_id uuid NOT NULL REFERENCES public.carrier_activation_imports(id) ON DELETE RESTRICT,
  run_version integer NOT NULL CHECK (run_version > 0),
  date_range_start date NOT NULL,
  date_range_end date NOT NULL,
  tolerance_percent numeric(8,4) NOT NULL CHECK (tolerance_percent BETWEEN 0 AND 100),
  source_cutoff timestamptz NOT NULL,
  mapping_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'completed', 'failed')),
  checked_count integer NOT NULL DEFAULT 0 CHECK (checked_count >= 0),
  discrepancy_count integer NOT NULL DEFAULT 0 CHECK (discrepancy_count >= 0),
  error_message text,
  requested_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  request_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (organization_id, import_id, run_version)
);

ALTER TABLE public.carrier_sales_verifications
  ADD COLUMN IF NOT EXISTS run_id uuid REFERENCES public.carrier_verification_runs(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS unmapped_item_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE public.carrier_sales_verifications DROP CONSTRAINT IF EXISTS carrier_sales_verifications_discrepancy_type_check;
ALTER TABLE public.carrier_sales_verifications ADD CONSTRAINT carrier_sales_verifications_discrepancy_type_check
  CHECK (discrepancy_type IN (
    'over_reported', 'under_reported', 'missing_log', 'extra_log', 'mapping_missing'
  ));
ALTER TABLE public.carrier_sales_verifications
  DROP CONSTRAINT IF EXISTS carrier_sales_verifications_version_check,
  ADD CONSTRAINT carrier_sales_verifications_version_check CHECK (version > 0);
DO $$
DECLARE constraint_name text;
BEGIN
  SELECT conname INTO constraint_name FROM pg_constraint
  WHERE conrelid = 'public.carrier_sales_verifications'::regclass AND contype = 'u'
    AND pg_get_constraintdef(oid) LIKE '%organization_id%import_id%employee_id%verification_date%'
  LIMIT 1;
  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.carrier_sales_verifications DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS uq_carrier_verification_run_employee_date
  ON public.carrier_sales_verifications(run_id, employee_id, verification_date)
  WHERE run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS carrier_verification_runs_org_import_idx
  ON public.carrier_verification_runs(organization_id, import_id, run_version DESC);

ALTER TABLE public.carrier_product_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.carrier_verification_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY carrier_product_mappings_select ON public.carrier_product_mappings FOR SELECT USING (
  auth.role() = 'service_role' OR organization_id = public.current_org_id()
);
CREATE POLICY carrier_verification_runs_select ON public.carrier_verification_runs FOR SELECT USING (
  auth.role() = 'service_role' OR (organization_id = public.current_org_id()
    AND public.current_role() IN ('admin', 'hr_admin', 'sales_manager'))
);
DROP POLICY IF EXISTS verifications_employee_select ON public.carrier_sales_verifications;
CREATE POLICY verifications_employee_select ON public.carrier_sales_verifications FOR SELECT USING (
  organization_id = public.current_org_id() AND employee_id IN (
    SELECT employee.id FROM public.employees employee
    WHERE employee.org_id = public.current_org_id() AND employee.user_id = auth.uid()
  )
);
DROP POLICY IF EXISTS verifications_employee_update ON public.carrier_sales_verifications;

CREATE OR REPLACE FUNCTION public.carrier_dashboard_snapshot(p_org_id uuid, p_filters jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE result jsonb;
BEGIN
  IF auth.role() <> 'service_role' AND p_org_id IS DISTINCT FROM public.current_org_id() THEN
    RAISE EXCEPTION 'Cross-organization Carrier reporting is forbidden.' USING ERRCODE = '42501';
  END IF;
  IF NULLIF(p_filters->>'month', '') IS NOT NULL AND p_filters->>'month' !~ '^\d{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION 'Carrier report month must use YYYY-MM.' USING ERRCODE = '22023';
  END IF;
  WITH bounds AS (
    SELECT
      COALESCE(NULLIF(p_filters->>'dateFrom', '')::date,
        to_date(NULLIF(p_filters->>'month', '') || '-01', 'YYYY-MM-DD'),
        date_trunc('month', public.organization_business_date(p_org_id, now()))::date) AS date_from,
      COALESCE(NULLIF(p_filters->>'dateTo', '')::date,
        (to_date(NULLIF(p_filters->>'month', '') || '-01', 'YYYY-MM-DD') + INTERVAL '1 month - 1 day')::date,
        (date_trunc('month', public.organization_business_date(p_org_id, now())) + INTERVAL '1 month - 1 day')::date) AS date_to,
      GREATEST(1, LEAST(31, COALESCE(NULLIF(p_filters->>'workingDays', '')::integer, 25))) AS working_days
  ),
  filtered AS MATERIALIZED (
    SELECT activation.* FROM public.carrier_activations activation
    JOIN public.carrier_activation_imports import ON import.id = activation.import_id
      AND import.organization_id = p_org_id AND import.status IN ('completed', 'partial')
    CROSS JOIN bounds
    WHERE activation.organization_id = p_org_id
      AND activation.activation_date BETWEEN bounds.date_from AND bounds.date_to
      AND (NULLIF(p_filters->>'region', '') IS NULL OR activation.region = p_filters->>'region')
      AND (NULLIF(p_filters->>'channel', '') IS NULL OR activation.channel = p_filters->>'channel')
      AND (NULLIF(p_filters->>'supervisorId', '') IS NULL OR activation.matched_supervisor_id = (p_filters->>'supervisorId')::uuid)
      AND (NULLIF(p_filters->>'employeeId', '') IS NULL OR activation.matched_employee_id = (p_filters->>'employeeId')::uuid)
      AND (NULLIF(p_filters->>'segmentBrand', '') IS NULL OR activation.segment_brand = p_filters->>'segmentBrand')
  ),
  relevant_imports AS MATERIALIZED (
    SELECT import.* FROM public.carrier_activation_imports import CROSS JOIN bounds
    WHERE import.organization_id = p_org_id AND import.status IN ('completed', 'partial')
      AND import.date_range_start <= bounds.date_to AND import.date_range_end >= bounds.date_from
  ),
  employee_totals AS (
    SELECT activation.matched_employee_id AS employee_id,
      sum(activation.fpe_count)::numeric AS fpe,
      sum(activation.fpe_count) FILTER (WHERE activation.segment_brand = 'FRiENDi mobile')::numeric AS friendi,
      sum(activation.fpe_count) FILTER (WHERE activation.segment_brand = 'Virgin Mobile' AND activation.segment_group = 'Virgin Prepaid')::numeric AS virgin,
      count(*) FILTER (WHERE activation.segment_group = 'Virgin Postpaid')::integer AS postpaid,
      count(*) FILTER (WHERE activation.segment_group = 'Virgin HBB')::integer AS hbb,
      sum(activation.ibr_value)::numeric AS ibr
    FROM filtered activation WHERE activation.matched_employee_id IS NOT NULL
    GROUP BY activation.matched_employee_id
  ),
  employee_bundles AS (
    SELECT matched_employee_id AS employee_id,
      jsonb_object_agg(bundle_category, quantity) AS bundle_counts
    FROM (
      SELECT matched_employee_id, bundle_category, sum(fpe_count)::numeric AS quantity
      FROM filtered WHERE matched_employee_id IS NOT NULL AND bundle_category IS NOT NULL
      GROUP BY matched_employee_id, bundle_category
    ) bundle GROUP BY matched_employee_id
  ),
  supervisor_totals AS (
    SELECT activation.matched_supervisor_id AS supervisor_id,
      sum(activation.fpe_count)::numeric AS fpe, sum(activation.ibr_value)::numeric AS ibr,
      count(*) FILTER (WHERE activation.segment_group = 'Virgin Postpaid')::integer AS postpaid,
      count(*) FILTER (WHERE activation.segment_group = 'Virgin HBB')::integer AS hbb,
      count(DISTINCT activation.matched_employee_id)::integer AS employee_count
    FROM filtered activation WHERE activation.matched_supervisor_id IS NOT NULL
    GROUP BY activation.matched_supervisor_id
  )
  SELECT jsonb_build_object(
    'kpis', (SELECT jsonb_build_object(
      'fpe', COALESCE(sum(fpe_count), 0),
      'fpeFriendi', COALESCE(sum(fpe_count) FILTER (WHERE segment_brand = 'FRiENDi mobile'), 0),
      'fpeVirgin', COALESCE(sum(fpe_count) FILTER (WHERE segment_brand = 'Virgin Mobile' AND segment_group = 'Virgin Prepaid'), 0),
      'postpaid', count(*) FILTER (WHERE segment_group = 'Virgin Postpaid'),
      'hbb', count(*) FILTER (WHERE segment_group = 'Virgin HBB'),
      'ibr', COALESCE(sum(ibr_value), 0),
      'ibrFriendi', COALESCE(sum(ibr_value) FILTER (WHERE segment_brand = 'FRiENDi mobile'), 0),
      'ibrVirgin', COALESCE(sum(ibr_value) FILTER (WHERE segment_brand = 'Virgin Mobile'), 0),
      'users', count(DISTINCT dealer_code), 'employees', count(DISTINCT matched_employee_id),
      'activationsTotal', count(*)
    ) FROM filtered),
    'daily', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'date', daily.activation_date, 'fpe', daily.fpe, 'ibr', daily.ibr,
      'friendi', daily.friendi, 'virgin', daily.virgin, 'postpaid', daily.postpaid
    ) ORDER BY daily.activation_date) FROM (
      SELECT activation_date, sum(fpe_count) AS fpe, sum(ibr_value) AS ibr,
        COALESCE(sum(fpe_count) FILTER (WHERE segment_brand = 'FRiENDi mobile'), 0) AS friendi,
        COALESCE(sum(fpe_count) FILTER (WHERE segment_brand = 'Virgin Mobile' AND segment_group = 'Virgin Prepaid'), 0) AS virgin,
        count(*) FILTER (WHERE segment_group = 'Virgin Postpaid') AS postpaid
      FROM filtered GROUP BY activation_date
    ) daily), '[]'::jsonb),
    'employees', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'employeeId', total.employee_id, 'employeeName', employee.full_name,
      'gosiRegistered', employee.gosi_registered, 'fpe', total.fpe,
      'fpeFriendi', COALESCE(total.friendi, 0), 'fpeVirgin', COALESCE(total.virgin, 0),
      'postpaid', total.postpaid, 'hbb', total.hbb, 'ibr', total.ibr,
      'bundleCounts', COALESCE(bundle.bundle_counts, '{}'::jsonb),
      'fpeTarget', target.fpe_target, 'revenueTarget', target.revenue_target
    ) ORDER BY total.fpe DESC)
    FROM employee_totals total JOIN public.employees employee ON employee.id = total.employee_id AND employee.org_id = p_org_id
    LEFT JOIN employee_bundles bundle ON bundle.employee_id = total.employee_id
    LEFT JOIN public.carrier_sales_targets target ON target.organization_id = p_org_id
      AND target.employee_id = total.employee_id
      AND target.target_month = (SELECT date_trunc('month', date_from)::date FROM bounds)), '[]'::jsonb),
    'supervisors', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'supervisorId', total.supervisor_id, 'supervisorName', employee.full_name,
      'fpe', total.fpe, 'ibr', total.ibr, 'postpaid', total.postpaid, 'hbb', total.hbb,
      'fpeTarget', targets.fpe_target, 'revenueTarget', targets.revenue_target,
      'employeeCount', total.employee_count
    ) ORDER BY total.fpe DESC)
    FROM supervisor_totals total JOIN public.employees employee ON employee.id = total.supervisor_id AND employee.org_id = p_org_id
    LEFT JOIN (
      SELECT supervisor_id, sum(fpe_target) AS fpe_target, sum(revenue_target) AS revenue_target
      FROM public.carrier_sales_targets CROSS JOIN bounds
      WHERE organization_id = p_org_id AND target_month = date_trunc('month', bounds.date_from)::date
        AND supervisor_id IS NOT NULL GROUP BY supervisor_id
    ) targets ON targets.supervisor_id = total.supervisor_id), '[]'::jsonb),
    'bundles', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'bundleCategory', bundle_category, 'count', quantity, 'ibr', ibr,
      'channel', channel, 'region', region
    ) ORDER BY quantity DESC) FROM (
      SELECT bundle_category, channel, region, sum(fpe_count) AS quantity, sum(ibr_value) AS ibr
      FROM filtered WHERE bundle_category IS NOT NULL GROUP BY bundle_category, channel, region
    ) bundle), '[]'::jsonb),
    'shifts', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'hour', hour, 'morning', morning, 'night', night
    ) ORDER BY hour) FROM (
      SELECT extract(hour FROM activation.activated_at AT TIME ZONE COALESCE(settings.timezone, 'UTC'))::integer AS hour,
        count(*) FILTER (WHERE activation.shift_type = 'morning') AS morning,
        count(*) FILTER (WHERE activation.shift_type = 'night') AS night
      FROM filtered activation LEFT JOIN public.organization_settings settings ON settings.org_id = p_org_id
      WHERE activation.activated_at IS NOT NULL GROUP BY 1
    ) shift), '[]'::jsonb),
    'locations', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'locationName', location_name, 'dealerCode', dealer_code, 'region', region, 'channel', channel,
      'totalActivations', total_activations, 'daysWithActivations', days_with_activations,
      'lastActivationDate', last_activation_date, 'coveragePercent', coverage_percent,
      'status', CASE WHEN coverage_percent >= 100 THEN 'active' WHEN coverage_percent >= 85 THEN 'acceptable'
        WHEN coverage_percent >= 70 THEN 'warning' ELSE 'inactive' END
    ) ORDER BY total_activations DESC) FROM (
      SELECT COALESCE(cas_location_name, dealer_code) AS location_name, dealer_code, min(region) AS region,
        min(channel) AS channel, count(*) AS total_activations,
        count(DISTINCT activation_date) AS days_with_activations, max(activation_date) AS last_activation_date,
        round(count(DISTINCT activation_date)::numeric / (SELECT working_days FROM bounds) * 100, 2) AS coverage_percent
      FROM filtered GROUP BY COALESCE(cas_location_name, dealer_code), dealer_code
    ) location), '[]'::jsonb),
    'completeness', (SELECT jsonb_build_object(
      'importIds', COALESCE(jsonb_agg(id ORDER BY created_at), '[]'::jsonb),
      'importCount', count(*), 'sourceTotalRows', COALESCE(sum(total_rows), 0),
      'publishedRows', COALESCE(sum(new_rows), 0), 'duplicateRows', COALESCE(sum(duplicate_rows), 0),
      'rejectedRows', COALESCE(sum(rejected_rows), 0), 'matchedRows', COALESCE(sum(matched_rows), 0),
      'unmatchedRows', COALESCE(sum(unmatched_rows), 0),
      'filteredRowCount', (SELECT count(*) FROM filtered),
      'controlFpe', (SELECT COALESCE(sum(fpe_count), 0) FROM filtered),
      'dateRangeStart', (SELECT date_from FROM bounds), 'dateRangeEnd', (SELECT date_to FROM bounds),
      'refreshedAt', max(COALESCE(published_at, updated_at)),
      'complete', COALESCE(bool_and(status IN ('completed', 'partial')), false)
    ) FROM relevant_imports)
  ) INTO result;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.run_carrier_verification(
  p_org_id uuid, p_actor_user_id uuid, p_request_id uuid, p_import_id uuid
)
RETURNS SETOF public.carrier_verification_runs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  import_row public.carrier_activation_imports%ROWTYPE;
  run_row public.carrier_verification_runs%ROWTYPE;
  actor_role_value text; tolerance_value numeric; checked_value integer; discrepancy_value integer;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501'; END IF;
  SELECT role::text INTO actor_role_value FROM public.org_members WHERE org_id = p_org_id
    AND user_id = p_actor_user_id AND role::text IN ('admin', 'hr_admin', 'sales_manager');
  IF actor_role_value IS NULL THEN RAISE EXCEPTION 'Carrier verification management access is required.' USING ERRCODE = '42501'; END IF;
  SELECT * INTO import_row FROM public.carrier_activation_imports
  WHERE organization_id = p_org_id AND id = p_import_id AND status IN ('completed', 'partial');
  IF import_row.id IS NULL THEN RAISE EXCEPTION 'A published Carrier import is required.' USING ERRCODE = '55000'; END IF;
  SELECT COALESCE(NULLIF(config_value, '')::numeric, 5) INTO tolerance_value
  FROM public.carrier_dashboard_config WHERE organization_id = p_org_id AND config_key = 'verification_tolerance_percent';
  tolerance_value := COALESCE(tolerance_value, 5);
  INSERT INTO public.carrier_verification_runs (
    organization_id, import_id, run_version, date_range_start, date_range_end,
    tolerance_percent, source_cutoff, mapping_snapshot, requested_by, request_id
  ) VALUES (
    p_org_id, p_import_id,
    COALESCE((SELECT max(run_version) + 1 FROM public.carrier_verification_runs WHERE organization_id = p_org_id AND import_id = p_import_id), 1),
    import_row.date_range_start, import_row.date_range_end, tolerance_value, now(),
    COALESCE((SELECT jsonb_agg(to_jsonb(mapping) ORDER BY mapping.sales_product_id)
      FROM public.carrier_product_mappings mapping WHERE mapping.organization_id = p_org_id AND mapping.is_active), '[]'::jsonb),
    p_actor_user_id, p_request_id
  ) RETURNING * INTO run_row;
  BEGIN
    WITH carrier AS (
      SELECT matched_employee_id AS employee_id, activation_date AS business_date,
        sum(fpe_count)::numeric AS fpe, sum(ibr_value)::numeric AS ibr,
        sum(fpe_count) FILTER (WHERE segment_brand = 'FRiENDi mobile')::numeric AS friendi,
        sum(fpe_count) FILTER (WHERE segment_brand = 'Virgin Mobile' AND segment_group = 'Virgin Prepaid')::numeric AS virgin,
        count(*) FILTER (WHERE segment_group = 'Virgin Postpaid')::numeric AS postpaid
      FROM public.carrier_activations WHERE organization_id = p_org_id AND import_id = p_import_id
        AND matched_employee_id IS NOT NULL GROUP BY matched_employee_id, activation_date
    ),
    internal AS (
      SELECT employee.id AS employee_id, log.log_date AS business_date,
        COALESCE(sum((item->>'quantity')::numeric * mapping.fpe_multiplier) FILTER (WHERE mapping.id IS NOT NULL), 0) AS fpe,
        COALESCE(sum(CASE mapping.ibr_source WHEN 'fixed' THEN (item->>'quantity')::numeric * mapping.fixed_ibr_value
          ELSE (item->>'line_total')::numeric END) FILTER (WHERE mapping.id IS NOT NULL), 0) AS ibr,
        COALESCE(sum((item->>'quantity')::numeric * mapping.fpe_multiplier) FILTER (WHERE mapping.segment_brand = 'FRiENDi mobile'), 0) AS friendi,
        COALESCE(sum((item->>'quantity')::numeric * mapping.fpe_multiplier) FILTER (WHERE mapping.segment_brand = 'Virgin Mobile' AND mapping.segment_group = 'Virgin Prepaid'), 0) AS virgin,
        COALESCE(sum((item->>'quantity')::numeric) FILTER (WHERE mapping.segment_group = 'Virgin Postpaid'), 0) AS postpaid,
        count(*) FILTER (WHERE mapping.id IS NULL)::integer AS unmapped_count
      FROM public.sales_logs log
      JOIN public.employees employee ON employee.org_id = p_org_id AND employee.user_id = log.sales_agent_id
      CROSS JOIN LATERAL jsonb_array_elements(log.items) item
      LEFT JOIN public.carrier_product_mappings mapping ON mapping.organization_id = p_org_id
        AND mapping.sales_product_id = (item->>'product_id')::uuid AND mapping.is_active
        AND mapping.effective_from <= log.log_date AND (mapping.effective_to IS NULL OR mapping.effective_to >= log.log_date)
      WHERE log.organization_id = p_org_id AND log.status <> 'voided'
        AND log.log_date BETWEEN import_row.date_range_start AND import_row.date_range_end
      GROUP BY employee.id, log.log_date
    ),
    combined AS (
      SELECT COALESCE(carrier.employee_id, internal.employee_id) AS employee_id,
        COALESCE(carrier.business_date, internal.business_date) AS business_date,
        COALESCE(carrier.fpe, 0) AS carrier_fpe, COALESCE(carrier.ibr, 0) AS carrier_ibr,
        COALESCE(carrier.friendi, 0) AS carrier_friendi, COALESCE(carrier.virgin, 0) AS carrier_virgin,
        COALESCE(carrier.postpaid, 0) AS carrier_postpaid,
        COALESCE(internal.fpe, 0) AS logged_fpe, COALESCE(internal.ibr, 0) AS logged_ibr,
        COALESCE(internal.friendi, 0) AS logged_friendi, COALESCE(internal.virgin, 0) AS logged_virgin,
        COALESCE(internal.postpaid, 0) AS logged_postpaid, COALESCE(internal.unmapped_count, 0) AS unmapped_count,
        carrier.employee_id IS NULL AS internal_only, internal.employee_id IS NULL AS carrier_only
      FROM carrier FULL OUTER JOIN internal USING (employee_id, business_date)
    ),
    classified AS (
      SELECT combined.*,
        (logged_fpe - carrier_fpe) AS fpe_diff, (logged_ibr - carrier_ibr) AS ibr_diff,
        CASE
          WHEN internal_only THEN 'extra_log'
          WHEN carrier_only THEN 'missing_log'
          WHEN unmapped_count > 0 THEN 'mapping_missing'
          WHEN abs(logged_fpe - carrier_fpe) > GREATEST(abs(carrier_fpe), 1) * tolerance_value / 100
            OR abs(logged_ibr - carrier_ibr) > GREATEST(abs(carrier_ibr), 1) * tolerance_value / 100
          THEN CASE WHEN (logged_fpe - carrier_fpe) <> 0
            THEN CASE WHEN logged_fpe > carrier_fpe THEN 'over_reported' ELSE 'under_reported' END
            ELSE CASE WHEN logged_ibr > carrier_ibr THEN 'over_reported' ELSE 'under_reported' END END
          ELSE NULL
        END AS discrepancy
      FROM combined
    )
    INSERT INTO public.carrier_sales_verifications (
      organization_id, import_id, run_id, employee_id, verification_date,
      carrier_fpe, carrier_ibr, carrier_friendi, carrier_virgin, carrier_postpaid,
      logged_fpe, logged_ibr, logged_friendi, logged_virgin, logged_postpaid,
      has_discrepancy, discrepancy_type, fpe_difference, ibr_difference, unmapped_item_count
    ) SELECT p_org_id, p_import_id, run_row.id, employee_id, business_date,
      carrier_fpe::integer, carrier_ibr, carrier_friendi::integer, carrier_virgin::integer, carrier_postpaid::integer,
      logged_fpe::integer, logged_ibr, logged_friendi::integer, logged_virgin::integer, logged_postpaid::integer,
      discrepancy IS NOT NULL, discrepancy, fpe_diff::integer, ibr_diff, unmapped_count
    FROM classified;
    GET DIAGNOSTICS checked_value = ROW_COUNT;
    SELECT count(*) INTO discrepancy_value FROM public.carrier_sales_verifications
    WHERE organization_id = p_org_id AND run_id = run_row.id AND has_discrepancy;
    UPDATE public.carrier_verification_runs SET status = 'completed', checked_count = checked_value,
      discrepancy_count = discrepancy_value, completed_at = now()
    WHERE id = run_row.id RETURNING * INTO run_row;
  EXCEPTION WHEN OTHERS THEN
    UPDATE public.carrier_verification_runs SET status = 'failed', error_message = left(SQLERRM, 2000), completed_at = now()
    WHERE id = run_row.id RETURNING * INTO run_row;
  END;
  RETURN NEXT run_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.rematch_carrier_activations(
  p_org_id uuid, p_actor_user_id uuid, p_request_id uuid, p_month date
)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE actor_role_value text; updated_count integer;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501'; END IF;
  SELECT role::text INTO actor_role_value FROM public.org_members WHERE org_id = p_org_id AND user_id = p_actor_user_id
    AND role::text IN ('admin', 'hr_admin', 'sales_manager');
  IF actor_role_value IS NULL THEN RAISE EXCEPTION 'Carrier rematch management access is required.' USING ERRCODE = '42501'; END IF;
  IF p_month <> date_trunc('month', p_month)::date THEN RAISE EXCEPTION 'Carrier rematch month is invalid.' USING ERRCODE = '22023'; END IF;
  UPDATE public.carrier_activations activation SET
    matched_employee_id = assignment.employee_id,
    matched_supervisor_id = employee.carrier_supervisor_id
  FROM LATERAL (
    SELECT code.employee_id FROM public.employee_dealer_codes code
    WHERE code.organization_id = p_org_id AND code.dealer_code = activation.dealer_code
      AND code.is_active AND code.start_date <= activation.activation_date
      AND (code.end_date IS NULL OR code.end_date >= activation.activation_date)
    ORDER BY code.start_date DESC LIMIT 1
  ) assignment
  JOIN public.employees employee ON employee.id = assignment.employee_id AND employee.org_id = p_org_id
  WHERE activation.organization_id = p_org_id AND activation.matched_employee_id IS NULL
    AND activation.activation_date >= p_month AND activation.activation_date < p_month + INTERVAL '1 month';
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  INSERT INTO public.operational_audit_logs (org_id, request_id, actor_user_id, actor_role, action,
    target_type, target_id, outcome, status_code, metadata)
  VALUES (p_org_id, p_request_id, p_actor_user_id, actor_role_value, 'carrier.activations_rematched',
    'carrier_activation_month', to_char(p_month, 'YYYY-MM'), 'success', 200,
    jsonb_build_object('updated_count', updated_count));
  RETURN updated_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_carrier_verification(
  p_org_id uuid, p_actor_user_id uuid, p_request_id uuid, p_verification_id uuid,
  p_expected_version integer, p_payload jsonb
)
RETURNS SETOF public.carrier_sales_verifications
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE verification_row public.carrier_sales_verifications%ROWTYPE; actor_role_value text; employee_id_value uuid;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501'; END IF;
  SELECT role::text INTO actor_role_value FROM public.org_members WHERE org_id = p_org_id AND user_id = p_actor_user_id;
  SELECT id INTO employee_id_value FROM public.employees WHERE org_id = p_org_id AND user_id = p_actor_user_id;
  SELECT * INTO verification_row FROM public.carrier_sales_verifications
  WHERE organization_id = p_org_id AND id = p_verification_id FOR UPDATE;
  IF verification_row.id IS NULL THEN RAISE EXCEPTION 'Carrier verification was not found.' USING ERRCODE = 'P0002'; END IF;
  IF verification_row.version <> p_expected_version THEN RAISE EXCEPTION 'Carrier verification version conflict.' USING ERRCODE = '40001'; END IF;
  IF actor_role_value IN ('admin', 'hr_admin', 'sales_manager') THEN
    IF NULLIF(p_payload->>'status', '') IS NOT NULL AND p_payload->>'status' NOT IN ('open', 'acknowledged', 'resolved') THEN
      RAISE EXCEPTION 'Carrier verification status is invalid.' USING ERRCODE = '22023';
    END IF;
    UPDATE public.carrier_sales_verifications SET
      seen_by_hr = COALESCE((p_payload->>'seen_by_hr')::boolean, seen_by_hr),
      seen_at_hr = CASE WHEN COALESCE((p_payload->>'seen_by_hr')::boolean, false) THEN COALESCE(seen_at_hr, now()) ELSE seen_at_hr END,
      status = COALESCE(NULLIF(p_payload->>'status', ''), status), version = version + 1
    WHERE id = verification_row.id RETURNING * INTO verification_row;
  ELSIF employee_id_value = verification_row.employee_id THEN
    UPDATE public.carrier_sales_verifications SET
      seen_by_employee = COALESCE((p_payload->>'seen_by_employee')::boolean, seen_by_employee),
      seen_at_employee = CASE WHEN COALESCE((p_payload->>'seen_by_employee')::boolean, false) THEN COALESCE(seen_at_employee, now()) ELSE seen_at_employee END,
      employee_note = CASE WHEN p_payload ? 'employee_note' THEN left(NULLIF(btrim(p_payload->>'employee_note'), ''), 2000) ELSE employee_note END,
      status = CASE WHEN p_payload->>'status' = 'acknowledged' THEN 'acknowledged' ELSE status END,
      version = version + 1
    WHERE id = verification_row.id RETURNING * INTO verification_row;
  ELSE
    RAISE EXCEPTION 'Carrier verification is outside the actor scope.' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.operational_audit_logs (org_id, request_id, actor_user_id, actor_role, action,
    target_type, target_id, outcome, status_code, metadata)
  VALUES (p_org_id, p_request_id, p_actor_user_id, actor_role_value, 'carrier.verification_updated',
    'carrier_sales_verifications', verification_row.id::text, 'success', 200,
    jsonb_build_object('version', verification_row.version, 'status', verification_row.status));
  RETURN NEXT verification_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_carrier_product_mapping(
  p_org_id uuid, p_actor_user_id uuid, p_request_id uuid, p_sales_product_id uuid, p_payload jsonb
)
RETURNS SETOF public.carrier_product_mappings
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE mapping_row public.carrier_product_mappings%ROWTYPE; product_company_id uuid; actor_role_value text;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501'; END IF;
  SELECT role::text INTO actor_role_value FROM public.org_members WHERE org_id = p_org_id AND user_id = p_actor_user_id
    AND role::text IN ('admin', 'hr_admin', 'sales_manager');
  IF actor_role_value IS NULL THEN RAISE EXCEPTION 'Carrier product mapping access is required.' USING ERRCODE = '42501'; END IF;
  SELECT company_id INTO product_company_id FROM public.sales_products
  WHERE organization_id = p_org_id AND id = p_sales_product_id;
  IF product_company_id IS NULL THEN RAISE EXCEPTION 'Sales product was not found in this organization.' USING ERRCODE = 'P0002'; END IF;
  IF actor_role_value = 'sales_manager' AND NOT EXISTS (
    SELECT 1 FROM public.sales_company_assignments assignment
    WHERE assignment.organization_id = p_org_id AND assignment.company_id = product_company_id
      AND assignment.user_id = p_actor_user_id AND assignment.assignment_role = 'manager'
      AND assignment.is_active AND assignment.start_date <= public.organization_business_date(p_org_id, now())
      AND (assignment.end_date IS NULL OR assignment.end_date >= public.organization_business_date(p_org_id, now()))
  ) THEN RAISE EXCEPTION 'The sales manager is not assigned to this product company.' USING ERRCODE = '42501'; END IF;
  IF p_payload->>'segment_brand' NOT IN ('Virgin Mobile', 'FRiENDi mobile')
     OR length(btrim(COALESCE(p_payload->>'segment_group', ''))) < 2
     OR COALESCE((p_payload->>'fpe_multiplier')::numeric, -1) < 0
     OR COALESCE(p_payload->>'ibr_source', 'line_total') NOT IN ('line_total', 'fixed')
     OR (p_payload->>'ibr_source' = 'fixed' AND COALESCE((p_payload->>'fixed_ibr_value')::numeric, -1) < 0) THEN
    RAISE EXCEPTION 'Carrier product mapping is invalid.' USING ERRCODE = '23514';
  END IF;
  INSERT INTO public.carrier_product_mappings (
    organization_id, sales_product_id, segment_brand, segment_group, fpe_multiplier,
    ibr_source, fixed_ibr_value, effective_from, effective_to, is_active, created_by
  ) VALUES (
    p_org_id, p_sales_product_id, p_payload->>'segment_brand', btrim(p_payload->>'segment_group'),
    (p_payload->>'fpe_multiplier')::numeric, COALESCE(p_payload->>'ibr_source', 'line_total'),
    NULLIF(p_payload->>'fixed_ibr_value', '')::numeric,
    COALESCE(NULLIF(p_payload->>'effective_from', '')::date, public.organization_business_date(p_org_id, now())),
    NULLIF(p_payload->>'effective_to', '')::date, COALESCE((p_payload->>'is_active')::boolean, true), p_actor_user_id
  ) ON CONFLICT (organization_id, sales_product_id) DO UPDATE SET
    segment_brand = EXCLUDED.segment_brand, segment_group = EXCLUDED.segment_group,
    fpe_multiplier = EXCLUDED.fpe_multiplier, ibr_source = EXCLUDED.ibr_source,
    fixed_ibr_value = EXCLUDED.fixed_ibr_value, effective_from = EXCLUDED.effective_from,
    effective_to = EXCLUDED.effective_to, is_active = EXCLUDED.is_active, updated_at = now()
  RETURNING * INTO mapping_row;
  INSERT INTO public.operational_audit_logs (org_id, request_id, actor_user_id, actor_role, action,
    target_type, target_id, outcome, status_code, metadata)
  VALUES (p_org_id, p_request_id, p_actor_user_id, actor_role_value, 'carrier.product_mapping_saved',
    'carrier_product_mappings', mapping_row.id::text, 'success', 200,
    jsonb_build_object('sales_product_id', p_sales_product_id, 'segment_brand', mapping_row.segment_brand,
      'segment_group', mapping_row.segment_group, 'is_active', mapping_row.is_active));
  RETURN NEXT mapping_row;
END;
$$;

REVOKE ALL ON FUNCTION public.carrier_dashboard_snapshot(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.run_carrier_verification(uuid, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rematch_carrier_activations(uuid, uuid, uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_carrier_verification(uuid, uuid, uuid, uuid, integer, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.save_carrier_product_mapping(uuid, uuid, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.carrier_dashboard_snapshot(uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.run_carrier_verification(uuid, uuid, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.rematch_carrier_activations(uuid, uuid, uuid, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_carrier_verification(uuid, uuid, uuid, uuid, integer, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.save_carrier_product_mapping(uuid, uuid, uuid, uuid, jsonb) TO service_role;
