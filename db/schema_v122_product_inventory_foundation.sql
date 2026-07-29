-- Phase 1: generalized serialized product inventory foundation.
-- Adds a receiver role, inventory-aware sales products, draft/confirmed receipts,
-- warehouses, serialized units, append-only movements, and tenant-scoped RLS.

ALTER TYPE public.org_role ADD VALUE IF NOT EXISTS 'inventory_receiver';

-- ---------------------------------------------------------------------------
-- Product catalog extensions
-- ---------------------------------------------------------------------------
ALTER TABLE public.sales_products
  ADD COLUMN IF NOT EXISTS sku text,
  ADD COLUMN IF NOT EXISTS barcode text,
  ADD COLUMN IF NOT EXISTS model text,
  ADD COLUMN IF NOT EXISTS tracking_mode text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS inventory_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS default_cost numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS inventory_account_id uuid REFERENCES public.accounting_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cogs_account_id uuid REFERENCES public.accounting_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS tax_rate_id uuid REFERENCES public.accounting_tax_rates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS agent_commission_type text,
  ADD COLUMN IF NOT EXISTS agent_commission_value numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS inventory_version integer NOT NULL DEFAULT 1;

ALTER TABLE public.sales_products
  DROP CONSTRAINT IF EXISTS sales_products_tracking_mode_check;
ALTER TABLE public.sales_products
  ADD CONSTRAINT sales_products_tracking_mode_check
  CHECK (tracking_mode IN ('none', 'serialized'));

ALTER TABLE public.sales_products
  DROP CONSTRAINT IF EXISTS sales_products_default_cost_check;
ALTER TABLE public.sales_products
  ADD CONSTRAINT sales_products_default_cost_check CHECK (default_cost >= 0);

ALTER TABLE public.sales_products
  DROP CONSTRAINT IF EXISTS sales_products_agent_commission_check;
ALTER TABLE public.sales_products
  ADD CONSTRAINT sales_products_agent_commission_check CHECK (
    (agent_commission_type IS NULL AND agent_commission_value = 0)
    OR (
      agent_commission_type IN ('flat', 'percentage')
      AND agent_commission_value >= 0
      AND (agent_commission_type <> 'percentage' OR agent_commission_value <= 100)
    )
  );

ALTER TABLE public.sales_products
  DROP CONSTRAINT IF EXISTS sales_products_inventory_version_check;
ALTER TABLE public.sales_products
  ADD CONSTRAINT sales_products_inventory_version_check CHECK (inventory_version >= 1);

CREATE UNIQUE INDEX IF NOT EXISTS sales_products_org_company_sku_unique_idx
  ON public.sales_products (
    organization_id,
    COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::uuid),
    upper(btrim(sku))
  )
  WHERE sku IS NOT NULL AND btrim(sku) <> '';

CREATE UNIQUE INDEX IF NOT EXISTS sales_products_org_barcode_unique_idx
  ON public.sales_products (organization_id, btrim(barcode))
  WHERE barcode IS NOT NULL AND btrim(barcode) <> '';

CREATE INDEX IF NOT EXISTS sales_products_inventory_enabled_idx
  ON public.sales_products (organization_id, inventory_enabled, company_id, name);

-- ---------------------------------------------------------------------------
-- Capability helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_receive_product_inventory()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.role() = 'service_role'
    OR COALESCE(
      (
        SELECT member.role::text IN (
          'admin', 'sales_manager', 'onground_agent_manager', 'inventory_receiver'
        )
        FROM public.org_members member
        WHERE member.user_id = auth.uid()
          AND member.org_id = public.current_org_id()
        LIMIT 1
      ),
      false
    );
$$;

CREATE OR REPLACE FUNCTION public.can_manage_product_inventory()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.role() = 'service_role'
    OR COALESCE(
      (
        SELECT member.role::text IN (
          'admin', 'sales_manager', 'onground_agent_manager'
        )
        FROM public.org_members member
        WHERE member.user_id = auth.uid()
          AND member.org_id = public.current_org_id()
        LIMIT 1
      ),
      false
    );
$$;

