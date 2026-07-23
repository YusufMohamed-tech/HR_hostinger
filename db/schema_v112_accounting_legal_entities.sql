-- Phase 1: Multi-entity accounting foundation.
-- Legal entities, branches, books, user scopes, fiscal calendars, currencies, and exchange rates.
-- Extends existing accounting tables with legal_entity_id for independent books per company.

------------------------------------------------------------
-- 1. Currencies and exchange rates
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.accounting_currencies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  code text NOT NULL,
  name_ar text NOT NULL,
  name_en text,
  symbol text,
  minor_units integer NOT NULL DEFAULT 2 CHECK (minor_units BETWEEN 0 AND 6),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code)
);

ALTER TABLE public.accounting_currencies ENABLE ROW LEVEL SECURITY;

CREATE POLICY accounting_currencies_select ON public.accounting_currencies
  FOR SELECT USING (
    organization_id IN (
      SELECT org_id FROM public.org_members WHERE user_id = auth.uid()
    )
  );

CREATE TABLE IF NOT EXISTS public.accounting_exchange_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  from_currency_code text NOT NULL,
  to_currency_code text NOT NULL,
  rate_date date NOT NULL,
  rate_type text NOT NULL CHECK (rate_type IN ('spot', 'average', 'closing', 'historical')),
  rate numeric(20,6) NOT NULL CHECK (rate > 0),
  source text,
  is_approved boolean NOT NULL DEFAULT false,
  approved_by uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  approved_at timestamptz,
  created_by uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, from_currency_code, to_currency_code, rate_date, rate_type)
);

ALTER TABLE public.accounting_exchange_rates ENABLE ROW LEVEL SECURITY;

CREATE POLICY accounting_exchange_rates_select ON public.accounting_exchange_rates
  FOR SELECT USING (
    organization_id IN (
      SELECT org_id FROM public.org_members WHERE user_id = auth.uid()
    )
  );

------------------------------------------------------------
-- 2. Fiscal calendars
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.accounting_fiscal_calendars (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  code text NOT NULL,
  name_ar text NOT NULL,
  name_en text,
  start_month integer NOT NULL CHECK (start_month BETWEEN 1 AND 12),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code)
);

ALTER TABLE public.accounting_fiscal_calendars ENABLE ROW LEVEL SECURITY;

CREATE POLICY accounting_fiscal_calendars_select ON public.accounting_fiscal_calendars
  FOR SELECT USING (
    organization_id IN (
      SELECT org_id FROM public.org_members WHERE user_id = auth.uid()
    )
  );

------------------------------------------------------------
-- 3. Legal entities
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.accounting_legal_entities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  code text NOT NULL,
  name_ar text NOT NULL,
  name_en text,
  trade_name_ar text,
  trade_name_en text,
  commercial_registration text,
  vat_number text,
  tax_identification_number text,
  country text NOT NULL DEFAULT 'SA',
  address text,
  city text,
  functional_currency_code text NOT NULL DEFAULT 'SAR',
  fiscal_calendar_id uuid REFERENCES public.accounting_fiscal_calendars(id) ON DELETE SET NULL,
  default_language text NOT NULL DEFAULT 'ar' CHECK (default_language IN ('ar', 'en')),
  timezone text NOT NULL DEFAULT 'Asia/Riyadh',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'suspended', 'closed')),
  consolidation_parent_id uuid REFERENCES public.accounting_legal_entities(id) ON DELETE SET NULL,
  is_default boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_by uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code)
);

ALTER TABLE public.accounting_legal_entities ENABLE ROW LEVEL SECURITY;

CREATE POLICY accounting_legal_entities_select ON public.accounting_legal_entities
  FOR SELECT USING (
    organization_id IN (
      SELECT org_id FROM public.org_members WHERE user_id = auth.uid()
    )
  );

CREATE INDEX idx_accounting_legal_entities_org_status
  ON public.accounting_legal_entities (organization_id, status);

------------------------------------------------------------
-- 4. Branches
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.accounting_branches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  legal_entity_id uuid NOT NULL REFERENCES public.accounting_legal_entities(id) ON DELETE CASCADE,
  code text NOT NULL,
  name_ar text NOT NULL,
  name_en text,
  parent_branch_id uuid REFERENCES public.accounting_branches(id) ON DELETE SET NULL,
  location_id uuid,
  tax_registration_override text,
  default_cost_center_id uuid REFERENCES public.accounting_cost_centers(id) ON DELETE SET NULL,
  is_active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_by uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, legal_entity_id, code)
);

ALTER TABLE public.accounting_branches ENABLE ROW LEVEL SECURITY;

CREATE POLICY accounting_branches_select ON public.accounting_branches
  FOR SELECT USING (
    organization_id IN (
      SELECT org_id FROM public.org_members WHERE user_id = auth.uid()
    )
  );

CREATE INDEX idx_accounting_branches_entity
  ON public.accounting_branches (organization_id, legal_entity_id, is_active);

------------------------------------------------------------
-- 5. Books
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.accounting_books (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  legal_entity_id uuid NOT NULL REFERENCES public.accounting_legal_entities(id) ON DELETE CASCADE,
  code text NOT NULL,
  name_ar text NOT NULL,
  name_en text,
  book_type text NOT NULL DEFAULT 'statutory' CHECK (book_type IN ('statutory', 'management', 'tax', 'consolidation_adjustment')),
  functional_currency_code text NOT NULL DEFAULT 'SAR',
  fiscal_calendar_id uuid REFERENCES public.accounting_fiscal_calendars(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'closed')),
  is_default boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, legal_entity_id, code)
);

