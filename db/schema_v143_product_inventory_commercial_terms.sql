-- Phase 2: versioned workbook profiles and immutable Finance-approved commercial terms.

CREATE TABLE IF NOT EXISTS public.product_inventory_import_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 160),
  version integer NOT NULL CHECK (version > 0),
  supplier_company_id uuid REFERENCES public.sales_companies(id) ON DELETE SET NULL,
  sheet_name text,
  use_first_sheet boolean NOT NULL DEFAULT true,
  header_row integer NOT NULL DEFAULT 1 CHECK (header_row BETWEEN 1 AND 100),
  header_mapping jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(header_mapping) = 'object'),
  required_fields jsonb NOT NULL DEFAULT '["serial_number","product_sku"]'::jsonb
    CHECK (jsonb_typeof(required_fields) = 'array'),
  default_currency text NOT NULL DEFAULT 'SAR' CHECK (default_currency ~ '^[A-Z]{3}$'),
  default_condition text NOT NULL DEFAULT 'new'
    CHECK (default_condition IN ('new', 'open_box', 'refurbished')),
  default_ownership_type text NOT NULL DEFAULT 'purchased'
    CHECK (default_ownership_type IN ('purchased', 'consignment')),
  is_active boolean NOT NULL DEFAULT false,
  sample_file_sha256 text CHECK (sample_file_sha256 IS NULL OR length(sample_file_sha256) = 64),
  approval_note text,
  approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name, version)
);

CREATE UNIQUE INDEX IF NOT EXISTS product_inventory_import_profiles_one_active_idx
  ON public.product_inventory_import_profiles (organization_id)
  WHERE is_active;

CREATE INDEX IF NOT EXISTS product_inventory_import_profiles_history_idx
  ON public.product_inventory_import_profiles (organization_id, name, version DESC);

INSERT INTO public.product_inventory_import_profiles (
  organization_id, name, version, header_mapping, required_fields, is_active,
  approval_note, approved_at
)
SELECT
  organization.id,
  'قالب أجهزة الراوتر 5G',
  1,
  jsonb_build_object(
    'supplier_code', 'supplier_code',
    'receipt_reference', 'receipt_reference',
    'product_sku', 'product_sku',
    'product_name', 'product_name',
    'model', 'model',
    'serial_number', 'serial_number',
    'barcode', 'barcode',
    'unit_cost', 'unit_cost',
    'planned_sale_price', 'planned_sale_price',
    'minimum_sale_price', 'minimum_sale_price',
    'maximum_sale_price', 'maximum_sale_price',
    'commission_type', 'commission_type',
    'commission_value', 'commission_value',
    'commission_base', 'commission_base',
    'currency', 'currency',
    'tax_code', 'tax_code',
    'condition', 'condition',
    'notes', 'notes'
  ),
  '["serial_number","product_sku","unit_cost","planned_sale_price","commission_type"]'::jsonb,
  true,
  'Default canonical profile; replace with the signed client mapping when received.',
  now()
FROM public.organizations organization
WHERE NOT EXISTS (
  SELECT 1
  FROM public.product_inventory_import_profiles profile
  WHERE profile.organization_id = organization.id
);

ALTER TABLE public.product_inventory_import_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS product_inventory_import_profiles_select
  ON public.product_inventory_import_profiles;
CREATE POLICY product_inventory_import_profiles_select
  ON public.product_inventory_import_profiles
  FOR SELECT USING (
    organization_id = public.current_org_id()
    AND public.can_view_product_inventory()
  );
DROP POLICY IF EXISTS product_inventory_import_profiles_service_write
  ON public.product_inventory_import_profiles;
CREATE POLICY product_inventory_import_profiles_service_write
  ON public.product_inventory_import_profiles
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP TRIGGER IF EXISTS trg_product_inventory_import_profiles_updated_at
  ON public.product_inventory_import_profiles;
CREATE TRIGGER trg_product_inventory_import_profiles_updated_at
  BEFORE UPDATE ON public.product_inventory_import_profiles
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.product_receipt_sources
  ADD COLUMN IF NOT EXISTS import_profile_id uuid
    REFERENCES public.product_inventory_import_profiles(id) ON DELETE SET NULL;

ALTER TABLE public.product_inventory_import_rows
  ADD COLUMN IF NOT EXISTS minimum_sale_price numeric(14,2),
  ADD COLUMN IF NOT EXISTS maximum_sale_price numeric(14,2),
  ADD COLUMN IF NOT EXISTS commission_type text,
  ADD COLUMN IF NOT EXISTS commission_value numeric(14,2),
  ADD COLUMN IF NOT EXISTS commission_base text;

ALTER TABLE public.product_inventory_photo_candidates
  ADD COLUMN IF NOT EXISTS minimum_sale_price numeric(14,2),
  ADD COLUMN IF NOT EXISTS maximum_sale_price numeric(14,2),
  ADD COLUMN IF NOT EXISTS commission_type text,
  ADD COLUMN IF NOT EXISTS commission_value numeric(14,2),
  ADD COLUMN IF NOT EXISTS commission_base text;

ALTER TABLE public.product_receipt_lines
  ADD COLUMN IF NOT EXISTS minimum_sale_price numeric(14,2),
  ADD COLUMN IF NOT EXISTS maximum_sale_price numeric(14,2),
  ADD COLUMN IF NOT EXISTS commission_type text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS commission_value numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS commission_base text NOT NULL DEFAULT 'net_amount',
  ADD COLUMN IF NOT EXISTS commercial_terms_revision integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS commercial_terms_approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS commercial_terms_approved_at timestamptz;

