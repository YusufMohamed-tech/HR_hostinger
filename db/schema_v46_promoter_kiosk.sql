-- Promoter kiosk foundation. Additive only.

ALTER TYPE public.org_role ADD VALUE IF NOT EXISTS 'promoter';

CREATE TABLE IF NOT EXISTS public.promoter_reference_values (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('mobile_operator', 'internet_provider', 'city')),
  code text NOT NULL,
  label_ar text NOT NULL,
  label_en text,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, kind, code)
);

CREATE TABLE IF NOT EXISTS public.telecom_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.sales_companies(id) ON DELETE SET NULL,
  product_id uuid REFERENCES public.sales_products(id) ON DELETE SET NULL,
  name_ar text NOT NULL,
  name_en text,
  offer_target text NOT NULL CHECK (offer_target IN ('mobile', 'home_internet', 'bundle', 'addon')),
  monthly_price numeric NOT NULL DEFAULT 0 CHECK (monthly_price >= 0),
  contract_months integer CHECK (contract_months IS NULL OR contract_months >= 0),
  data_gb numeric CHECK (data_gb IS NULL OR data_gb >= 0),
  minutes integer CHECK (minutes IS NULL OR minutes >= 0),
  sim_count integer CHECK (sim_count IS NULL OR sim_count >= 0),
  benefits_ar jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(benefits_ar) = 'array'),
  benefits_en jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(benefits_en) = 'array'),
  eligibility jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(eligibility) = 'object'),
  priority integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.promoter_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.sales_companies(id) ON DELETE SET NULL,
  name text NOT NULL,
  code text,
  start_date date,
  end_date date,
  target_leads integer CHECK (target_leads IS NULL OR target_leads >= 0),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
);

CREATE TABLE IF NOT EXISTS public.promoter_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.sales_companies(id) ON DELETE SET NULL,
  campaign_id uuid REFERENCES public.promoter_campaigns(id) ON DELETE SET NULL,
  promoter_id uuid NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  location_id uuid REFERENCES public.locations(id) ON DELETE SET NULL,
  full_name text NOT NULL,
  mobile text NOT NULL,
  email text,
  city text,
  current_operator text,
  sim_count integer CHECK (sim_count IS NULL OR sim_count >= 0),
  monthly_mobile_spend numeric CHECK (monthly_mobile_spend IS NULL OR monthly_mobile_spend >= 0),
  home_internet_provider text,
  monthly_home_spend numeric CHECK (monthly_home_spend IS NULL OR monthly_home_spend >= 0),
  recommended_offer_id uuid REFERENCES public.telecom_offers(id) ON DELETE SET NULL,
  pushed_offer_id uuid REFERENCES public.telecom_offers(id) ON DELETE SET NULL,
  estimated_savings numeric CHECK (estimated_savings IS NULL OR estimated_savings >= 0),
  recommendation_source text NOT NULL DEFAULT 'auto' CHECK (recommendation_source IN ('auto', 'manual')),
  recommendation_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(recommendation_snapshot) = 'object'),
  status text NOT NULL DEFAULT 'captured'
    CHECK (status IN ('captured', 'recommended', 'sent_to_agent', 'converted', 'not_interested', 'invalid')),
  assigned_agent_id uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  agent_reviewed_at timestamptz,
  conversion_sale_log_id uuid REFERENCES public.sales_logs(id) ON DELETE SET NULL,
  consent_given boolean NOT NULL DEFAULT false,
  marketing_consent boolean NOT NULL DEFAULT false,
  consent_version text,
  consent_at timestamptz,
  language text NOT NULL DEFAULT 'ar',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.promoter_lead_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.promoter_leads(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  actor_id uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(meta) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.promoter_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.sales_companies(id) ON DELETE SET NULL,
  weights jsonb NOT NULL DEFAULT '{"savings":0.6,"data":0.2,"bundle":0.1,"priority":0.1}'::jsonb
    CHECK (jsonb_typeof(weights) = 'object'),
  consent_version text NOT NULL DEFAULT 'v1',
  consent_text_ar text,
  consent_text_en text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, company_id)
);