ALTER TABLE public.accounting_books ENABLE ROW LEVEL SECURITY;

CREATE POLICY accounting_books_select ON public.accounting_books
  FOR SELECT USING (
    organization_id IN (
      SELECT org_id FROM public.org_members WHERE user_id = auth.uid()
    )
  );

------------------------------------------------------------
-- 6. User scopes
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.accounting_user_scopes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  legal_entity_id uuid NOT NULL REFERENCES public.accounting_legal_entities(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES public.accounting_branches(id) ON DELETE CASCADE,
  capability_group text NOT NULL DEFAULT 'full' CHECK (capability_group IN ('full', 'branch_only', 'view_only')),
  is_active boolean NOT NULL DEFAULT true,
  effective_from date,
  effective_to date,
  granted_by uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id, legal_entity_id, COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid))
);

ALTER TABLE public.accounting_user_scopes ENABLE ROW LEVEL SECURITY;

CREATE POLICY accounting_user_scopes_select ON public.accounting_user_scopes
  FOR SELECT USING (
    organization_id IN (
      SELECT org_id FROM public.org_members WHERE user_id = auth.uid()
    )
  );

CREATE INDEX idx_accounting_user_scopes_user
  ON public.accounting_user_scopes (organization_id, user_id, is_active);

------------------------------------------------------------
-- 7. Extend existing accounting tables with legal_entity_id
------------------------------------------------------------

ALTER TABLE public.accounting_accounts
  ADD COLUMN IF NOT EXISTS legal_entity_id uuid REFERENCES public.accounting_legal_entities(id) ON DELETE SET NULL;