CREATE OR REPLACE FUNCTION public.can_view_product_inventory()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.role() = 'service_role'
    OR COALESCE(
      (
        SELECT member.role::text IN (
          'admin', 'sales_manager', 'onground_agent_manager', 'inventory_receiver',
          'finance_manager', 'accountant', 'finance_viewer'
        )
        FROM public.org_members member
        WHERE member.user_id = auth.uid()
          AND member.org_id = public.current_org_id()
        LIMIT 1
      ),
      false
    );
$$;

CREATE OR REPLACE FUNCTION public.normalize_product_serial(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT upper(regexp_replace(btrim(COALESCE(p_value, '')), '[[:space:]]+', '', 'g'));
$$;

-- ---------------------------------------------------------------------------
-- Warehouses and matching aliases
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.inventory_warehouses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  legal_entity_id uuid REFERENCES public.accounting_legal_entities(id) ON DELETE SET NULL,
  branch_id uuid REFERENCES public.accounting_branches(id) ON DELETE SET NULL,
  location_id uuid REFERENCES public.locations(id) ON DELETE SET NULL,
  code text NOT NULL,
  name_ar text NOT NULL,
  name_en text,
  is_default boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code)
);

CREATE UNIQUE INDEX IF NOT EXISTS inventory_warehouses_one_default_idx
  ON public.inventory_warehouses (organization_id)
  WHERE is_default = true AND is_active = true;

CREATE TABLE IF NOT EXISTS public.product_inventory_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.sales_products(id) ON DELETE CASCADE,
  alias_type text NOT NULL CHECK (alias_type IN ('name', 'sku', 'barcode', 'model')),
  alias_value text NOT NULL,
  normalized_value text NOT NULL,
  source text NOT NULL DEFAULT 'manual',
  is_approved boolean NOT NULL DEFAULT false,
  approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, alias_type, normalized_value)
);

-- ---------------------------------------------------------------------------
-- Receipt staging and confirmed groups
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.product_inventory_number_sequences (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  sequence_year integer NOT NULL,
  last_number integer NOT NULL DEFAULT 0 CHECK (last_number >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, sequence_year)
);

CREATE TABLE IF NOT EXISTS public.product_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  receipt_no text NOT NULL,
  supplier_company_id uuid NOT NULL REFERENCES public.sales_companies(id) ON DELETE RESTRICT,
  accounting_vendor_id uuid REFERENCES public.accounting_vendors(id) ON DELETE SET NULL,
  legal_entity_id uuid REFERENCES public.accounting_legal_entities(id) ON DELETE SET NULL,
  branch_id uuid REFERENCES public.accounting_branches(id) ON DELETE SET NULL,
  warehouse_id uuid NOT NULL REFERENCES public.inventory_warehouses(id) ON DELETE RESTRICT,
  ownership_type text NOT NULL DEFAULT 'purchased'
    CHECK (ownership_type IN ('purchased', 'consignment')),
  receipt_date date NOT NULL DEFAULT CURRENT_DATE,
  delivery_note_no text,
  supplier_invoice_no text,
  invoice_received boolean NOT NULL DEFAULT false,
  currency text NOT NULL DEFAULT 'SAR' CHECK (currency ~ '^[A-Z]{3}$'),
  notes text,
  source_methods text[] NOT NULL DEFAULT ARRAY['manual']::text[],
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'needs_review', 'ready_to_confirm', 'confirmed', 'cancelled', 'failed')),
  total_units integer NOT NULL DEFAULT 0 CHECK (total_units >= 0),
  physical_total_cost numeric(14,2) NOT NULL DEFAULT 0 CHECK (physical_total_cost >= 0),
  expected_sales_value numeric(14,2) NOT NULL DEFAULT 0 CHECK (expected_sales_value >= 0),
  expected_margin numeric(14,2) NOT NULL DEFAULT 0,
  accounting_status text NOT NULL DEFAULT 'pending'
    CHECK (accounting_status IN ('pending', 'not_required', 'posted', 'failed', 'reversed')),
  accounting_journal_entry_id uuid REFERENCES public.accounting_journal_entries(id) ON DELETE SET NULL,
  accounting_reversal_entry_id uuid REFERENCES public.accounting_journal_entries(id) ON DELETE SET NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  confirmed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  confirmed_at timestamptz,
  cancelled_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  cancelled_at timestamptz,
  cancellation_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, receipt_no)
);