UPDATE public.product_receipt_lines line
SET minimum_sale_price = COALESCE(line.minimum_sale_price, line.planned_unit_sale_price),
    maximum_sale_price = COALESCE(line.maximum_sale_price, line.planned_unit_sale_price),
    commission_type = CASE
      WHEN product.agent_commission_type IN ('flat', 'percentage')
        THEN product.agent_commission_type
      ELSE 'none'
    END,
    commission_value = CASE
      WHEN product.agent_commission_type IN ('flat', 'percentage')
        THEN COALESCE(product.agent_commission_value, 0)
      ELSE 0
    END,
    commission_base = 'net_amount',
    commercial_terms_approved_at = COALESCE(line.commercial_terms_approved_at, line.updated_at)
FROM public.sales_products product
WHERE product.organization_id = line.organization_id
  AND product.id = line.product_id;

ALTER TABLE public.product_receipt_lines
  ALTER COLUMN minimum_sale_price SET NOT NULL,
  ALTER COLUMN maximum_sale_price SET NOT NULL;

ALTER TABLE public.product_receipt_lines
  DROP CONSTRAINT IF EXISTS product_receipt_lines_commercial_terms_check;
ALTER TABLE public.product_receipt_lines
  ADD CONSTRAINT product_receipt_lines_commercial_terms_check CHECK (
    minimum_sale_price > 0
    AND maximum_sale_price > 0
    AND minimum_sale_price <= planned_unit_sale_price
    AND planned_unit_sale_price <= maximum_sale_price
    AND commission_type IN ('none', 'flat', 'percentage')
    AND commission_value >= 0
    AND (commission_type <> 'none' OR commission_value = 0)
    AND (commission_type <> 'percentage' OR commission_value <= 100)
    AND commission_base IN ('net_amount', 'gross_amount')
    AND commercial_terms_revision > 0
  );

ALTER TABLE public.product_inventory_units
  ADD COLUMN IF NOT EXISTS minimum_sale_price_snapshot numeric(14,2),
  ADD COLUMN IF NOT EXISTS maximum_sale_price_snapshot numeric(14,2),
  ADD COLUMN IF NOT EXISTS commission_type_snapshot text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS commission_value_snapshot numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS commission_base_snapshot text NOT NULL DEFAULT 'net_amount',
  ADD COLUMN IF NOT EXISTS commercial_terms_revision_snapshot integer NOT NULL DEFAULT 1;

UPDATE public.product_inventory_units unit
SET minimum_sale_price_snapshot = COALESCE(unit.minimum_sale_price_snapshot, line.minimum_sale_price),
    maximum_sale_price_snapshot = COALESCE(unit.maximum_sale_price_snapshot, line.maximum_sale_price),
    commission_type_snapshot = line.commission_type,
    commission_value_snapshot = line.commission_value,
    commission_base_snapshot = line.commission_base,
    commercial_terms_revision_snapshot = line.commercial_terms_revision
FROM public.product_receipt_lines line
WHERE line.organization_id = unit.organization_id
  AND line.id = unit.receipt_line_id;

ALTER TABLE public.product_inventory_units
  ALTER COLUMN minimum_sale_price_snapshot SET NOT NULL,
  ALTER COLUMN maximum_sale_price_snapshot SET NOT NULL;

ALTER TABLE public.product_inventory_units
  DROP CONSTRAINT IF EXISTS product_inventory_units_commercial_terms_check;
ALTER TABLE public.product_inventory_units
  ADD CONSTRAINT product_inventory_units_commercial_terms_check CHECK (
    minimum_sale_price_snapshot > 0
    AND maximum_sale_price_snapshot > 0
    AND minimum_sale_price_snapshot <= planned_sale_price_snapshot
    AND planned_sale_price_snapshot <= maximum_sale_price_snapshot
    AND commission_type_snapshot IN ('none', 'flat', 'percentage')
    AND commission_value_snapshot >= 0
    AND (commission_type_snapshot <> 'none' OR commission_value_snapshot = 0)
    AND (commission_type_snapshot <> 'percentage' OR commission_value_snapshot <= 100)
    AND commission_base_snapshot IN ('net_amount', 'gross_amount')
    AND commercial_terms_revision_snapshot > 0
  );

ALTER TABLE public.product_handover_lines
  ADD COLUMN IF NOT EXISTS commission_type_snapshot text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS commission_value_snapshot numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS commission_base_snapshot text NOT NULL DEFAULT 'net_amount',
  ADD COLUMN IF NOT EXISTS commercial_terms_revision_snapshot integer NOT NULL DEFAULT 1;

UPDATE public.product_handover_lines line
SET commission_type_snapshot = unit.commission_type_snapshot,
    commission_value_snapshot = unit.commission_value_snapshot,
    commission_base_snapshot = unit.commission_base_snapshot,
    commercial_terms_revision_snapshot = unit.commercial_terms_revision_snapshot
FROM public.product_inventory_units unit
WHERE unit.organization_id = line.organization_id
  AND unit.id = line.unit_id;

ALTER TABLE public.product_handover_lines
  DROP CONSTRAINT IF EXISTS product_handover_lines_commission_snapshot_check;