ALTER TABLE public.accounting_journal_entries
  ADD COLUMN IF NOT EXISTS legal_entity_id uuid REFERENCES public.accounting_legal_entities(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.accounting_branches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS book_id uuid REFERENCES public.accounting_books(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS functional_currency_code text,
  ADD COLUMN IF NOT EXISTS transaction_currency_code text,
  ADD COLUMN IF NOT EXISTS exchange_rate numeric(20,6);

ALTER TABLE public.accounting_journal_lines
  ADD COLUMN IF NOT EXISTS functional_debit numeric(20,2),
  ADD COLUMN IF NOT EXISTS functional_credit numeric(20,2),
  ADD COLUMN IF NOT EXISTS transaction_currency_code text,
  ADD COLUMN IF NOT EXISTS exchange_rate numeric(20,6);

ALTER TABLE public.accounting_invoices
  ADD COLUMN IF NOT EXISTS legal_entity_id uuid REFERENCES public.accounting_legal_entities(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.accounting_branches(id) ON DELETE SET NULL;

ALTER TABLE public.accounting_expenses
  ADD COLUMN IF NOT EXISTS legal_entity_id uuid REFERENCES public.accounting_legal_entities(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.accounting_branches(id) ON DELETE SET NULL;

ALTER TABLE public.accounting_payments
  ADD COLUMN IF NOT EXISTS legal_entity_id uuid REFERENCES public.accounting_legal_entities(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.accounting_branches(id) ON DELETE SET NULL;

ALTER TABLE public.accounting_cost_centers
  ADD COLUMN IF NOT EXISTS legal_entity_id uuid REFERENCES public.accounting_legal_entities(id) ON DELETE SET NULL;

ALTER TABLE public.accounting_vendors
  ADD COLUMN IF NOT EXISTS legal_entity_id uuid REFERENCES public.accounting_legal_entities(id) ON DELETE SET NULL;

ALTER TABLE public.accounting_customers
  ADD COLUMN IF NOT EXISTS legal_entity_id uuid REFERENCES public.accounting_legal_entities(id) ON DELETE SET NULL;

ALTER TABLE public.accounting_periods
  ADD COLUMN IF NOT EXISTS legal_entity_id uuid REFERENCES public.accounting_legal_entities(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS book_id uuid REFERENCES public.accounting_books(id) ON DELETE SET NULL;

ALTER TABLE public.accounting_settings
  ADD COLUMN IF NOT EXISTS legal_entity_id uuid REFERENCES public.accounting_legal_entities(id) ON DELETE SET NULL;

ALTER TABLE public.accounting_budgets
  ADD COLUMN IF NOT EXISTS legal_entity_id uuid REFERENCES public.accounting_legal_entities(id) ON DELETE SET NULL;

------------------------------------------------------------
-- 8. Entity context indexes
------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_accounting_accounts_entity
  ON public.accounting_accounts (organization_id, legal_entity_id, is_active);

CREATE INDEX IF NOT EXISTS idx_accounting_journal_entries_entity
  ON public.accounting_journal_entries (organization_id, legal_entity_id, status);

CREATE INDEX IF NOT EXISTS idx_accounting_invoices_entity
  ON public.accounting_invoices (organization_id, legal_entity_id);

CREATE INDEX IF NOT EXISTS idx_accounting_expenses_entity
  ON public.accounting_expenses (organization_id, legal_entity_id);

CREATE INDEX IF NOT EXISTS idx_accounting_payments_entity
  ON public.accounting_payments (organization_id, legal_entity_id);

CREATE INDEX IF NOT EXISTS idx_accounting_periods_entity
  ON public.accounting_periods (organization_id, legal_entity_id);

------------------------------------------------------------
-- 9. Expand accounting_commands for entity operations
------------------------------------------------------------

ALTER TABLE public.accounting_commands DROP CONSTRAINT IF EXISTS accounting_commands_action_check;
ALTER TABLE public.accounting_commands ADD CONSTRAINT accounting_commands_action_check CHECK (action IN (
  'journal_create', 'journal_update', 'journal_post', 'journal_reverse', 'journal_cancel',
  'invoice_create', 'invoice_update', 'invoice_issue',
  'expense_create', 'expense_update', 'expense_approve', 'expense_reject',
  'payment_create', 'payment_update', 'payment_post',
  'period_close', 'period_reopen', 'budget_create', 'budget_update', 'budget_approve',
  'master_save', 'master_deactivate',
  'entity_save', 'entity_status_change',
  'branch_save', 'branch_deactivate',
  'book_save', 'scope_save', 'scope_revoke',
  'currency_save', 'rate_save', 'rate_approve',
  'calendar_save'
));

------------------------------------------------------------
-- 10. Legal entity management command function
------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.execute_accounting_entity_command(
  p_org_id uuid,
  p_actor_user_id uuid,
  p_request_id uuid,
  p_command_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_expected_version integer,
  p_operation text,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  command_row public.accounting_commands%ROWTYPE;
  le_row public.accounting_legal_entities%ROWTYPE;
  branch_row public.accounting_branches%ROWTYPE;
  book_row public.accounting_books%ROWTYPE;
  scope_row public.accounting_user_scopes%ROWTYPE;
  currency_row public.accounting_currencies%ROWTYPE;
  rate_row public.accounting_exchange_rates%ROWTYPE;
  calendar_row public.accounting_fiscal_calendars%ROWTYPE;
  actor_role_value text;
  action_value text;
  clean_payload jsonb;
  hash_value text;
  result_value jsonb;
  event_payload jsonb;
  event_id uuid;
  target_id_value uuid;
  version_value integer;
  change_value text;
  operation_value text := 'update';
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501';
  END IF;
  IF p_org_id IS NULL OR p_actor_user_id IS NULL OR p_request_id IS NULL OR p_command_id IS NULL THEN
    RAISE EXCEPTION 'Organization, actor, request, and command ids are required.' USING ERRCODE = '22023';
  END IF;

  SELECT member.role::text INTO actor_role_value
  FROM public.org_members member
  JOIN public.organizations organization ON organization.id = member.org_id
  JOIN public.profiles profile ON profile.user_id = member.user_id
    AND profile.org_id = member.org_id
  WHERE member.org_id = p_org_id
    AND member.user_id = p_actor_user_id
    AND member.role::text = 'finance_manager'
    AND lower(COALESCE(organization.status, '')) = 'active'
    AND lower(COALESCE(profile.account_status, 'active')) = 'active'
  LIMIT 1;
  IF actor_role_value IS NULL THEN
    RAISE EXCEPTION 'Finance manager role is required for entity management.' USING ERRCODE = '42501';
  END IF;

  action_value := CASE
    WHEN p_entity_type = 'legal_entity' AND p_operation = 'status_change' THEN 'entity_status_change'
    WHEN p_entity_type = 'legal_entity' THEN 'entity_save'
    WHEN p_entity_type = 'branch' AND p_operation = 'deactivate' THEN 'branch_deactivate'
    WHEN p_entity_type = 'branch' THEN 'branch_save'
    WHEN p_entity_type = 'book' THEN 'book_save'
    WHEN p_entity_type = 'scope' AND p_operation = 'revoke' THEN 'scope_revoke'
    WHEN p_entity_type = 'scope' THEN 'scope_save'
    WHEN p_entity_type = 'currency' THEN 'currency_save'
    WHEN p_entity_type = 'rate' AND p_operation = 'approve' THEN 'rate_approve'
    WHEN p_entity_type = 'rate' THEN 'rate_save'
    WHEN p_entity_type = 'calendar' THEN 'calendar_save'
    ELSE 'entity_save'
  END;

  clean_payload := COALESCE(p_payload, '{}'::jsonb) - ARRAY[
    'id', 'organization_id', 'created_by', 'updated_by', 'created_at',
    'updated_at', 'version', 'command_id', 'request_id', 'expected_version'
  ];
  hash_value := encode(digest(jsonb_build_object(
    'entity_type', p_entity_type,
    'entity_id', p_entity_id,
    'expected_version', COALESCE(p_expected_version, 0),
    'operation', p_operation,
    'payload', clean_payload
  )::text, 'sha256'), 'hex');

  INSERT INTO public.accounting_commands (
    organization_id, idempotency_key, action, entity_id, payload_hash,
    actor_user_id, request_id
  ) VALUES (
    p_org_id, p_command_id, action_value, p_entity_id, hash_value,
    p_actor_user_id, p_request_id
  )
  ON CONFLICT (organization_id, idempotency_key) DO NOTHING;
  SELECT * INTO command_row FROM public.accounting_commands
  WHERE organization_id = p_org_id AND idempotency_key = p_command_id
  FOR UPDATE;
  IF command_row.action <> action_value OR command_row.payload_hash <> hash_value
     OR command_row.actor_user_id IS DISTINCT FROM p_actor_user_id THEN
    RAISE EXCEPTION 'Idempotency key was reused for a different command.'
      USING ERRCODE = '23505';
  END IF;
  IF command_row.status = 'completed' THEN
    RETURN command_row.result;
  END IF;

  -- Legal entity operations
  IF p_entity_type = 'legal_entity' THEN
    IF p_operation = 'save' AND p_entity_id IS NULL THEN
      IF NULLIF(btrim(clean_payload->>'code'), '') IS NULL
         OR NULLIF(btrim(clean_payload->>'name_ar'), '') IS NULL THEN
        RAISE EXCEPTION 'Legal entity code and Arabic name are required.' USING ERRCODE = '23514';
      END IF;
      INSERT INTO public.accounting_legal_entities (
        organization_id, code, name_ar, name_en, trade_name_ar, trade_name_en,
        commercial_registration, vat_number, tax_identification_number,
        country, address, city, functional_currency_code, fiscal_calendar_id,
        default_language, timezone, status, is_default,
        created_by, updated_by, version
      ) VALUES (
        p_org_id, btrim(clean_payload->>'code'), btrim(clean_payload->>'name_ar'),
        NULLIF(btrim(clean_payload->>'name_en'), ''),
        NULLIF(btrim(clean_payload->>'trade_name_ar'), ''),
        NULLIF(btrim(clean_payload->>'trade_name_en'), ''),
        NULLIF(btrim(clean_payload->>'commercial_registration'), ''),
        NULLIF(btrim(clean_payload->>'vat_number'), ''),
        NULLIF(btrim(clean_payload->>'tax_identification_number'), ''),
        COALESCE(NULLIF(btrim(clean_payload->>'country'), ''), 'SA'),
        NULLIF(btrim(clean_payload->>'address'), ''),
        NULLIF(btrim(clean_payload->>'city'), ''),
        COALESCE(NULLIF(btrim(clean_payload->>'functional_currency_code'), ''), 'SAR'),
        NULLIF(clean_payload->>'fiscal_calendar_id', '')::uuid,
        COALESCE(NULLIF(btrim(clean_payload->>'default_language'), ''), 'ar'),
        COALESCE(NULLIF(btrim(clean_payload->>'timezone'), ''), 'Asia/Riyadh'),
        COALESCE(NULLIF(btrim(clean_payload->>'status'), ''), 'active'),
        COALESCE((clean_payload->>'is_default')::boolean, false),
        p_actor_user_id, p_actor_user_id, 1
      ) RETURNING * INTO le_row;
      operation_value := 'insert';
      change_value := 'created';
    ELSE
      SELECT * INTO le_row FROM public.accounting_legal_entities
      WHERE organization_id = p_org_id AND id = p_entity_id FOR UPDATE;
      IF le_row.id IS NULL THEN
        RAISE EXCEPTION 'Legal entity was not found.' USING ERRCODE = 'P0002';
      END IF;
      IF le_row.version <> COALESCE(p_expected_version, 0) THEN
        RAISE EXCEPTION 'Legal entity version conflict.' USING ERRCODE = '40001';
      END IF;
      IF p_operation = 'status_change' THEN
        le_row.status := clean_payload->>'status';
        change_value := 'status_changed';
      ELSE
        le_row := jsonb_populate_record(le_row, clean_payload);
        change_value := 'updated';
      END IF;
      le_row.id := p_entity_id;
      le_row.organization_id := p_org_id;
      le_row.updated_by := p_actor_user_id;
      le_row.version := COALESCE(p_expected_version, 0) + 1;
      le_row.updated_at := now();
      UPDATE public.accounting_legal_entities SET
        code = le_row.code, name_ar = le_row.name_ar, name_en = le_row.name_en,
        trade_name_ar = le_row.trade_name_ar, trade_name_en = le_row.trade_name_en,
        commercial_registration = le_row.commercial_registration,
        vat_number = le_row.vat_number, tax_identification_number = le_row.tax_identification_number,
        country = le_row.country, address = le_row.address, city = le_row.city,
        functional_currency_code = le_row.functional_currency_code,
        fiscal_calendar_id = le_row.fiscal_calendar_id,
        default_language = le_row.default_language, timezone = le_row.timezone,
        status = le_row.status, is_default = le_row.is_default,
        consolidation_parent_id = le_row.consolidation_parent_id,
        updated_by = le_row.updated_by, version = le_row.version, updated_at = le_row.updated_at
      WHERE id = le_row.id RETURNING * INTO le_row;
    END IF;
    target_id_value := le_row.id;
    version_value := le_row.version;
    result_value := to_jsonb(le_row);

  -- Branch operations
  ELSIF p_entity_type = 'branch' THEN
    IF p_operation = 'save' AND p_entity_id IS NULL THEN
      IF NULLIF(btrim(clean_payload->>'code'), '') IS NULL
         OR NULLIF(btrim(clean_payload->>'name_ar'), '') IS NULL
         OR NULLIF(clean_payload->>'legal_entity_id', '') IS NULL THEN
        RAISE EXCEPTION 'Branch code, Arabic name, and legal entity are required.' USING ERRCODE = '23514';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM public.accounting_legal_entities
        WHERE organization_id = p_org_id AND id = (clean_payload->>'legal_entity_id')::uuid
        AND status = 'active') THEN
        RAISE EXCEPTION 'Legal entity is not active or does not belong to this organization.' USING ERRCODE = 'P0002';
      END IF;
      INSERT INTO public.accounting_branches (
        organization_id, legal_entity_id, code, name_ar, name_en,
        parent_branch_id, location_id, tax_registration_override,
        default_cost_center_id, is_active, created_by, updated_by, version
      ) VALUES (
        p_org_id, (clean_payload->>'legal_entity_id')::uuid,
        btrim(clean_payload->>'code'), btrim(clean_payload->>'name_ar'),
        NULLIF(btrim(clean_payload->>'name_en'), ''),
        NULLIF(clean_payload->>'parent_branch_id', '')::uuid,
        NULLIF(clean_payload->>'location_id', '')::uuid,
        NULLIF(btrim(clean_payload->>'tax_registration_override'), ''),
        NULLIF(clean_payload->>'default_cost_center_id', '')::uuid,
        COALESCE((clean_payload->>'is_active')::boolean, true),
        p_actor_user_id, p_actor_user_id, 1
      ) RETURNING * INTO branch_row;
      operation_value := 'insert';
      change_value := 'created';
    ELSE
      SELECT * INTO branch_row FROM public.accounting_branches
      WHERE organization_id = p_org_id AND id = p_entity_id FOR UPDATE;
      IF branch_row.id IS NULL THEN
        RAISE EXCEPTION 'Branch was not found.' USING ERRCODE = 'P0002';
      END IF;
      IF branch_row.version <> COALESCE(p_expected_version, 0) THEN
        RAISE EXCEPTION 'Branch version conflict.' USING ERRCODE = '40001';
      END IF;
      IF p_operation = 'deactivate' THEN
        branch_row.is_active := false;
        change_value := 'deactivated';
      ELSE
        branch_row := jsonb_populate_record(branch_row, clean_payload);
        change_value := 'updated';
      END IF;
      branch_row.id := p_entity_id;
      branch_row.organization_id := p_org_id;
      branch_row.updated_by := p_actor_user_id;
      branch_row.version := COALESCE(p_expected_version, 0) + 1;
      branch_row.updated_at := now();
      UPDATE public.accounting_branches SET
        code = branch_row.code, name_ar = branch_row.name_ar, name_en = branch_row.name_en,
        parent_branch_id = branch_row.parent_branch_id, location_id = branch_row.location_id,
        tax_registration_override = branch_row.tax_registration_override,
        default_cost_center_id = branch_row.default_cost_center_id,
        is_active = branch_row.is_active,
        updated_by = branch_row.updated_by, version = branch_row.version, updated_at = branch_row.updated_at
      WHERE id = branch_row.id RETURNING * INTO branch_row;
    END IF;
    target_id_value := branch_row.id;
    version_value := branch_row.version;
    result_value := to_jsonb(branch_row);

  -- Book operations
  ELSIF p_entity_type = 'book' THEN
    IF p_operation = 'save' AND p_entity_id IS NULL THEN
      IF NULLIF(btrim(clean_payload->>'code'), '') IS NULL
         OR NULLIF(btrim(clean_payload->>'name_ar'), '') IS NULL
         OR NULLIF(clean_payload->>'legal_entity_id', '') IS NULL THEN
        RAISE EXCEPTION 'Book code, Arabic name, and legal entity are required.' USING ERRCODE = '23514';
      END IF;
      INSERT INTO public.accounting_books (
        organization_id, legal_entity_id, code, name_ar, name_en,
        book_type, functional_currency_code, fiscal_calendar_id, status,
        is_default, version
      ) VALUES (
        p_org_id, (clean_payload->>'legal_entity_id')::uuid,
        btrim(clean_payload->>'code'), btrim(clean_payload->>'name_ar'),
        NULLIF(btrim(clean_payload->>'name_en'), ''),
        COALESCE(NULLIF(btrim(clean_payload->>'book_type'), ''), 'statutory'),
        COALESCE(NULLIF(btrim(clean_payload->>'functional_currency_code'), ''), 'SAR'),
        NULLIF(clean_payload->>'fiscal_calendar_id', '')::uuid,
        COALESCE(NULLIF(btrim(clean_payload->>'status'), ''), 'active'),
        COALESCE((clean_payload->>'is_default')::boolean, false), 1
      ) RETURNING * INTO book_row;
      operation_value := 'insert';
      change_value := 'created';
    ELSE
      SELECT * INTO book_row FROM public.accounting_books
      WHERE organization_id = p_org_id AND id = p_entity_id FOR UPDATE;
      IF book_row.id IS NULL THEN
        RAISE EXCEPTION 'Book was not found.' USING ERRCODE = 'P0002';
      END IF;
      IF book_row.version <> COALESCE(p_expected_version, 0) THEN
        RAISE EXCEPTION 'Book version conflict.' USING ERRCODE = '40001';
      END IF;
      book_row := jsonb_populate_record(book_row, clean_payload);
      book_row.id := p_entity_id;
      book_row.organization_id := p_org_id;
      book_row.version := COALESCE(p_expected_version, 0) + 1;
      book_row.updated_at := now();
      change_value := 'updated';
      UPDATE public.accounting_books SET
        code = book_row.code, name_ar = book_row.name_ar, name_en = book_row.name_en,
        book_type = book_row.book_type, functional_currency_code = book_row.functional_currency_code,
        fiscal_calendar_id = book_row.fiscal_calendar_id, status = book_row.status,
        is_default = book_row.is_default, version = book_row.version, updated_at = book_row.updated_at
      WHERE id = book_row.id RETURNING * INTO book_row;
    END IF;
    target_id_value := book_row.id;
    version_value := book_row.version;
    result_value := to_jsonb(book_row);

  -- Currency operations
  ELSIF p_entity_type = 'currency' THEN
    IF p_entity_id IS NULL THEN
      INSERT INTO public.accounting_currencies (
        organization_id, code, name_ar, name_en, symbol, minor_units, is_active
      ) VALUES (
        p_org_id, upper(btrim(clean_payload->>'code')), btrim(clean_payload->>'name_ar'),
        NULLIF(btrim(clean_payload->>'name_en'), ''),
        NULLIF(btrim(clean_payload->>'symbol'), ''),
        COALESCE((clean_payload->>'minor_units')::integer, 2),
        COALESCE((clean_payload->>'is_active')::boolean, true)
      ) RETURNING * INTO currency_row;
      operation_value := 'insert';
      change_value := 'created';
    ELSE
      SELECT * INTO currency_row FROM public.accounting_currencies
      WHERE organization_id = p_org_id AND id = p_entity_id FOR UPDATE;
      IF currency_row.id IS NULL THEN
        RAISE EXCEPTION 'Currency was not found.' USING ERRCODE = 'P0002';
      END IF;
      currency_row := jsonb_populate_record(currency_row, clean_payload);
      currency_row.id := p_entity_id;
      currency_row.organization_id := p_org_id;
      currency_row.updated_at := now();
      change_value := 'updated';
      UPDATE public.accounting_currencies SET
        code = currency_row.code, name_ar = currency_row.name_ar, name_en = currency_row.name_en,
        symbol = currency_row.symbol, minor_units = currency_row.minor_units,
        is_active = currency_row.is_active, updated_at = currency_row.updated_at
      WHERE id = currency_row.id RETURNING * INTO currency_row;
    END IF;
    target_id_value := currency_row.id;
    version_value := 1;
    result_value := to_jsonb(currency_row);

  -- Exchange rate operations
  ELSIF p_entity_type = 'rate' THEN
    IF p_operation = 'approve' THEN
      SELECT * INTO rate_row FROM public.accounting_exchange_rates
      WHERE organization_id = p_org_id AND id = p_entity_id FOR UPDATE;
      IF rate_row.id IS NULL THEN
        RAISE EXCEPTION 'Exchange rate was not found.' USING ERRCODE = 'P0002';
      END IF;
      UPDATE public.accounting_exchange_rates SET
        is_approved = true, approved_by = p_actor_user_id, approved_at = now(), updated_at = now()
      WHERE id = rate_row.id RETURNING * INTO rate_row;
      change_value := 'approved';
    ELSIF p_entity_id IS NULL THEN
      INSERT INTO public.accounting_exchange_rates (
        organization_id, from_currency_code, to_currency_code, rate_date,
        rate_type, rate, source, is_approved, created_by
      ) VALUES (
        p_org_id, upper(btrim(clean_payload->>'from_currency_code')),
        upper(btrim(clean_payload->>'to_currency_code')),
        (clean_payload->>'rate_date')::date,
        COALESCE(NULLIF(btrim(clean_payload->>'rate_type'), ''), 'spot'),
        (clean_payload->>'rate')::numeric,
        NULLIF(btrim(clean_payload->>'source'), ''),
        COALESCE((clean_payload->>'is_approved')::boolean, false),
        p_actor_user_id
      ) RETURNING * INTO rate_row;
      operation_value := 'insert';
      change_value := 'created';
    ELSE
      SELECT * INTO rate_row FROM public.accounting_exchange_rates
      WHERE organization_id = p_org_id AND id = p_entity_id FOR UPDATE;
      IF rate_row.id IS NULL THEN
        RAISE EXCEPTION 'Exchange rate was not found.' USING ERRCODE = 'P0002';
      END IF;
      rate_row := jsonb_populate_record(rate_row, clean_payload);
      rate_row.id := p_entity_id;
      rate_row.organization_id := p_org_id;
      rate_row.updated_at := now();
      change_value := 'updated';
      UPDATE public.accounting_exchange_rates SET
        from_currency_code = rate_row.from_currency_code,
        to_currency_code = rate_row.to_currency_code,
        rate_date = rate_row.rate_date, rate_type = rate_row.rate_type,
        rate = rate_row.rate, source = rate_row.source,
        updated_at = rate_row.updated_at
      WHERE id = rate_row.id RETURNING * INTO rate_row;
    END IF;
    target_id_value := rate_row.id;
    version_value := 1;
    result_value := to_jsonb(rate_row);

  -- Fiscal calendar operations
  ELSIF p_entity_type = 'calendar' THEN
    IF p_entity_id IS NULL THEN
      INSERT INTO public.accounting_fiscal_calendars (
        organization_id, code, name_ar, name_en, start_month, is_active
      ) VALUES (
        p_org_id, btrim(clean_payload->>'code'), btrim(clean_payload->>'name_ar'),
        NULLIF(btrim(clean_payload->>'name_en'), ''),
        COALESCE((clean_payload->>'start_month')::integer, 1),
        COALESCE((clean_payload->>'is_active')::boolean, true)
      ) RETURNING * INTO calendar_row;
      operation_value := 'insert';
      change_value := 'created';
    ELSE
      SELECT * INTO calendar_row FROM public.accounting_fiscal_calendars
      WHERE organization_id = p_org_id AND id = p_entity_id FOR UPDATE;
      IF calendar_row.id IS NULL THEN
        RAISE EXCEPTION 'Fiscal calendar was not found.' USING ERRCODE = 'P0002';
      END IF;
      calendar_row := jsonb_populate_record(calendar_row, clean_payload);
      calendar_row.id := p_entity_id;
      calendar_row.organization_id := p_org_id;
      calendar_row.updated_at := now();
      change_value := 'updated';
      UPDATE public.accounting_fiscal_calendars SET
        code = calendar_row.code, name_ar = calendar_row.name_ar,
        name_en = calendar_row.name_en, start_month = calendar_row.start_month,
        is_active = calendar_row.is_active, updated_at = calendar_row.updated_at
      WHERE id = calendar_row.id RETURNING * INTO calendar_row;
    END IF;
    target_id_value := calendar_row.id;
    version_value := 1;
    result_value := to_jsonb(calendar_row);

  -- User scope operations
  ELSIF p_entity_type = 'scope' THEN
    IF p_operation = 'revoke' THEN
      SELECT * INTO scope_row FROM public.accounting_user_scopes
      WHERE organization_id = p_org_id AND id = p_entity_id FOR UPDATE;
      IF scope_row.id IS NULL THEN
        RAISE EXCEPTION 'User scope was not found.' USING ERRCODE = 'P0002';
      END IF;
      UPDATE public.accounting_user_scopes SET is_active = false, updated_at = now()
      WHERE id = scope_row.id RETURNING * INTO scope_row;
      change_value := 'revoked';
    ELSIF p_entity_id IS NULL THEN
      INSERT INTO public.accounting_user_scopes (
        organization_id, user_id, legal_entity_id, branch_id,
        capability_group, is_active, effective_from, effective_to, granted_by
      ) VALUES (
        p_org_id, (clean_payload->>'user_id')::uuid,
        (clean_payload->>'legal_entity_id')::uuid,
        NULLIF(clean_payload->>'branch_id', '')::uuid,
        COALESCE(NULLIF(btrim(clean_payload->>'capability_group'), ''), 'full'),
        true,
        NULLIF(clean_payload->>'effective_from', '')::date,
        NULLIF(clean_payload->>'effective_to', '')::date,
        p_actor_user_id
      ) RETURNING * INTO scope_row;
      operation_value := 'insert';
      change_value := 'granted';
    ELSE
      SELECT * INTO scope_row FROM public.accounting_user_scopes
      WHERE organization_id = p_org_id AND id = p_entity_id FOR UPDATE;
      IF scope_row.id IS NULL THEN
        RAISE EXCEPTION 'User scope was not found.' USING ERRCODE = 'P0002';
      END IF;
      scope_row := jsonb_populate_record(scope_row, clean_payload);
      scope_row.id := p_entity_id;
      scope_row.organization_id := p_org_id;
      scope_row.updated_at := now();
      change_value := 'updated';
      UPDATE public.accounting_user_scopes SET
        capability_group = scope_row.capability_group, is_active = scope_row.is_active,
        effective_from = scope_row.effective_from, effective_to = scope_row.effective_to,
        updated_at = scope_row.updated_at
      WHERE id = scope_row.id RETURNING * INTO scope_row;
    END IF;
    target_id_value := scope_row.id;
    version_value := 1;
    result_value := to_jsonb(scope_row);

  ELSE
    RAISE EXCEPTION 'Unsupported entity command type: %', p_entity_type USING ERRCODE = '22023';
  END IF;

  -- Emit event and audit
  event_payload := jsonb_strip_nulls(jsonb_build_object(
    'event_type', 'accounting.entity_changed',
    'entity_type', p_entity_type,
    'record_id', target_id_value,
    'operation', operation_value,
    'change', change_value,
    'version', GREATEST(version_value, 1)
  ));
  INSERT INTO public.business_events (
    org_id, source_type, business_key, event_version, payload, payload_hash,
    status, request_id, actor_user_id, occurred_at, processed_at
  ) VALUES (
    p_org_id, 'accounting_entity', p_command_id::text, GREATEST(version_value, 1),
    event_payload, encode(digest(event_payload::text, 'sha256'), 'hex'),
    'completed', p_request_id, p_actor_user_id, now(), now()
  ) RETURNING id INTO event_id;
  INSERT INTO public.event_outbox (
    org_id, business_event_id, topic, payload, payload_hash
  ) VALUES (
    p_org_id, event_id, 'accounting.entity_changed', event_payload,
    encode(digest(event_payload::text, 'sha256'), 'hex')
  );
  INSERT INTO public.operational_audit_logs (
    org_id, request_id, actor_user_id, actor_role, action, target_type,
    target_id, outcome, status_code, metadata
  ) VALUES (
    p_org_id, p_request_id, p_actor_user_id, actor_role_value,
    'accounting.' || p_entity_type || '_' || change_value,
    'accounting_' || p_entity_type, target_id_value::text, 'success', 200,
    jsonb_build_object('version', version_value, 'command_id', p_command_id)
  );
  UPDATE public.accounting_commands SET
    entity_id = target_id_value, status = 'completed', result = result_value,
    completed_at = now()
  WHERE id = command_row.id;
  RETURN result_value;
END;
$$;

REVOKE ALL ON FUNCTION public.execute_accounting_entity_command(
  uuid, uuid, uuid, uuid, text, uuid, integer, text, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.execute_accounting_entity_command(
  uuid, uuid, uuid, uuid, text, uuid, integer, text, jsonb
) TO service_role;

------------------------------------------------------------
-- 11. Default entity backfill function
------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.accounting_backfill_default_entity(p_org_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  entity_id uuid;
  org_row public.organizations%ROWTYPE;
  book_id_value uuid;
  calendar_id_value uuid;
BEGIN
  SELECT * INTO org_row FROM public.organizations WHERE id = p_org_id;
  IF org_row.id IS NULL THEN
    RAISE EXCEPTION 'Organization not found.' USING ERRCODE = 'P0002';
  END IF;

  SELECT id INTO entity_id FROM public.accounting_legal_entities
  WHERE organization_id = p_org_id AND is_default = true LIMIT 1;
  IF entity_id IS NOT NULL THEN
    RETURN entity_id;
  END IF;

  INSERT INTO public.accounting_fiscal_calendars (organization_id, code, name_ar, name_en, start_month)
  VALUES (p_org_id, 'DEFAULT', 'التقويم الافتراضي', 'Default Calendar', 1)
  ON CONFLICT (organization_id, code) DO NOTHING;
  SELECT id INTO calendar_id_value FROM public.accounting_fiscal_calendars
  WHERE organization_id = p_org_id AND code = 'DEFAULT';

  INSERT INTO public.accounting_currencies (organization_id, code, name_ar, name_en, symbol, minor_units)
  VALUES (p_org_id, 'SAR', 'ريال سعودي', 'Saudi Riyal', '﷼', 2)
  ON CONFLICT (organization_id, code) DO NOTHING;

  INSERT INTO public.accounting_legal_entities (
    organization_id, code, name_ar, name_en,
    functional_currency_code, fiscal_calendar_id, status, is_default,
    created_by, updated_by
  ) VALUES (
    p_org_id, 'DEFAULT',
    COALESCE(org_row.name, 'الكيان الافتراضي'),
    COALESCE(org_row.name, 'Default Entity'),
    'SAR', calendar_id_value, 'active', true,
    (SELECT user_id FROM public.org_members WHERE org_id = p_org_id AND role::text = 'finance_manager' LIMIT 1),
    (SELECT user_id FROM public.org_members WHERE org_id = p_org_id AND role::text = 'finance_manager' LIMIT 1)
  ) RETURNING id INTO entity_id;

  INSERT INTO public.accounting_books (
    organization_id, legal_entity_id, code, name_ar, name_en,
    book_type, functional_currency_code, fiscal_calendar_id, status, is_default
  ) VALUES (
    p_org_id, entity_id, 'STAT', 'الدفتر النظامي', 'Statutory Book',
    'statutory', 'SAR', calendar_id_value, 'active', true
  ) RETURNING id INTO book_id_value;

  -- Backfill existing records to point to the default entity
  UPDATE public.accounting_accounts SET legal_entity_id = entity_id
  WHERE organization_id = p_org_id AND legal_entity_id IS NULL;

  UPDATE public.accounting_journal_entries SET legal_entity_id = entity_id, book_id = book_id_value
  WHERE organization_id = p_org_id AND legal_entity_id IS NULL;

  UPDATE public.accounting_invoices SET legal_entity_id = entity_id
  WHERE organization_id = p_org_id AND legal_entity_id IS NULL;

  UPDATE public.accounting_expenses SET legal_entity_id = entity_id
  WHERE organization_id = p_org_id AND legal_entity_id IS NULL;

  UPDATE public.accounting_payments SET legal_entity_id = entity_id
  WHERE organization_id = p_org_id AND legal_entity_id IS NULL;

  UPDATE public.accounting_cost_centers SET legal_entity_id = entity_id
  WHERE organization_id = p_org_id AND legal_entity_id IS NULL;

  UPDATE public.accounting_vendors SET legal_entity_id = entity_id
  WHERE organization_id = p_org_id AND legal_entity_id IS NULL;

  UPDATE public.accounting_customers SET legal_entity_id = entity_id
  WHERE organization_id = p_org_id AND legal_entity_id IS NULL;

  UPDATE public.accounting_periods SET legal_entity_id = entity_id, book_id = book_id_value
  WHERE organization_id = p_org_id AND legal_entity_id IS NULL;

  UPDATE public.accounting_settings SET legal_entity_id = entity_id
  WHERE organization_id = p_org_id AND legal_entity_id IS NULL;

  UPDATE public.accounting_budgets SET legal_entity_id = entity_id
  WHERE organization_id = p_org_id AND legal_entity_id IS NULL;

  -- Grant all finance users access to the default entity
  INSERT INTO public.accounting_user_scopes (organization_id, user_id, legal_entity_id, capability_group, granted_by)
  SELECT p_org_id, m.user_id, entity_id, 'full', m.user_id
  FROM public.org_members m
  WHERE m.org_id = p_org_id AND m.role::text IN ('finance_manager', 'accountant', 'finance_viewer')
  ON CONFLICT DO NOTHING;

  RETURN entity_id;
END;
$$;

REVOKE ALL ON FUNCTION public.accounting_backfill_default_entity(uuid)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accounting_backfill_default_entity(uuid)
TO service_role;

COMMENT ON FUNCTION public.accounting_backfill_default_entity(uuid) IS
  'Creates a default legal entity for an organization and backfills all existing accounting records to it.';

COMMENT ON FUNCTION public.execute_accounting_entity_command(uuid, uuid, uuid, uuid, text, uuid, integer, text, jsonb) IS
  'Atomically manages accounting legal entities, branches, books, user scopes, currencies, exchange rates, and fiscal calendars.';