CREATE TABLE IF NOT EXISTS public.product_receipt_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  receipt_id uuid NOT NULL REFERENCES public.product_receipts(id) ON DELETE CASCADE,
  source_type text NOT NULL CHECK (source_type IN ('manual', 'photo', 'excel', 'csv')),
  storage_path text,
  original_name text,
  mime_type text,
  size_bytes bigint CHECK (size_bytes IS NULL OR size_bytes >= 0),
  extraction_provider text,
  extraction_version text,
  extraction_status text NOT NULL DEFAULT 'not_required'
    CHECK (extraction_status IN ('not_required', 'pending', 'completed', 'failed')),
  raw_extraction jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(raw_extraction) = 'object'),
  confidence numeric(5,4) CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  error_message text,
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.product_receipt_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  receipt_id uuid NOT NULL REFERENCES public.product_receipts(id) ON DELETE CASCADE,
  line_no integer NOT NULL CHECK (line_no > 0),
  product_id uuid NOT NULL REFERENCES public.sales_products(id) ON DELETE RESTRICT,
  product_name_snapshot text NOT NULL,
  sku_snapshot text,
  model_snapshot text,
  ownership_type text NOT NULL CHECK (ownership_type IN ('purchased', 'consignment')),
  condition text NOT NULL DEFAULT 'new' CHECK (condition IN ('new', 'open_box', 'refurbished')),
  expected_quantity integer NOT NULL CHECK (expected_quantity > 0),
  quantity integer NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  unit_cost numeric(14,2) NOT NULL CHECK (unit_cost > 0),
  planned_unit_sale_price numeric(14,2) NOT NULL CHECK (planned_unit_sale_price > 0),
  currency text NOT NULL DEFAULT 'SAR' CHECK (currency ~ '^[A-Z]{3}$'),
  tax_included boolean NOT NULL DEFAULT true,
  tax_rate_id uuid REFERENCES public.accounting_tax_rates(id) ON DELETE SET NULL,
  total_cost numeric(14,2) NOT NULL CHECK (total_cost >= 0),
  expected_sales_value numeric(14,2) NOT NULL CHECK (expected_sales_value >= 0),
  expected_margin numeric(14,2) NOT NULL,
  inventory_account_id uuid REFERENCES public.accounting_accounts(id) ON DELETE SET NULL,
  cogs_account_id uuid REFERENCES public.accounting_accounts(id) ON DELETE SET NULL,
  revenue_account_id uuid REFERENCES public.accounting_accounts(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (receipt_id, line_no)
);

CREATE TABLE IF NOT EXISTS public.product_receipt_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  receipt_id uuid NOT NULL REFERENCES public.product_receipts(id) ON DELETE CASCADE,
  receipt_line_id uuid NOT NULL REFERENCES public.product_receipt_lines(id) ON DELETE CASCADE,
  source_id uuid REFERENCES public.product_receipt_sources(id) ON DELETE SET NULL,
  source_reference text,
  raw_product_name text,
  suggested_product_id uuid REFERENCES public.sales_products(id) ON DELETE SET NULL,
  final_product_id uuid NOT NULL REFERENCES public.sales_products(id) ON DELETE RESTRICT,
  raw_serial text NOT NULL,
  normalized_serial text NOT NULL,
  barcode text,
  confidence numeric(5,4) CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  resolution_status text NOT NULL DEFAULT 'accepted'
    CHECK (resolution_status IN ('unresolved', 'accepted', 'excluded')),
  validation_errors jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(validation_errors) = 'array'),
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (receipt_id, normalized_serial)
);