ALTER TABLE public.product_handover_lines
  ADD CONSTRAINT product_handover_lines_commission_snapshot_check CHECK (
    commission_type_snapshot IN ('none', 'flat', 'percentage')
    AND commission_value_snapshot >= 0
    AND (commission_type_snapshot <> 'none' OR commission_value_snapshot = 0)
    AND (commission_type_snapshot <> 'percentage' OR commission_value_snapshot <= 100)
    AND commission_base_snapshot IN ('net_amount', 'gross_amount')
    AND commercial_terms_revision_snapshot > 0
  );

CREATE TABLE IF NOT EXISTS public.product_inventory_commercial_terms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  receipt_id uuid NOT NULL REFERENCES public.product_receipts(id) ON DELETE RESTRICT,
  receipt_line_id uuid NOT NULL REFERENCES public.product_receipt_lines(id) ON DELETE RESTRICT,
  product_id uuid NOT NULL REFERENCES public.sales_products(id) ON DELETE RESTRICT,
  revision integer NOT NULL CHECK (revision > 0),
  sale_price numeric(14,2) NOT NULL CHECK (sale_price > 0),
  minimum_sale_price numeric(14,2) NOT NULL CHECK (minimum_sale_price > 0),
  maximum_sale_price numeric(14,2) NOT NULL CHECK (maximum_sale_price > 0),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  commission_type text NOT NULL CHECK (commission_type IN ('none', 'flat', 'percentage')),
  commission_value numeric(14,2) NOT NULL CHECK (commission_value >= 0),
  commission_base text NOT NULL CHECK (commission_base IN ('net_amount', 'gross_amount')),
  source text NOT NULL DEFAULT 'finance' CHECK (source IN ('catalog_default', 'workbook_proposal', 'photo_proposal', 'finance')),
  reason text,
  is_current boolean NOT NULL DEFAULT true,
  approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (minimum_sale_price <= sale_price AND sale_price <= maximum_sale_price),
  CHECK (commission_type <> 'none' OR commission_value = 0),
  CHECK (commission_type <> 'percentage' OR commission_value <= 100),
  UNIQUE (receipt_line_id, revision)
);

CREATE UNIQUE INDEX IF NOT EXISTS product_inventory_commercial_terms_current_idx
  ON public.product_inventory_commercial_terms (receipt_line_id)
  WHERE is_current;
CREATE INDEX IF NOT EXISTS product_inventory_commercial_terms_receipt_idx
  ON public.product_inventory_commercial_terms (organization_id, receipt_id, receipt_line_id, revision DESC);

INSERT INTO public.product_inventory_commercial_terms (
  organization_id, receipt_id, receipt_line_id, product_id, revision,
  sale_price, minimum_sale_price, maximum_sale_price, currency,
  commission_type, commission_value, commission_base, source,
  is_current, approved_by, approved_at
)
SELECT
  line.organization_id, line.receipt_id, line.id, line.product_id,
  line.commercial_terms_revision, line.planned_unit_sale_price,
  line.minimum_sale_price, line.maximum_sale_price, line.currency,
  line.commission_type, line.commission_value, line.commission_base,
  'catalog_default', true, line.commercial_terms_approved_by,
  COALESCE(line.commercial_terms_approved_at, line.updated_at)
FROM public.product_receipt_lines line
WHERE NOT EXISTS (
  SELECT 1 FROM public.product_inventory_commercial_terms terms
  WHERE terms.receipt_line_id = line.id
);

ALTER TABLE public.product_inventory_commercial_terms ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS product_inventory_commercial_terms_select
  ON public.product_inventory_commercial_terms;
CREATE POLICY product_inventory_commercial_terms_select
  ON public.product_inventory_commercial_terms
  FOR SELECT USING (
    organization_id = public.current_org_id()
    AND public.can_view_product_inventory()
  );
DROP POLICY IF EXISTS product_inventory_commercial_terms_service_write
  ON public.product_inventory_commercial_terms;
CREATE POLICY product_inventory_commercial_terms_service_write
  ON public.product_inventory_commercial_terms
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE TABLE IF NOT EXISTS public.product_inventory_commercial_term_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  idempotency_key uuid NOT NULL,
  receipt_id uuid NOT NULL REFERENCES public.product_receipts(id) ON DELETE RESTRICT,
  payload_hash text NOT NULL CHECK (length(payload_hash) = 64),
  status text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'completed')),
  result jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(result) = 'object'),
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  request_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (organization_id, idempotency_key)
);

ALTER TABLE public.product_inventory_commercial_term_commands ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS product_inventory_commercial_term_commands_service_only
  ON public.product_inventory_commercial_term_commands;