CREATE INDEX IF NOT EXISTS idx_promoter_reference_values_org_kind
  ON public.promoter_reference_values(organization_id, kind, is_active, sort_order);
CREATE INDEX IF NOT EXISTS idx_telecom_offers_org_active
  ON public.telecom_offers(organization_id, is_active, offer_target, priority DESC);
CREATE INDEX IF NOT EXISTS idx_telecom_offers_company_active
  ON public.telecom_offers(organization_id, company_id, is_active);
CREATE INDEX IF NOT EXISTS idx_promoter_campaigns_org_active
  ON public.promoter_campaigns(organization_id, is_active, start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_promoter_leads_org_status_created
  ON public.promoter_leads(organization_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_promoter_leads_promoter_created
  ON public.promoter_leads(organization_id, promoter_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_promoter_leads_agent_status
  ON public.promoter_leads(organization_id, assigned_agent_id, status);
CREATE INDEX IF NOT EXISTS idx_promoter_leads_city_operator
  ON public.promoter_leads(organization_id, city, current_operator);
CREATE INDEX IF NOT EXISTS idx_promoter_lead_events_lead_created
  ON public.promoter_lead_events(organization_id, lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_promoter_settings_org_company
  ON public.promoter_settings(organization_id, company_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_promoter_settings_org_default
  ON public.promoter_settings(organization_id)
  WHERE company_id IS NULL;

ALTER TABLE public.promoter_reference_values ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telecom_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promoter_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promoter_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promoter_lead_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promoter_settings ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.can_manage_promoter()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.role() = 'service_role'
    OR COALESCE(
    (
      SELECT role::text IN ('admin', 'hr_admin', 'sales_manager')
      FROM public.org_members
      WHERE user_id = auth.uid()
        AND org_id = public.current_org_id()
      LIMIT 1
    ),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.can_capture_promoter_lead()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.role() = 'service_role'
    OR COALESCE(
    (
      SELECT role::text IN ('promoter', 'admin', 'hr_admin', 'sales_manager')
      FROM public.org_members
      WHERE user_id = auth.uid()
        AND org_id = public.current_org_id()
      LIMIT 1
    ),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.can_access_promoter_lead(
  p_organization_id uuid,
  p_promoter_id uuid,
  p_assigned_agent_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.role() = 'service_role'
    OR (
      p_organization_id = public.current_org_id()
      AND (
        public.current_role() IN ('admin', 'hr_admin', 'sales_manager')
        OR p_promoter_id = auth.uid()
        OR p_assigned_agent_id = auth.uid()
      )
    );
$$;

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'promoter_reference_values',
    'telecom_offers',
    'promoter_campaigns',
    'promoter_leads',
    'promoter_settings'
  ]
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%I_updated_at ON public.%I', tbl, tbl);
    EXECUTE format(
      'CREATE TRIGGER trg_%I_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at()',
      tbl,
      tbl
    );
  END LOOP;
END $$;

DROP POLICY IF EXISTS promoter_reference_values_select ON public.promoter_reference_values;
CREATE POLICY promoter_reference_values_select ON public.promoter_reference_values
  FOR SELECT USING (
    auth.role() = 'service_role'
    OR organization_id = public.current_org_id()
  );

DROP POLICY IF EXISTS promoter_reference_values_write ON public.promoter_reference_values;
CREATE POLICY promoter_reference_values_write ON public.promoter_reference_values
  FOR ALL USING (
    auth.role() = 'service_role'
    OR (organization_id = public.current_org_id() AND public.can_manage_promoter())
  )
  WITH CHECK (
    auth.role() = 'service_role'
    OR (organization_id = public.current_org_id() AND public.can_manage_promoter())
  );

DROP POLICY IF EXISTS telecom_offers_select ON public.telecom_offers;
CREATE POLICY telecom_offers_select ON public.telecom_offers
  FOR SELECT USING (
    auth.role() = 'service_role'
    OR organization_id = public.current_org_id()
  );

DROP POLICY IF EXISTS telecom_offers_write ON public.telecom_offers;
CREATE POLICY telecom_offers_write ON public.telecom_offers
  FOR ALL USING (
    auth.role() = 'service_role'
    OR (organization_id = public.current_org_id() AND public.can_manage_promoter())
  )
  WITH CHECK (
    auth.role() = 'service_role'
    OR (organization_id = public.current_org_id() AND public.can_manage_promoter())
  );

DROP POLICY IF EXISTS promoter_campaigns_select ON public.promoter_campaigns;
CREATE POLICY promoter_campaigns_select ON public.promoter_campaigns
  FOR SELECT USING (
    auth.role() = 'service_role'
    OR organization_id = public.current_org_id()
  );

DROP POLICY IF EXISTS promoter_campaigns_write ON public.promoter_campaigns;
CREATE POLICY promoter_campaigns_write ON public.promoter_campaigns
  FOR ALL USING (
    auth.role() = 'service_role'
    OR (organization_id = public.current_org_id() AND public.can_manage_promoter())
  )
  WITH CHECK (
    auth.role() = 'service_role'
    OR (organization_id = public.current_org_id() AND public.can_manage_promoter())
  );

DROP POLICY IF EXISTS promoter_settings_select ON public.promoter_settings;
CREATE POLICY promoter_settings_select ON public.promoter_settings
  FOR SELECT USING (
    auth.role() = 'service_role'
    OR organization_id = public.current_org_id()
  );

DROP POLICY IF EXISTS promoter_settings_write ON public.promoter_settings;
CREATE POLICY promoter_settings_write ON public.promoter_settings
  FOR ALL USING (
    auth.role() = 'service_role'
    OR (organization_id = public.current_org_id() AND public.can_manage_promoter())
  )
  WITH CHECK (
    auth.role() = 'service_role'
    OR (organization_id = public.current_org_id() AND public.can_manage_promoter())
  );

DROP POLICY IF EXISTS promoter_leads_select ON public.promoter_leads;
CREATE POLICY promoter_leads_select ON public.promoter_leads
  FOR SELECT USING (
    public.can_access_promoter_lead(organization_id, promoter_id, assigned_agent_id)
  );

DROP POLICY IF EXISTS promoter_leads_insert ON public.promoter_leads;
CREATE POLICY promoter_leads_insert ON public.promoter_leads
  FOR INSERT WITH CHECK (
    auth.role() = 'service_role'
    OR (
      organization_id = public.current_org_id()
      AND public.can_capture_promoter_lead()
      AND (public.can_manage_promoter() OR promoter_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS promoter_leads_update ON public.promoter_leads;
CREATE POLICY promoter_leads_update ON public.promoter_leads
  FOR UPDATE USING (
    public.can_access_promoter_lead(organization_id, promoter_id, assigned_agent_id)
  )
  WITH CHECK (
    auth.role() = 'service_role'
    OR (
      organization_id = public.current_org_id()
      AND (
        public.can_manage_promoter()
        OR promoter_id = auth.uid()
        OR assigned_agent_id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS promoter_lead_events_select ON public.promoter_lead_events;
CREATE POLICY promoter_lead_events_select ON public.promoter_lead_events
  FOR SELECT USING (
    auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1
      FROM public.promoter_leads lead
      WHERE lead.id = promoter_lead_events.lead_id
        AND public.can_access_promoter_lead(lead.organization_id, lead.promoter_id, lead.assigned_agent_id)
    )
  );

DROP POLICY IF EXISTS promoter_lead_events_insert ON public.promoter_lead_events;
CREATE POLICY promoter_lead_events_insert ON public.promoter_lead_events
  FOR INSERT WITH CHECK (
    auth.role() = 'service_role'
    OR (
      organization_id = public.current_org_id()
      AND (actor_id IS NULL OR actor_id = auth.uid() OR public.can_manage_promoter())
      AND EXISTS (
        SELECT 1
        FROM public.promoter_leads lead
        WHERE lead.id = promoter_lead_events.lead_id
          AND public.can_access_promoter_lead(lead.organization_id, lead.promoter_id, lead.assigned_agent_id)
      )
    )
  );