-- ---------------------------------------------------------------------------
-- Confirmed serialized stock and movements
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.product_inventory_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.sales_products(id) ON DELETE RESTRICT,
  receipt_id uuid NOT NULL REFERENCES public.product_receipts(id) ON DELETE RESTRICT,
  receipt_line_id uuid NOT NULL REFERENCES public.product_receipt_lines(id) ON DELETE RESTRICT,
  warehouse_id uuid REFERENCES public.inventory_warehouses(id) ON DELETE SET NULL,
  raw_serial_number text NOT NULL,
  normalized_serial_number text NOT NULL,
  unit_barcode text,
  condition text NOT NULL DEFAULT 'new'
    CHECK (condition IN ('new', 'open_box', 'refurbished')),
  ownership_type text NOT NULL CHECK (ownership_type IN ('purchased', 'consignment')),
  status text NOT NULL DEFAULT 'in_stock'
    CHECK (status IN (
      'in_stock', 'reserved', 'in_transit', 'with_agent', 'sold',
      'returned', 'quarantine', 'damaged', 'lost'
    )),
  unit_cost_snapshot numeric(14,2) NOT NULL CHECK (unit_cost_snapshot > 0),
  planned_sale_price_snapshot numeric(14,2) NOT NULL CHECK (planned_sale_price_snapshot > 0),
  currency text NOT NULL DEFAULT 'SAR' CHECK (currency ~ '^[A-Z]{3}$'),
  current_agent_id uuid REFERENCES public.field_agents(id) ON DELETE SET NULL,
  assigned_at timestamptz,
  sold_at timestamptz,
  sold_by_agent_id uuid REFERENCES public.field_agents(id) ON DELETE SET NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS product_inventory_units_serial_unique_idx
  ON public.product_inventory_units (organization_id, normalized_serial_number);