CREATE POLICY product_inventory_commercial_term_commands_service_only
  ON public.product_inventory_commercial_term_commands
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE OR REPLACE FUNCTION public.execute_product_inventory_set_commercial_terms(
  p_org_id uuid,
  p_actor_user_id uuid,
  p_request_id uuid,
  p_command_id uuid,
  p_receipt_id uuid,
  p_expected_version integer,
  p_terms jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_role_value text;
  receipt_row public.product_receipts%ROWTYPE;
  line_row public.product_receipt_lines%ROWTYPE;
  command_row public.product_inventory_commercial_term_commands%ROWTYPE;
  item jsonb;
  hash_value text;
  line_id_value uuid;
  revision_value integer;
  sale_price_value numeric;
  minimum_price_value numeric;
  maximum_price_value numeric;
  commission_type_value text;
  commission_value_value numeric;
  commission_base_value text;
  currency_value text;
  result_value jsonb;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501';
  END IF;
  IF p_org_id IS NULL OR p_actor_user_id IS NULL OR p_request_id IS NULL
     OR p_command_id IS NULL OR p_receipt_id IS NULL OR p_expected_version IS NULL
     OR jsonb_typeof(p_terms) <> 'array' OR jsonb_array_length(p_terms) = 0 THEN
    RAISE EXCEPTION 'Commercial terms command is incomplete.' USING ERRCODE = '22023';
  END IF;

  SELECT member.role::text INTO actor_role_value
  FROM public.org_members member
  WHERE member.org_id = p_org_id AND member.user_id = p_actor_user_id
  LIMIT 1;
  IF actor_role_value NOT IN ('admin', 'finance_manager') THEN
    RAISE EXCEPTION 'Finance Manager permission is required.' USING ERRCODE = '42501';
  END IF;

  hash_value := encode(digest(convert_to(jsonb_build_object(
    'receipt_id', p_receipt_id,
    'expected_version', p_expected_version,
    'terms', p_terms
  )::text, 'UTF8'), 'sha256'), 'hex');

  INSERT INTO public.product_inventory_commercial_term_commands (
    organization_id, idempotency_key, receipt_id, payload_hash,
    actor_user_id, request_id
  ) VALUES (
    p_org_id, p_command_id, p_receipt_id, hash_value,
    p_actor_user_id, p_request_id
  )
  ON CONFLICT (organization_id, idempotency_key) DO NOTHING;

  SELECT * INTO command_row
  FROM public.product_inventory_commercial_term_commands command
  WHERE command.organization_id = p_org_id
    AND command.idempotency_key = p_command_id
  FOR UPDATE;
  IF command_row.payload_hash <> hash_value OR command_row.receipt_id <> p_receipt_id THEN
    RAISE EXCEPTION 'Idempotency key was reused with different commercial terms.'
      USING ERRCODE = '23505';
  END IF;
  IF command_row.status = 'completed' THEN
    RETURN command_row.result;
  END IF;

  SELECT * INTO receipt_row
  FROM public.product_receipts receipt
  WHERE receipt.organization_id = p_org_id AND receipt.id = p_receipt_id
  FOR UPDATE;
  IF receipt_row.id IS NULL THEN
    RAISE EXCEPTION 'Product receipt was not found.' USING ERRCODE = 'P0002';
  END IF;
  IF receipt_row.status NOT IN ('draft', 'needs_review', 'ready_to_confirm') THEN
    RAISE EXCEPTION 'Commercial terms are locked after receipt confirmation.' USING ERRCODE = '55000';
  END IF;
  IF receipt_row.version <> p_expected_version THEN
    RAISE EXCEPTION 'Receipt version conflict.' USING ERRCODE = '40001';
  END IF;
  IF jsonb_array_length(p_terms) <> (
    SELECT count(*) FROM public.product_receipt_lines line
    WHERE line.organization_id = p_org_id AND line.receipt_id = p_receipt_id
  ) THEN
    RAISE EXCEPTION 'Every receipt group must have one commercial term.' USING ERRCODE = '23514';
  END IF;

  FOR item IN SELECT value FROM jsonb_array_elements(p_terms)
  LOOP
    line_id_value := NULLIF(item->>'receipt_line_id', '')::uuid;
    SELECT * INTO line_row
    FROM public.product_receipt_lines line
    WHERE line.organization_id = p_org_id
      AND line.receipt_id = p_receipt_id
      AND line.id = line_id_value
    FOR UPDATE;
    IF line_row.id IS NULL THEN
      RAISE EXCEPTION 'Commercial term references an invalid receipt group.' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_terms) duplicate
      WHERE NULLIF(duplicate.value->>'receipt_line_id', '')::uuid = line_id_value
      GROUP BY NULLIF(duplicate.value->>'receipt_line_id', '')::uuid
      HAVING count(*) > 1
    ) THEN
      RAISE EXCEPTION 'Each receipt group can appear only once.' USING ERRCODE = '23514';
    END IF;

    sale_price_value := NULLIF(item->>'sale_price', '')::numeric;
    minimum_price_value := COALESCE(NULLIF(item->>'minimum_sale_price', '')::numeric, sale_price_value);
    maximum_price_value := COALESCE(NULLIF(item->>'maximum_sale_price', '')::numeric, sale_price_value);
    commission_type_value := COALESCE(NULLIF(item->>'commission_type', ''), 'none');
    commission_value_value := COALESCE(NULLIF(item->>'commission_value', '')::numeric, 0);
    commission_base_value := COALESCE(NULLIF(item->>'commission_base', ''), 'net_amount');
    currency_value := upper(COALESCE(NULLIF(item->>'currency', ''), line_row.currency));

    IF sale_price_value IS NULL OR sale_price_value <= 0
       OR minimum_price_value <= 0 OR maximum_price_value <= 0
       OR minimum_price_value > sale_price_value OR sale_price_value > maximum_price_value
       OR commission_type_value NOT IN ('none', 'flat', 'percentage')
       OR commission_value_value < 0
       OR (commission_type_value = 'none' AND commission_value_value <> 0)
       OR (commission_type_value = 'percentage' AND commission_value_value > 100)
       OR commission_base_value NOT IN ('net_amount', 'gross_amount')
       OR currency_value !~ '^[A-Z]{3}$' THEN
      RAISE EXCEPTION 'Commercial price or commission rule is invalid.' USING ERRCODE = '23514';
    END IF;

    SELECT COALESCE(max(terms.revision), 0) + 1 INTO revision_value
    FROM public.product_inventory_commercial_terms terms
    WHERE terms.receipt_line_id = line_row.id;
    UPDATE public.product_inventory_commercial_terms
    SET is_current = false
    WHERE receipt_line_id = line_row.id AND is_current;
    INSERT INTO public.product_inventory_commercial_terms (
      organization_id, receipt_id, receipt_line_id, product_id, revision,
      sale_price, minimum_sale_price, maximum_sale_price, currency,
      commission_type, commission_value, commission_base, source, reason,
      is_current, approved_by, approved_at
    ) VALUES (
      p_org_id, p_receipt_id, line_row.id, line_row.product_id, revision_value,
      round(sale_price_value, 2), round(minimum_price_value, 2), round(maximum_price_value, 2),
      currency_value, commission_type_value, round(commission_value_value, 2),
      commission_base_value,
      COALESCE(NULLIF(item->>'source', ''), 'finance'),
      NULLIF(btrim(item->>'reason'), ''), true, p_actor_user_id, now()
    );

    UPDATE public.product_receipt_lines
    SET planned_unit_sale_price = round(sale_price_value, 2),
        minimum_sale_price = round(minimum_price_value, 2),
        maximum_sale_price = round(maximum_price_value, 2),
        currency = currency_value,
        commission_type = commission_type_value,
        commission_value = round(commission_value_value, 2),
        commission_base = commission_base_value,
        commercial_terms_revision = revision_value,
        commercial_terms_approved_by = p_actor_user_id,
        commercial_terms_approved_at = now(),
        expected_sales_value = round(sale_price_value * expected_quantity, 2),
        expected_margin = round((sale_price_value - unit_cost) * expected_quantity, 2),
        updated_at = now()
    WHERE organization_id = p_org_id AND id = line_row.id;
  END LOOP;

  UPDATE public.product_receipts receipt
  SET expected_sales_value = totals.expected_sales_value,
      expected_margin = totals.expected_margin,
      currency = (SELECT line.currency FROM public.product_receipt_lines line
                  WHERE line.receipt_id = receipt.id ORDER BY line.line_no LIMIT 1),
      version = receipt.version + 1,
      updated_at = now()
  FROM (
    SELECT line.receipt_id,
           round(sum(line.expected_sales_value), 2) AS expected_sales_value,
           round(sum(line.expected_margin), 2) AS expected_margin
    FROM public.product_receipt_lines line
    WHERE line.organization_id = p_org_id AND line.receipt_id = p_receipt_id
    GROUP BY line.receipt_id
  ) totals
  WHERE receipt.organization_id = p_org_id
    AND receipt.id = totals.receipt_id
  RETURNING receipt.* INTO receipt_row;

  result_value := jsonb_build_object(
    'receipt', to_jsonb(receipt_row),
    'terms', (
      SELECT COALESCE(jsonb_agg(to_jsonb(terms) ORDER BY terms.receipt_line_id), '[]'::jsonb)
      FROM public.product_inventory_commercial_terms terms
      WHERE terms.organization_id = p_org_id
        AND terms.receipt_id = p_receipt_id
        AND terms.is_current
    )
  );
  UPDATE public.product_inventory_commercial_term_commands
  SET status = 'completed', result = result_value, completed_at = now()
  WHERE id = command_row.id;
  RETURN result_value;