CREATE TABLE IF NOT EXISTS public.product_inventory_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  unit_id uuid NOT NULL REFERENCES public.product_inventory_units(id) ON DELETE RESTRICT,
  movement_type text NOT NULL CHECK (movement_type IN (
    'receipt', 'reserve', 'handover_issued', 'handover_accepted',
    'agent_return', 'sale', 'sale_void', 'customer_return',
    'quarantine', 'damage', 'loss', 'adjustment'
  )),
  from_warehouse_id uuid REFERENCES public.inventory_warehouses(id) ON DELETE SET NULL,
  to_warehouse_id uuid REFERENCES public.inventory_warehouses(id) ON DELETE SET NULL,
  from_agent_id uuid REFERENCES public.field_agents(id) ON DELETE SET NULL,
  to_agent_id uuid REFERENCES public.field_agents(id) ON DELETE SET NULL,
  receipt_id uuid REFERENCES public.product_receipts(id) ON DELETE SET NULL,
  reason text,
  performed_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  movement_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.product_inventory_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  idempotency_key uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('receipt_draft_save', 'receipt_confirm', 'receipt_cancel')),
  entity_id uuid,
  payload_hash text NOT NULL CHECK (length(payload_hash) = 64),
  status text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'completed')),
  result jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(result) = 'object'),
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  request_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (organization_id, idempotency_key)
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS product_receipts_org_status_date_idx
  ON public.product_receipts (organization_id, status, receipt_date DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS product_receipt_lines_receipt_idx
  ON public.product_receipt_lines (organization_id, receipt_id, line_no);
CREATE INDEX IF NOT EXISTS product_receipt_candidates_receipt_idx
  ON public.product_receipt_candidates (organization_id, receipt_id, resolution_status);
CREATE INDEX IF NOT EXISTS product_receipt_candidates_serial_idx
  ON public.product_receipt_candidates (organization_id, normalized_serial);
CREATE INDEX IF NOT EXISTS product_inventory_units_stock_idx
  ON public.product_inventory_units (organization_id, status, warehouse_id, product_id);
CREATE INDEX IF NOT EXISTS product_inventory_units_agent_idx
  ON public.product_inventory_units (organization_id, current_agent_id, status)
  WHERE current_agent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS product_inventory_movements_unit_date_idx
  ON public.product_inventory_movements (organization_id, unit_id, movement_at DESC);
CREATE INDEX IF NOT EXISTS product_inventory_movements_receipt_idx
  ON public.product_inventory_movements (organization_id, receipt_id, movement_at DESC)
  WHERE receipt_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS product_inventory_commands_org_created_idx
  ON public.product_inventory_commands (organization_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- RLS: read through tenant capabilities; all mutations are server-command owned
-- ---------------------------------------------------------------------------
ALTER TABLE public.inventory_warehouses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_inventory_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_inventory_number_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_receipt_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_receipt_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_receipt_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_inventory_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_inventory_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_inventory_commands ENABLE ROW LEVEL SECURITY;

CREATE POLICY inventory_warehouses_select ON public.inventory_warehouses
  FOR SELECT USING (
    auth.role() = 'service_role'
    OR (organization_id = public.current_org_id() AND public.can_view_product_inventory())
  );
CREATE POLICY product_inventory_aliases_select ON public.product_inventory_aliases
  FOR SELECT USING (
    auth.role() = 'service_role'
    OR (organization_id = public.current_org_id() AND public.can_view_product_inventory())
  );
CREATE POLICY product_receipts_select ON public.product_receipts
  FOR SELECT USING (
    auth.role() = 'service_role'
    OR (organization_id = public.current_org_id() AND public.can_view_product_inventory())
  );
CREATE POLICY product_receipt_sources_select ON public.product_receipt_sources
  FOR SELECT USING (
    auth.role() = 'service_role'
    OR (organization_id = public.current_org_id() AND public.can_view_product_inventory())
  );
CREATE POLICY product_receipt_lines_select ON public.product_receipt_lines
  FOR SELECT USING (
    auth.role() = 'service_role'
    OR (organization_id = public.current_org_id() AND public.can_view_product_inventory())
  );
CREATE POLICY product_receipt_candidates_select ON public.product_receipt_candidates
  FOR SELECT USING (
    auth.role() = 'service_role'
    OR (organization_id = public.current_org_id() AND public.can_view_product_inventory())
  );
CREATE POLICY product_inventory_units_select ON public.product_inventory_units
  FOR SELECT USING (
    auth.role() = 'service_role'
    OR (organization_id = public.current_org_id() AND public.can_view_product_inventory())
  );
CREATE POLICY product_inventory_movements_select ON public.product_inventory_movements
  FOR SELECT USING (
    auth.role() = 'service_role'
    OR (organization_id = public.current_org_id() AND public.can_view_product_inventory())
  );
CREATE POLICY product_inventory_commands_select ON public.product_inventory_commands
  FOR SELECT USING (
    auth.role() = 'service_role'
    OR (
      organization_id = public.current_org_id()
      AND public.can_receive_product_inventory()
      AND actor_user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- Updated-at triggers
-- ---------------------------------------------------------------------------
DO $$
DECLARE table_name_value text;
BEGIN
  FOREACH table_name_value IN ARRAY ARRAY[
    'inventory_warehouses',
    'product_inventory_aliases',
    'product_receipts',
    'product_receipt_sources',
    'product_receipt_lines',
    'product_receipt_candidates',
    'product_inventory_units'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I',
      'trg_' || table_name_value || '_updated_at', table_name_value);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at()',
      'trg_' || table_name_value || '_updated_at', table_name_value
    );
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Default warehouse for existing and future organizations
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_default_product_inventory_warehouse()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  entity_id_value uuid;
  branch_id_value uuid;
BEGIN
  SELECT entity.id INTO entity_id_value
  FROM public.accounting_legal_entities entity
  WHERE entity.organization_id = NEW.id
    AND entity.status = 'active'
  ORDER BY entity.is_default DESC, entity.created_at
  LIMIT 1;

  SELECT branch.id INTO branch_id_value
  FROM public.accounting_branches branch
  WHERE branch.organization_id = NEW.id
    AND (entity_id_value IS NULL OR branch.legal_entity_id = entity_id_value)
    AND branch.is_active = true
  ORDER BY branch.created_at
  LIMIT 1;

  INSERT INTO public.inventory_warehouses (
    organization_id, legal_entity_id, branch_id, code, name_ar, name_en, is_default, is_active
  ) VALUES (
    NEW.id, entity_id_value, branch_id_value, 'MAIN', 'المستودع الرئيسي', 'Main Warehouse', true, true
  )
  ON CONFLICT (organization_id, code) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ensure_default_product_inventory_warehouse_trigger
  ON public.organizations;
CREATE TRIGGER ensure_default_product_inventory_warehouse_trigger
  AFTER INSERT ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.ensure_default_product_inventory_warehouse();

INSERT INTO public.inventory_warehouses (
  organization_id, legal_entity_id, branch_id, code, name_ar, name_en, is_default, is_active
)
SELECT
  organization.id,
  entity.id,
  branch.id,
  'MAIN',
  'المستودع الرئيسي',
  'Main Warehouse',
  true,
  true
FROM public.organizations organization
LEFT JOIN LATERAL (
  SELECT candidate.id
  FROM public.accounting_legal_entities candidate
  WHERE candidate.organization_id = organization.id
    AND candidate.status = 'active'
  ORDER BY candidate.is_default DESC, candidate.created_at
  LIMIT 1
) entity ON true
LEFT JOIN LATERAL (
  SELECT candidate.id
  FROM public.accounting_branches candidate
  WHERE candidate.organization_id = organization.id
    AND (entity.id IS NULL OR candidate.legal_entity_id = entity.id)
    AND candidate.is_active = true
  ORDER BY candidate.created_at
  LIMIT 1
) branch ON true
ON CONFLICT (organization_id, code) DO NOTHING;

-- Organization provisioning creates the warehouse before accounting defaults in
-- some flows. Attach the first active entity/branch as those records arrive.
CREATE OR REPLACE FUNCTION public.attach_default_product_inventory_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_TABLE_NAME = 'accounting_legal_entities'
     AND NEW.status = 'active' THEN
    UPDATE public.inventory_warehouses
    SET legal_entity_id = NEW.id,
        updated_at = now()
    WHERE organization_id = NEW.organization_id
      AND is_default = true
      AND legal_entity_id IS NULL;
  ELSIF TG_TABLE_NAME = 'accounting_branches'
        AND NEW.is_active = true THEN
    UPDATE public.inventory_warehouses
    SET legal_entity_id = COALESCE(legal_entity_id, NEW.legal_entity_id),
        branch_id = NEW.id,
        updated_at = now()
    WHERE organization_id = NEW.organization_id
      AND is_default = true
      AND branch_id IS NULL
      AND (legal_entity_id IS NULL OR legal_entity_id = NEW.legal_entity_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS attach_default_product_inventory_entity_trigger
  ON public.accounting_legal_entities;
CREATE TRIGGER attach_default_product_inventory_entity_trigger
  AFTER INSERT OR UPDATE OF status ON public.accounting_legal_entities
  FOR EACH ROW EXECUTE FUNCTION public.attach_default_product_inventory_scope();

DROP TRIGGER IF EXISTS attach_default_product_inventory_branch_trigger
  ON public.accounting_branches;
CREATE TRIGGER attach_default_product_inventory_branch_trigger
  AFTER INSERT OR UPDATE OF is_active ON public.accounting_branches
  FOR EACH ROW EXECUTE FUNCTION public.attach_default_product_inventory_scope();

-- ---------------------------------------------------------------------------
-- Employee identity provisioning: add receiver role to the existing command
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.link_employee_identity(
  p_org_id uuid,
  p_employee_id uuid,
  p_actor_user_id uuid,
  p_command_id uuid,
  p_user_id uuid,
  p_email text,
  p_full_name text,
  p_role public.org_role
)
RETURNS SETOF public.employees
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  command_row public.employee_lifecycle_commands%ROWTYPE;
  employee_row public.employees%ROWTYPE;
  input_payload jsonb := jsonb_build_object(
    'employee_id', p_employee_id,
    'user_id', p_user_id,
    'email', lower(btrim(p_email)),
    'role', p_role
  );
  input_hash text := encode(digest(input_payload::text, 'sha256'), 'hex');
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.org_members
    WHERE org_id = p_org_id AND user_id = p_actor_user_id
      AND (
        role::text IN ('admin', 'hr_admin')
        OR (role::text = 'sales_manager' AND p_role::text IN ('sales', 'sales_manager'))
      )
  ) THEN
    RAISE EXCEPTION 'HR Admin access is required.' USING ERRCODE = '42501';
  END IF;
  IF p_role::text NOT IN (
    'employee', 'hr_admin', 'hr_recruitment', 'training_manager',
    'onground_agent_manager', 'inventory_receiver', 'promoter',
    'finance_manager', 'accountant', 'finance_viewer', 'sales', 'sales_manager'
  ) THEN
    RAISE EXCEPTION 'Unsupported employee account role.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.employee_lifecycle_commands (
    org_id, idempotency_key, action, employee_id, payload_hash, actor_user_id
  )
  VALUES (p_org_id, p_command_id, 'link_identity', p_employee_id, input_hash, p_actor_user_id)
  ON CONFLICT (org_id, idempotency_key) DO NOTHING;

  SELECT * INTO command_row
  FROM public.employee_lifecycle_commands
  WHERE org_id = p_org_id AND idempotency_key = p_command_id
  FOR UPDATE;
  IF command_row.action <> 'link_identity' OR command_row.payload_hash <> input_hash THEN
    RAISE EXCEPTION 'Idempotency key was already used for a different employee command.'
      USING ERRCODE = '23505';
  END IF;

  SELECT * INTO employee_row
  FROM public.employees
  WHERE id = p_employee_id AND org_id = p_org_id
  FOR UPDATE;
  IF employee_row.id IS NULL THEN
    RAISE EXCEPTION 'Employee was not found.' USING ERRCODE = 'P0002';
  END IF;
  IF employee_row.lifecycle_status IN ('offboarding', 'offboarded', 'archived') THEN
    RAISE EXCEPTION 'Identity cannot be linked to an offboarded employee.'
      USING ERRCODE = '23514';
  END IF;
  IF employee_row.user_id IS NOT NULL AND employee_row.user_id <> p_user_id THEN
    RAISE EXCEPTION 'Employee already has a different login identity.'
      USING ERRCODE = '23505';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.org_members
    WHERE user_id = p_user_id AND org_id <> p_org_id
  ) THEN
    RAISE EXCEPTION 'Login identity belongs to another organization.'
      USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.profiles (
    user_id, org_id, full_name, email, phone, title, account_status
  )
  VALUES (
    p_user_id, p_org_id, p_full_name, lower(btrim(p_email)), employee_row.phone,
    COALESCE(employee_row.job_title, 'Employee'), 'Pending'
  )
  ON CONFLICT (user_id) DO UPDATE SET
    org_id = EXCLUDED.org_id,
    full_name = EXCLUDED.full_name,
    email = EXCLUDED.email,
    phone = EXCLUDED.phone,
    title = EXCLUDED.title,
    account_status = 'Pending',
    updated_at = now();

  INSERT INTO public.org_members (org_id, user_id, role)
  VALUES (p_org_id, p_user_id, p_role)
  ON CONFLICT (org_id, user_id) DO UPDATE SET role = EXCLUDED.role;

  UPDATE public.employees
  SET user_id = p_user_id,
      email = lower(btrim(p_email)),
      updated_at = now(),
      lifecycle_version = lifecycle_version + 1
  WHERE id = p_employee_id AND org_id = p_org_id
  RETURNING * INTO employee_row;

  UPDATE public.employee_lifecycle_commands
  SET status = 'completed',
      result = jsonb_build_object('employee_id', employee_row.id, 'user_id', p_user_id),
      completed_at = now()
  WHERE id = command_row.id;

  RETURN NEXT employee_row;
END;
$$;

REVOKE ALL ON FUNCTION public.can_receive_product_inventory() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_manage_product_inventory() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_view_product_inventory() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_receive_product_inventory() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_manage_product_inventory() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_view_product_inventory() TO authenticated, service_role;

COMMENT ON TABLE public.product_receipts IS
  'Draft and confirmed supplier receipt headers for serialized physical products.';
COMMENT ON TABLE public.product_inventory_units IS
  'One immutable-cost inventory row per confirmed serialized physical product.';
COMMENT ON TABLE public.product_inventory_movements IS
  'Append-only audit trail for every serialized product inventory movement.';