END;
$$;

REVOKE ALL ON FUNCTION public.execute_product_inventory_set_commercial_terms(
  uuid, uuid, uuid, uuid, uuid, integer, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.execute_product_inventory_set_commercial_terms(
  uuid, uuid, uuid, uuid, uuid, integer, jsonb
) TO service_role;

CREATE OR REPLACE FUNCTION public.validate_product_receipt_commercial_terms()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'confirmed' AND OLD.status IS DISTINCT FROM 'confirmed' THEN
    IF EXISTS (
      SELECT 1 FROM public.product_receipt_lines line
      WHERE line.organization_id = NEW.organization_id
        AND line.receipt_id = NEW.id
        AND (
          line.commercial_terms_approved_at IS NULL
          OR line.planned_unit_sale_price <= 0
          OR line.minimum_sale_price <= 0
          OR line.maximum_sale_price <= 0
          OR line.minimum_sale_price > line.planned_unit_sale_price
          OR line.planned_unit_sale_price > line.maximum_sale_price
        )
    ) OR (
      SELECT count(*) FROM public.product_inventory_commercial_terms terms
      WHERE terms.organization_id = NEW.organization_id
        AND terms.receipt_id = NEW.id AND terms.is_current
    ) <> (
      SELECT count(*) FROM public.product_receipt_lines line
      WHERE line.organization_id = NEW.organization_id AND line.receipt_id = NEW.id
    ) THEN
      RAISE EXCEPTION 'Finance must approve price and commission for every receipt group before confirmation.'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.prepare_product_receipt_line_commercial_terms()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  product_row public.sales_products%ROWTYPE;
BEGIN
  SELECT * INTO product_row
  FROM public.sales_products product
  WHERE product.organization_id = NEW.organization_id AND product.id = NEW.product_id;
  IF TG_OP = 'UPDATE'
     AND NEW.planned_unit_sale_price IS DISTINCT FROM OLD.planned_unit_sale_price
     AND NEW.commercial_terms_approved_at IS NOT DISTINCT FROM OLD.commercial_terms_approved_at THEN
    NEW.minimum_sale_price := NEW.planned_unit_sale_price;
    NEW.maximum_sale_price := NEW.planned_unit_sale_price;
    NEW.commercial_terms_approved_at := NULL;
  ELSE
    NEW.minimum_sale_price := COALESCE(NEW.minimum_sale_price, NEW.planned_unit_sale_price);
    NEW.maximum_sale_price := COALESCE(NEW.maximum_sale_price, NEW.planned_unit_sale_price);
  END IF;
  NEW.commission_type := COALESCE(
    NEW.commission_type,
    CASE WHEN product_row.agent_commission_type IN ('flat', 'percentage')
      THEN product_row.agent_commission_type ELSE 'none' END
  );
  NEW.commission_value := COALESCE(
    NEW.commission_value,
    CASE WHEN product_row.agent_commission_type IN ('flat', 'percentage')
      THEN product_row.agent_commission_value ELSE 0 END,
    0
  );
  NEW.commission_base := COALESCE(NEW.commission_base, 'net_amount');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prepare_product_receipt_line_commercial_terms
  ON public.product_receipt_lines;
CREATE TRIGGER trg_prepare_product_receipt_line_commercial_terms
  BEFORE INSERT OR UPDATE OF planned_unit_sale_price, product_id
  ON public.product_receipt_lines
  FOR EACH ROW EXECUTE FUNCTION public.prepare_product_receipt_line_commercial_terms();

CREATE OR REPLACE FUNCTION public.create_product_receipt_line_catalog_terms()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  receipt_creator uuid;
BEGIN
  SELECT receipt.created_by INTO receipt_creator
  FROM public.product_receipts receipt
  WHERE receipt.organization_id = NEW.organization_id AND receipt.id = NEW.receipt_id;
  INSERT INTO public.product_inventory_commercial_terms (
    organization_id, receipt_id, receipt_line_id, product_id, revision,
    sale_price, minimum_sale_price, maximum_sale_price, currency,
    commission_type, commission_value, commission_base, source,
    is_current, approved_by, approved_at
  ) VALUES (
    NEW.organization_id, NEW.receipt_id, NEW.id, NEW.product_id, 1,
    NEW.planned_unit_sale_price, NEW.minimum_sale_price, NEW.maximum_sale_price,
    NEW.currency, NEW.commission_type, NEW.commission_value,
    NEW.commission_base, 'catalog_default', true, receipt_creator, now()
  ) ON CONFLICT (receipt_line_id, revision) DO NOTHING;
  UPDATE public.product_receipt_lines
  SET commercial_terms_approved_by = receipt_creator,
      commercial_terms_approved_at = now()
  WHERE organization_id = NEW.organization_id AND id = NEW.id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_create_product_receipt_line_catalog_terms
  ON public.product_receipt_lines;
CREATE TRIGGER trg_create_product_receipt_line_catalog_terms
  AFTER INSERT ON public.product_receipt_lines
  FOR EACH ROW EXECUTE FUNCTION public.create_product_receipt_line_catalog_terms();

DROP TRIGGER IF EXISTS trg_validate_product_receipt_commercial_terms
  ON public.product_receipts;
CREATE TRIGGER trg_validate_product_receipt_commercial_terms
  BEFORE UPDATE OF status ON public.product_receipts
  FOR EACH ROW EXECUTE FUNCTION public.validate_product_receipt_commercial_terms();

CREATE OR REPLACE FUNCTION public.snapshot_product_inventory_unit_terms()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  line_row public.product_receipt_lines%ROWTYPE;
BEGIN
  SELECT * INTO line_row
  FROM public.product_receipt_lines line
  WHERE line.organization_id = NEW.organization_id AND line.id = NEW.receipt_line_id;
  IF line_row.id IS NULL OR line_row.commercial_terms_approved_at IS NULL THEN
    RAISE EXCEPTION 'Approved commercial terms are required before creating inventory units.'
      USING ERRCODE = '23514';
  END IF;
  NEW.planned_sale_price_snapshot := line_row.planned_unit_sale_price;
  NEW.minimum_sale_price_snapshot := line_row.minimum_sale_price;
  NEW.maximum_sale_price_snapshot := line_row.maximum_sale_price;
  NEW.commission_type_snapshot := line_row.commission_type;
  NEW.commission_value_snapshot := line_row.commission_value;
  NEW.commission_base_snapshot := line_row.commission_base;
  NEW.commercial_terms_revision_snapshot := line_row.commercial_terms_revision;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_snapshot_product_inventory_unit_terms
  ON public.product_inventory_units;
CREATE TRIGGER trg_snapshot_product_inventory_unit_terms
  BEFORE INSERT ON public.product_inventory_units
  FOR EACH ROW EXECUTE FUNCTION public.snapshot_product_inventory_unit_terms();

CREATE OR REPLACE FUNCTION public.snapshot_product_handover_terms()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  unit_row public.product_inventory_units%ROWTYPE;
BEGIN
  SELECT * INTO unit_row
  FROM public.product_inventory_units unit
  WHERE unit.organization_id = NEW.organization_id AND unit.id = NEW.unit_id;
  IF unit_row.id IS NULL THEN
    RAISE EXCEPTION 'Inventory unit was not found.' USING ERRCODE = 'P0002';
  END IF;
  NEW.planned_sale_price_snapshot := unit_row.planned_sale_price_snapshot;
  NEW.minimum_sale_price := COALESCE(NEW.minimum_sale_price, unit_row.minimum_sale_price_snapshot);
  NEW.maximum_sale_price := COALESCE(NEW.maximum_sale_price, unit_row.maximum_sale_price_snapshot);
  NEW.commission_type_snapshot := unit_row.commission_type_snapshot;
  NEW.commission_value_snapshot := unit_row.commission_value_snapshot;
  NEW.commission_base_snapshot := unit_row.commission_base_snapshot;
  NEW.commercial_terms_revision_snapshot := unit_row.commercial_terms_revision_snapshot;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_snapshot_product_handover_terms
  ON public.product_handover_lines;
CREATE TRIGGER trg_snapshot_product_handover_terms
  BEFORE INSERT ON public.product_handover_lines
  FOR EACH ROW EXECUTE FUNCTION public.snapshot_product_handover_terms();

CREATE OR REPLACE FUNCTION public.snapshot_product_sale_commission()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  handover_line public.product_handover_lines%ROWTYPE;
  commission_base_amount numeric;
BEGIN
  SELECT * INTO handover_line
  FROM public.product_handover_lines line
  WHERE line.organization_id = NEW.organization_id
    AND line.handover_id = NEW.handover_id
    AND line.unit_id = NEW.unit_id;
  IF handover_line.id IS NULL THEN
    RAISE EXCEPTION 'Handover commercial snapshot was not found.' USING ERRCODE = '23514';
  END IF;
  NEW.commission_rule_snapshot := jsonb_build_object(
    'type', handover_line.commission_type_snapshot,
    'value', handover_line.commission_value_snapshot,
    'base', handover_line.commission_base_snapshot,
    'terms_revision', handover_line.commercial_terms_revision_snapshot
  );
  commission_base_amount := CASE handover_line.commission_base_snapshot
    WHEN 'gross_amount' THEN NEW.total_amount
    ELSE NEW.net_amount
  END;
  NEW.agent_commission_amount := CASE handover_line.commission_type_snapshot
    WHEN 'flat' THEN handover_line.commission_value_snapshot
    WHEN 'percentage' THEN round(commission_base_amount * handover_line.commission_value_snapshot / 100, 2)
    ELSE 0
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_snapshot_product_sale_commission
  ON public.agent_product_sale_lines;
CREATE TRIGGER trg_snapshot_product_sale_commission
  BEFORE INSERT ON public.agent_product_sale_lines
  FOR EACH ROW EXECUTE FUNCTION public.snapshot_product_sale_commission();

CREATE OR REPLACE FUNCTION public.create_product_inventory_import_profile(
  p_org_id uuid,
  p_actor_user_id uuid,
  p_profile_id uuid,
  p_payload jsonb
)
RETURNS public.product_inventory_import_profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_role_value text;
  profile_row public.product_inventory_import_profiles%ROWTYPE;
  version_value integer;
  activate_value boolean := COALESCE((p_payload->>'is_active')::boolean, true);
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501';
  END IF;
  SELECT member.role::text INTO actor_role_value
  FROM public.org_members member
  WHERE member.org_id = p_org_id AND member.user_id = p_actor_user_id
  LIMIT 1;
  IF actor_role_value NOT IN ('admin', 'finance_manager') THEN
    RAISE EXCEPTION 'Finance Manager permission is required.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO profile_row
  FROM public.product_inventory_import_profiles profile
  WHERE profile.organization_id = p_org_id AND profile.id = p_profile_id;
  IF profile_row.id IS NOT NULL THEN
    RETURN profile_row;
  END IF;
  IF jsonb_typeof(p_payload->'header_mapping') <> 'object'
     OR jsonb_typeof(p_payload->'required_fields') <> 'array' THEN
    RAISE EXCEPTION 'Import profile mapping is invalid.' USING ERRCODE = '22023';
  END IF;
  SELECT COALESCE(max(profile.version), 0) + 1 INTO version_value
  FROM public.product_inventory_import_profiles profile
  WHERE profile.organization_id = p_org_id
    AND profile.name = btrim(p_payload->>'name');
  IF activate_value THEN
    UPDATE public.product_inventory_import_profiles
    SET is_active = false, updated_at = now()
    WHERE organization_id = p_org_id AND is_active;
  END IF;
  INSERT INTO public.product_inventory_import_profiles (
    id, organization_id, name, version, supplier_company_id,
    sheet_name, use_first_sheet, header_row, header_mapping,
    required_fields, default_currency, default_condition,
    default_ownership_type, is_active, sample_file_sha256,
    approval_note, approved_by, approved_at, created_by
  ) VALUES (
    p_profile_id, p_org_id, btrim(p_payload->>'name'), version_value,
    NULLIF(p_payload->>'supplier_company_id', '')::uuid,
    NULLIF(btrim(p_payload->>'sheet_name'), ''),
    COALESCE((p_payload->>'use_first_sheet')::boolean, true),
    COALESCE((p_payload->>'header_row')::integer, 1),
    p_payload->'header_mapping', p_payload->'required_fields',
    upper(COALESCE(NULLIF(p_payload->>'default_currency', ''), 'SAR')),
    COALESCE(NULLIF(p_payload->>'default_condition', ''), 'new'),
    COALESCE(NULLIF(p_payload->>'default_ownership_type', ''), 'purchased'),
    activate_value, NULLIF(p_payload->>'sample_file_sha256', ''),
    NULLIF(btrim(p_payload->>'approval_note'), ''),
    CASE WHEN activate_value THEN p_actor_user_id ELSE NULL END,
    CASE WHEN activate_value THEN now() ELSE NULL END,
    p_actor_user_id
  ) RETURNING * INTO profile_row;
  RETURN profile_row;
END;
$$;

REVOKE ALL ON FUNCTION public.create_product_inventory_import_profile(
  uuid, uuid, uuid, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_product_inventory_import_profile(
  uuid, uuid, uuid, jsonb
) TO service_role;

CREATE OR REPLACE FUNCTION public.activate_product_inventory_import_profile(
  p_org_id uuid,
  p_actor_user_id uuid,
  p_profile_id uuid
)
RETURNS public.product_inventory_import_profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_role_value text;
  profile_row public.product_inventory_import_profiles%ROWTYPE;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501';
  END IF;
  SELECT member.role::text INTO actor_role_value
  FROM public.org_members member
  WHERE member.org_id = p_org_id AND member.user_id = p_actor_user_id
  LIMIT 1;
  IF actor_role_value NOT IN ('admin', 'finance_manager') THEN
    RAISE EXCEPTION 'Finance Manager permission is required.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO profile_row
  FROM public.product_inventory_import_profiles profile
  WHERE profile.organization_id = p_org_id AND profile.id = p_profile_id
  FOR UPDATE;
  IF profile_row.id IS NULL THEN
    RAISE EXCEPTION 'Import profile was not found.' USING ERRCODE = 'P0002';
  END IF;
  UPDATE public.product_inventory_import_profiles
  SET is_active = false, updated_at = now()
  WHERE organization_id = p_org_id AND is_active AND id <> p_profile_id;
  UPDATE public.product_inventory_import_profiles
  SET is_active = true, approved_by = p_actor_user_id,
      approved_at = now(), updated_at = now()
  WHERE organization_id = p_org_id AND id = p_profile_id
  RETURNING * INTO profile_row;
  RETURN profile_row;
END;
$$;

REVOKE ALL ON FUNCTION public.activate_product_inventory_import_profile(
  uuid, uuid, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.activate_product_inventory_import_profile(
  uuid, uuid, uuid
) TO service_role;

CREATE OR REPLACE FUNCTION public.store_product_inventory_import_commercial_proposals(
  p_org_id uuid,
  p_receipt_id uuid,
  p_source_id uuid,
  p_kind text,
  p_rows jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  updated_count integer;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501';
  END IF;
  IF p_kind = 'workbook' THEN
    UPDATE public.product_inventory_import_rows row
    SET minimum_sale_price = NULLIF(item.value->>'minimum_sale_price', '')::numeric,
        maximum_sale_price = NULLIF(item.value->>'maximum_sale_price', '')::numeric,
        commission_type = COALESCE(NULLIF(item.value->>'commission_type', ''), 'none'),
        commission_value = COALESCE(NULLIF(item.value->>'commission_value', '')::numeric, 0),
        commission_base = COALESCE(NULLIF(item.value->>'commission_base', ''), 'net_amount'),
        updated_at = now()
    FROM jsonb_array_elements(p_rows) item
    WHERE row.organization_id = p_org_id
      AND row.receipt_id = p_receipt_id
      AND row.source_id = p_source_id
      AND row.row_number = (item.value->>'row_number')::integer;
  ELSIF p_kind = 'photo' THEN
    UPDATE public.product_inventory_photo_candidates candidate
    SET minimum_sale_price = NULLIF(item.value->>'minimum_sale_price', '')::numeric,
        maximum_sale_price = NULLIF(item.value->>'maximum_sale_price', '')::numeric,
        commission_type = COALESCE(NULLIF(item.value->>'commission_type', ''), 'none'),
        commission_value = COALESCE(NULLIF(item.value->>'commission_value', '')::numeric, 0),
        commission_base = COALESCE(NULLIF(item.value->>'commission_base', ''), 'net_amount'),
        updated_at = now()
    FROM jsonb_array_elements(p_rows) item
    WHERE candidate.organization_id = p_org_id
      AND candidate.receipt_id = p_receipt_id
      AND candidate.source_id = p_source_id
      AND candidate.candidate_index = (item.value->>'candidate_index')::integer;
  ELSE
    RAISE EXCEPTION 'Unsupported import proposal kind.' USING ERRCODE = '22023';
  END IF;
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$;

REVOKE ALL ON FUNCTION public.store_product_inventory_import_commercial_proposals(
  uuid, uuid, uuid, text, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.store_product_inventory_import_commercial_proposals(
  uuid, uuid, uuid, text, jsonb
) TO service_role;

COMMENT ON TABLE public.product_inventory_import_profiles IS
  'Immutable, versioned client workbook mappings; only one profile is active per organization.';
COMMENT ON TABLE public.product_inventory_commercial_terms IS
  'Auditable revisions of Finance-approved price ranges and commission rules per receipt group.';
