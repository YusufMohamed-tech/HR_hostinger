-- Finance-led product inventory authority and safe retirement of the dedicated receiver.
-- The historical inventory_receiver enum value remains readable but cannot mutate this workflow.

ALTER TABLE public.product_inventory_commerce_settings
  ADD COLUMN IF NOT EXISTS finance_managed_receiving_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS legacy_inventory_receiver_writes_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS workflow_version integer NOT NULL DEFAULT 1 CHECK (workflow_version >= 1);

CREATE OR REPLACE FUNCTION public.can_receive_product_inventory()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.role() = 'service_role'
    OR COALESCE((
      SELECT member.role::text IN ('admin', 'finance_manager')
      FROM public.org_members member
      WHERE member.user_id = auth.uid()
        AND member.org_id = public.current_org_id()
      LIMIT 1
    ), false);
$$;

CREATE OR REPLACE FUNCTION public.can_manage_product_inventory()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.role() = 'service_role'
    OR COALESCE((
      SELECT member.role::text IN ('admin', 'finance_manager')
      FROM public.org_members member
      WHERE member.user_id = auth.uid()
        AND member.org_id = public.current_org_id()
      LIMIT 1
    ), false);
$$;

COMMENT ON COLUMN public.product_inventory_commerce_settings.finance_managed_receiving_enabled IS
  'Enables Finance Manager ownership of serialized product receiving and custody operations.';

COMMENT ON COLUMN public.product_inventory_commerce_settings.legacy_inventory_receiver_writes_enabled IS
  'Compatibility flag retained for audit visibility; legacy receiver writes are disabled by default.';

-- Reinstall command functions with explicit Finance Manager authorization.


-- Finance-authorized manual product receipt drafting, confirmation,
-- cancellation, stock creation, movements, audit, and durable outbox events.

CREATE OR REPLACE FUNCTION public.next_product_receipt_number(
  p_org_id uuid,
  p_receipt_date date
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  year_value integer := EXTRACT(YEAR FROM p_receipt_date)::integer;
  next_value integer;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.product_inventory_number_sequences (
    organization_id, sequence_year, last_number
  )
  VALUES (p_org_id, year_value, 1)
  ON CONFLICT (organization_id, sequence_year) DO UPDATE
    SET last_number = public.product_inventory_number_sequences.last_number + 1,
        updated_at = now()
  RETURNING last_number INTO next_value;

  RETURN 'PRI-' || year_value::text || '-' || lpad(next_value::text, 6, '0');
END;
$$;

CREATE OR REPLACE FUNCTION public.execute_product_receipt_command(
  p_org_id uuid,
  p_actor_user_id uuid,
  p_request_id uuid,
  p_command_id uuid,
  p_action text,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  command_row public.product_inventory_commands%ROWTYPE;
  receipt_row public.product_receipts%ROWTYPE;
  warehouse_row public.inventory_warehouses%ROWTYPE;
  actor_role_value text;
  receipt_id_value uuid;
  supplier_company_id_value uuid;
  warehouse_id_value uuid;
  expected_version_value integer;
  ownership_type_value text;
  receipt_date_value date;
  currency_value text;
  cancellation_reason_value text;
  group_count integer := 0;
  serial_count integer := 0;
  valid_product_count integer := 0;
  inserted_count integer := 0;
  payload_value jsonb := jsonb_build_object(
    'action', p_action,
    'payload', COALESCE(p_payload, '{}'::jsonb)
  );
  hash_value text;
  result_value jsonb;
  event_payload jsonb;
  event_hash text;
  event_id uuid;
  topic_value text;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501';
  END IF;
  IF p_org_id IS NULL OR p_actor_user_id IS NULL
     OR p_request_id IS NULL OR p_command_id IS NULL THEN
    RAISE EXCEPTION 'Organization, actor, request, and command ids are required.'
      USING ERRCODE = '22023';
  END IF;
  IF p_action NOT IN ('receipt_draft_save', 'receipt_confirm', 'receipt_cancel') THEN
    RAISE EXCEPTION 'Unsupported product receipt action.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(COALESCE(p_payload, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'Product receipt payload must be an object.'
      USING ERRCODE = '22023';
  END IF;

  SELECT member.role::text INTO actor_role_value
  FROM public.org_members member
  JOIN public.organizations organization ON organization.id = member.org_id
  JOIN public.profiles profile
    ON profile.user_id = member.user_id AND profile.org_id = member.org_id
  WHERE member.org_id = p_org_id
    AND member.user_id = p_actor_user_id
    AND member.role::text IN (
      'admin', 'finance_manager'
    )
    AND lower(COALESCE(organization.status, '')) = 'active'
    AND lower(COALESCE(profile.account_status, '')) = 'active'
  LIMIT 1;
  IF actor_role_value IS NULL THEN
    RAISE EXCEPTION 'Product inventory receiving access is required.'
      USING ERRCODE = '42501';
  END IF;

  hash_value := encode(digest(payload_value::text, 'sha256'), 'hex');
  INSERT INTO public.product_inventory_commands (
    organization_id, idempotency_key, action, payload_hash,
    actor_user_id, request_id
  )
  VALUES (
    p_org_id, p_command_id, p_action, hash_value,
    p_actor_user_id, p_request_id
  )
  ON CONFLICT (organization_id, idempotency_key) DO NOTHING;

  SELECT * INTO command_row
  FROM public.product_inventory_commands
  WHERE organization_id = p_org_id
    AND idempotency_key = p_command_id
  FOR UPDATE;

  IF command_row.action <> p_action
     OR command_row.payload_hash <> hash_value
     OR command_row.actor_user_id IS DISTINCT FROM p_actor_user_id THEN
    RAISE EXCEPTION 'Idempotency key was reused for a different product inventory command.'
      USING ERRCODE = '23505';
  END IF;
  IF command_row.status = 'completed' THEN
    RETURN command_row.result;
  END IF;

  receipt_id_value := NULLIF(p_payload->>'receipt_id', '')::uuid;
  IF receipt_id_value IS NULL THEN
    RAISE EXCEPTION 'Receipt id is required.' USING ERRCODE = '22023';
  END IF;

  IF p_action = 'receipt_draft_save' THEN
    supplier_company_id_value := NULLIF(p_payload->>'supplier_company_id', '')::uuid;
    warehouse_id_value := NULLIF(p_payload->>'warehouse_id', '')::uuid;
    ownership_type_value := lower(btrim(COALESCE(p_payload->>'ownership_type', 'purchased')));
    receipt_date_value := COALESCE(NULLIF(p_payload->>'receipt_date', '')::date, CURRENT_DATE);
    currency_value := upper(btrim(COALESCE(p_payload->>'currency', 'SAR')));
    expected_version_value := COALESCE(NULLIF(p_payload->>'expected_version', '')::integer, 0);

    IF supplier_company_id_value IS NULL OR warehouse_id_value IS NULL THEN
      RAISE EXCEPTION 'Supplier company and warehouse are required.'
        USING ERRCODE = '23514';
    END IF;
    IF ownership_type_value NOT IN ('purchased', 'consignment') THEN
      RAISE EXCEPTION 'Ownership type must be purchased or consignment.'
        USING ERRCODE = '23514';
    END IF;
    IF currency_value !~ '^[A-Z]{3}$' THEN
      RAISE EXCEPTION 'Currency must be a three-letter code.'
        USING ERRCODE = '23514';
    END IF;
    IF jsonb_typeof(p_payload->'groups') <> 'array' THEN
      RAISE EXCEPTION 'Manual receipt groups are required.'
        USING ERRCODE = '22023';
    END IF;

    group_count := jsonb_array_length(p_payload->'groups');
    IF group_count < 1 OR group_count > 100 THEN
      RAISE EXCEPTION 'A receipt must contain between 1 and 100 product groups.'
        USING ERRCODE = '23514';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.sales_companies company
      WHERE company.organization_id = p_org_id
        AND company.id = supplier_company_id_value
        AND company.is_active = true
    ) THEN
      RAISE EXCEPTION 'Supplier company was not found or is inactive.'
        USING ERRCODE = 'P0002';
    END IF;

    SELECT * INTO warehouse_row
    FROM public.inventory_warehouses warehouse
    WHERE warehouse.organization_id = p_org_id
      AND warehouse.id = warehouse_id_value
      AND warehouse.is_active = true
    FOR SHARE;
    IF warehouse_row.id IS NULL THEN
      RAISE EXCEPTION 'Warehouse was not found or is inactive.'
        USING ERRCODE = 'P0002';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM jsonb_to_recordset(p_payload->'groups') AS item(
        product_id uuid,
        unit_cost numeric,
        planned_sale_price numeric,
        currency text,
        tax_included boolean,
        condition text,
        serial_numbers jsonb
      )
      WHERE item.product_id IS NULL
        OR item.unit_cost IS NULL OR item.unit_cost <= 0
        OR item.planned_sale_price IS NULL OR item.planned_sale_price <= 0
        OR COALESCE(upper(btrim(item.currency)), currency_value) !~ '^[A-Z]{3}$'
        OR COALESCE(lower(btrim(item.condition)), 'new') NOT IN ('new', 'open_box', 'refurbished')
        OR jsonb_typeof(item.serial_numbers) <> 'array'
        OR jsonb_array_length(item.serial_numbers) < 1
        OR jsonb_array_length(item.serial_numbers) > 1000
    ) THEN
      RAISE EXCEPTION 'One or more receipt groups have invalid product, pricing, condition, or serial data.'
        USING ERRCODE = '23514';
    END IF;

    SELECT count(*)::integer INTO serial_count
    FROM jsonb_to_recordset(p_payload->'groups') AS item(serial_numbers jsonb)
    CROSS JOIN LATERAL jsonb_array_elements_text(item.serial_numbers) serial(value);
    IF serial_count < 1 OR serial_count > 1000 THEN
      RAISE EXCEPTION 'A manual receipt must contain between 1 and 1000 serialized units.'
        USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM jsonb_to_recordset(p_payload->'groups') AS item(serial_numbers jsonb)
      CROSS JOIN LATERAL jsonb_array_elements_text(item.serial_numbers) serial(value)
      WHERE length(btrim(serial.value)) NOT BETWEEN 1 AND 160
        OR length(public.normalize_product_serial(serial.value)) NOT BETWEEN 1 AND 160
    ) THEN
      RAISE EXCEPTION 'One or more serial numbers are invalid.'
        USING ERRCODE = '23514';
    END IF;

    IF (
      SELECT count(DISTINCT public.normalize_product_serial(serial.value))
      FROM jsonb_to_recordset(p_payload->'groups') AS item(serial_numbers jsonb)
      CROSS JOIN LATERAL jsonb_array_elements_text(item.serial_numbers) serial(value)
    ) <> serial_count THEN
      RAISE EXCEPTION 'Serial numbers must be unique inside the receipt.'
        USING ERRCODE = '23505';
    END IF;

    SELECT count(*)::integer INTO valid_product_count
    FROM jsonb_to_recordset(p_payload->'groups') AS item(product_id uuid)
    JOIN public.sales_products product
      ON product.organization_id = p_org_id
     AND product.id = item.product_id
     AND product.company_id = supplier_company_id_value
     AND product.is_active = true
     AND product.inventory_enabled = true
     AND product.tracking_mode = 'serialized';
    IF valid_product_count <> group_count THEN
      RAISE EXCEPTION 'Every group must use an active serialized inventory product from the selected supplier.'
        USING ERRCODE = '23514';
    END IF;

    SELECT * INTO receipt_row
    FROM public.product_receipts receipt
    WHERE receipt.organization_id = p_org_id
      AND receipt.id = receipt_id_value
    FOR UPDATE;

    IF receipt_row.id IS NULL THEN
      INSERT INTO public.product_receipts (
        id, organization_id, receipt_no, supplier_company_id,
        legal_entity_id, branch_id, warehouse_id, ownership_type,
        receipt_date, delivery_note_no, supplier_invoice_no,
        invoice_received, currency, notes, source_methods, status,
        accounting_status, created_by
      )
      VALUES (
        receipt_id_value, p_org_id,
        public.next_product_receipt_number(p_org_id, receipt_date_value),
        supplier_company_id_value, warehouse_row.legal_entity_id,
        warehouse_row.branch_id, warehouse_id_value, ownership_type_value,
        receipt_date_value, NULLIF(btrim(p_payload->>'delivery_note_no'), ''),
        NULLIF(btrim(p_payload->>'supplier_invoice_no'), ''),
        COALESCE((p_payload->>'invoice_received')::boolean, false),
        currency_value, NULLIF(btrim(p_payload->>'notes'), ''),
        ARRAY['manual']::text[], 'ready_to_confirm',
        CASE WHEN ownership_type_value = 'consignment' THEN 'not_required' ELSE 'pending' END,
        p_actor_user_id
      )
      RETURNING * INTO receipt_row;
    ELSE
      IF receipt_row.status NOT IN ('draft', 'needs_review', 'ready_to_confirm') THEN
        RAISE EXCEPTION 'Only an editable draft receipt can be changed.'
          USING ERRCODE = '55000';
      END IF;
      IF expected_version_value <> receipt_row.version THEN
        RAISE EXCEPTION 'Receipt version conflict.'
          USING ERRCODE = '40001';
      END IF;
      IF receipt_row.created_by <> p_actor_user_id
         AND actor_role_value = 'inventory_receiver' THEN
        RAISE EXCEPTION 'Receivers can edit only their own draft receipts.'
          USING ERRCODE = '42501';
      END IF;

      UPDATE public.product_receipts SET
        supplier_company_id = supplier_company_id_value,
        legal_entity_id = warehouse_row.legal_entity_id,
        branch_id = warehouse_row.branch_id,
        warehouse_id = warehouse_id_value,
        ownership_type = ownership_type_value,
        receipt_date = receipt_date_value,
        delivery_note_no = NULLIF(btrim(p_payload->>'delivery_note_no'), ''),
        supplier_invoice_no = NULLIF(btrim(p_payload->>'supplier_invoice_no'), ''),
        invoice_received = COALESCE((p_payload->>'invoice_received')::boolean, false),
        currency = currency_value,
        notes = NULLIF(btrim(p_payload->>'notes'), ''),
        source_methods = ARRAY['manual']::text[],
        status = 'ready_to_confirm',
        accounting_status = CASE
          WHEN ownership_type_value = 'consignment' THEN 'not_required'
          ELSE 'pending'
        END,
        version = version + 1,
        updated_at = now()
      WHERE organization_id = p_org_id AND id = receipt_id_value
      RETURNING * INTO receipt_row;

      DELETE FROM public.product_receipt_lines
      WHERE organization_id = p_org_id AND receipt_id = receipt_id_value;
    END IF;

    WITH group_rows AS (
      SELECT
        (item.value->>'product_id')::uuid AS product_id,
        (item.value->>'unit_cost')::numeric AS unit_cost,
        (item.value->>'planned_sale_price')::numeric AS planned_sale_price,
        item.value->>'currency' AS currency,
        (item.value->>'tax_included')::boolean AS tax_included,
        item.value->>'condition' AS condition,
        item.value->'serial_numbers' AS serial_numbers,
        item.ordinal::integer AS line_no
      FROM jsonb_array_elements(p_payload->'groups')
        WITH ORDINALITY AS item(value, ordinal)
    )
    INSERT INTO public.product_receipt_lines (
      organization_id, receipt_id, line_no, product_id,
      product_name_snapshot, sku_snapshot, model_snapshot,
      ownership_type, condition, expected_quantity, quantity,
      unit_cost, planned_unit_sale_price, currency, tax_included,
      tax_rate_id, total_cost, expected_sales_value, expected_margin,
      inventory_account_id, cogs_account_id, revenue_account_id
    )
    SELECT
      p_org_id, receipt_id_value, group_row.line_no, product.id,
      product.name, product.sku, product.model, ownership_type_value,
      COALESCE(lower(btrim(group_row.condition)), 'new'),
      jsonb_array_length(group_row.serial_numbers), 0,
      round(group_row.unit_cost, 2), round(group_row.planned_sale_price, 2),
      COALESCE(upper(btrim(group_row.currency)), currency_value),
      COALESCE(group_row.tax_included, true), product.tax_rate_id,
      round(group_row.unit_cost * jsonb_array_length(group_row.serial_numbers), 2),
      round(group_row.planned_sale_price * jsonb_array_length(group_row.serial_numbers), 2),
      round(
        (group_row.planned_sale_price - group_row.unit_cost)
        * jsonb_array_length(group_row.serial_numbers),
        2
      ),
      product.inventory_account_id, product.cogs_account_id,
      product.revenue_account_id
    FROM group_rows group_row
    JOIN public.sales_products product
      ON product.organization_id = p_org_id
     AND product.id = group_row.product_id;

    WITH group_rows AS (
      SELECT
        (item.value->>'product_id')::uuid AS product_id,
        item.value->'serial_numbers' AS serial_numbers,
        item.ordinal::integer AS line_no
      FROM jsonb_array_elements(p_payload->'groups')
        WITH ORDINALITY AS item(value, ordinal)
    )
    INSERT INTO public.product_receipt_candidates (
      organization_id, receipt_id, receipt_line_id, source_reference,
      raw_product_name, suggested_product_id, final_product_id,
      raw_serial, normalized_serial, confidence, resolution_status,
      validation_errors, reviewed_by, reviewed_at
    )
    SELECT
      p_org_id, receipt_id_value, line.id,
      'manual:' || serial.ordinal::text,
      product.name, product.id, product.id,
      btrim(serial.value), public.normalize_product_serial(serial.value),
      1, 'accepted', '[]'::jsonb, p_actor_user_id, now()
    FROM group_rows group_row
    JOIN public.product_receipt_lines line
      ON line.organization_id = p_org_id
     AND line.receipt_id = receipt_id_value
     AND line.line_no = group_row.line_no
    JOIN public.sales_products product
      ON product.organization_id = p_org_id
     AND product.id = group_row.product_id
    CROSS JOIN LATERAL
      jsonb_array_elements_text(group_row.serial_numbers)
      WITH ORDINALITY AS serial(value, ordinal);

    UPDATE public.product_receipts receipt SET
      total_units = totals.total_units,
      physical_total_cost = totals.total_cost,
      expected_sales_value = totals.expected_sales_value,
      expected_margin = totals.expected_margin,
      updated_at = now()
    FROM (
      SELECT
        sum(line.expected_quantity)::integer AS total_units,
        round(sum(line.total_cost), 2) AS total_cost,
        round(sum(line.expected_sales_value), 2) AS expected_sales_value,
        round(sum(line.expected_margin), 2) AS expected_margin
      FROM public.product_receipt_lines line
      WHERE line.organization_id = p_org_id
        AND line.receipt_id = receipt_id_value
    ) totals
    WHERE receipt.organization_id = p_org_id
      AND receipt.id = receipt_id_value
    RETURNING receipt.* INTO receipt_row;

    topic_value := 'product_inventory.receipt_draft_saved';
    event_payload := jsonb_build_object(
      'event_type', topic_value,
      'receipt_id', receipt_row.id,
      'receipt_no', receipt_row.receipt_no,
      'group_count', group_count,
      'total_units', receipt_row.total_units,
      'total_cost', receipt_row.physical_total_cost,
      'expected_sales_value', receipt_row.expected_sales_value,
      'ownership_type', receipt_row.ownership_type,
      'version', receipt_row.version
    );
    result_value := jsonb_build_object(
      'receipt', to_jsonb(receipt_row),
      'group_count', group_count,
      'total_units', receipt_row.total_units
    );

  ELSIF p_action = 'receipt_confirm' THEN
    expected_version_value := COALESCE(NULLIF(p_payload->>'expected_version', '')::integer, 0);

    SELECT * INTO receipt_row
    FROM public.product_receipts receipt
    WHERE receipt.organization_id = p_org_id
      AND receipt.id = receipt_id_value
    FOR UPDATE;
    IF receipt_row.id IS NULL THEN
      RAISE EXCEPTION 'Product receipt was not found.' USING ERRCODE = 'P0002';
    END IF;
    IF receipt_row.status NOT IN ('draft', 'needs_review', 'ready_to_confirm') THEN
      RAISE EXCEPTION 'Only an editable receipt can be confirmed.'
        USING ERRCODE = '55000';
    END IF;
    IF expected_version_value <> receipt_row.version THEN
      RAISE EXCEPTION 'Receipt version conflict.' USING ERRCODE = '40001';
    END IF;
    IF receipt_row.created_by <> p_actor_user_id
       AND actor_role_value = 'inventory_receiver' THEN
      RAISE EXCEPTION 'Receivers can confirm only their own receipts.'
        USING ERRCODE = '42501';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.product_receipt_lines line
      WHERE line.organization_id = p_org_id
        AND line.receipt_id = receipt_id_value
    ) THEN
      RAISE EXCEPTION 'Receipt has no product groups.' USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.product_receipt_lines line
      LEFT JOIN LATERAL (
        SELECT count(*)::integer AS candidate_count
        FROM public.product_receipt_candidates candidate
        WHERE candidate.organization_id = p_org_id
          AND candidate.receipt_line_id = line.id
          AND candidate.resolution_status = 'accepted'
      ) candidates ON true
      WHERE line.organization_id = p_org_id
        AND line.receipt_id = receipt_id_value
        AND (
          line.unit_cost <= 0
          OR line.planned_unit_sale_price <= 0
          OR line.expected_quantity <> candidates.candidate_count
        )
    ) THEN
      RAISE EXCEPTION 'Every group must have valid prices and an accepted serial for every unit.'
        USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.product_receipt_candidates candidate
      JOIN public.product_inventory_units unit
        ON unit.organization_id = p_org_id
       AND unit.normalized_serial_number = candidate.normalized_serial
      WHERE candidate.organization_id = p_org_id
        AND candidate.receipt_id = receipt_id_value
        AND candidate.resolution_status = 'accepted'
    ) THEN
      RAISE EXCEPTION 'One or more serial numbers already exist in confirmed stock.'
        USING ERRCODE = '23505';
    END IF;

    WITH inserted_units AS (
      INSERT INTO public.product_inventory_units (
        organization_id, product_id, receipt_id, receipt_line_id,
        warehouse_id, raw_serial_number, normalized_serial_number,
        condition, ownership_type, status, unit_cost_snapshot,
        planned_sale_price_snapshot, currency
      )
      SELECT
        p_org_id, line.product_id, receipt_row.id, line.id,
        receipt_row.warehouse_id, candidate.raw_serial,
        candidate.normalized_serial, line.condition, line.ownership_type,
        'in_stock', line.unit_cost, line.planned_unit_sale_price, line.currency
      FROM public.product_receipt_candidates candidate
      JOIN public.product_receipt_lines line
        ON line.organization_id = p_org_id
       AND line.id = candidate.receipt_line_id
       AND line.receipt_id = receipt_row.id
      WHERE candidate.organization_id = p_org_id
        AND candidate.receipt_id = receipt_row.id
        AND candidate.resolution_status = 'accepted'
      ORDER BY candidate.normalized_serial
      RETURNING id, warehouse_id
    )
    INSERT INTO public.product_inventory_movements (
      organization_id, unit_id, movement_type, to_warehouse_id,
      receipt_id, reason, performed_by, metadata
    )
    SELECT
      p_org_id, unit.id, 'receipt', unit.warehouse_id, receipt_row.id,
      'Confirmed manual product receipt ' || receipt_row.receipt_no,
      p_actor_user_id,
      jsonb_build_object('receipt_no', receipt_row.receipt_no, 'command_id', p_command_id)
    FROM inserted_units unit;
    GET DIAGNOSTICS inserted_count = ROW_COUNT;

    IF inserted_count <> receipt_row.total_units THEN
      RAISE EXCEPTION 'Confirmed unit count does not match the receipt total.'
        USING ERRCODE = '40001';
    END IF;

    UPDATE public.product_receipt_lines SET
      quantity = expected_quantity,
      updated_at = now()
    WHERE organization_id = p_org_id
      AND receipt_id = receipt_row.id;

    UPDATE public.product_receipts SET
      status = 'confirmed',
      confirmed_by = p_actor_user_id,
      confirmed_at = now(),
      accounting_status = CASE
        WHEN ownership_type = 'consignment' THEN 'not_required'
        ELSE 'pending'
      END,
      version = version + 1,
      updated_at = now()
    WHERE organization_id = p_org_id
      AND id = receipt_row.id
    RETURNING * INTO receipt_row;

    topic_value := 'product_inventory.receipt_confirmed';
    event_payload := jsonb_build_object(
      'event_type', topic_value,
      'receipt_id', receipt_row.id,
      'receipt_no', receipt_row.receipt_no,
      'supplier_company_id', receipt_row.supplier_company_id,
      'warehouse_id', receipt_row.warehouse_id,
      'ownership_type', receipt_row.ownership_type,
      'total_units', receipt_row.total_units,
      'total_cost', receipt_row.physical_total_cost,
      'expected_sales_value', receipt_row.expected_sales_value,
      'accounting_status', receipt_row.accounting_status,
      'version', receipt_row.version
    );
    result_value := jsonb_build_object(
      'receipt', to_jsonb(receipt_row),
      'inserted_units', inserted_count
    );

  ELSE
    expected_version_value := COALESCE(NULLIF(p_payload->>'expected_version', '')::integer, 0);
    cancellation_reason_value := NULLIF(btrim(p_payload->>'reason'), '');
    IF cancellation_reason_value IS NULL OR length(cancellation_reason_value) < 3 THEN
      RAISE EXCEPTION 'Cancellation reason is required.'
        USING ERRCODE = '23514';
    END IF;

    SELECT * INTO receipt_row
    FROM public.product_receipts receipt
    WHERE receipt.organization_id = p_org_id
      AND receipt.id = receipt_id_value
    FOR UPDATE;
    IF receipt_row.id IS NULL THEN
      RAISE EXCEPTION 'Product receipt was not found.' USING ERRCODE = 'P0002';
    END IF;
    IF receipt_row.status NOT IN ('draft', 'needs_review', 'ready_to_confirm') THEN
      RAISE EXCEPTION 'Only an unconfirmed receipt can be cancelled.'
        USING ERRCODE = '55000';
    END IF;
    IF expected_version_value <> receipt_row.version THEN
      RAISE EXCEPTION 'Receipt version conflict.' USING ERRCODE = '40001';
    END IF;
    IF receipt_row.created_by <> p_actor_user_id
       AND actor_role_value = 'inventory_receiver' THEN
      RAISE EXCEPTION 'Receivers can cancel only their own receipts.'
        USING ERRCODE = '42501';
    END IF;

    UPDATE public.product_receipts SET
      status = 'cancelled',
      cancelled_by = p_actor_user_id,
      cancelled_at = now(),
      cancellation_reason = cancellation_reason_value,
      version = version + 1,
      updated_at = now()
    WHERE organization_id = p_org_id
      AND id = receipt_row.id
    RETURNING * INTO receipt_row;

    topic_value := 'product_inventory.receipt_cancelled';
    event_payload := jsonb_build_object(
      'event_type', topic_value,
      'receipt_id', receipt_row.id,
      'receipt_no', receipt_row.receipt_no,
      'reason', receipt_row.cancellation_reason,
      'version', receipt_row.version
    );
    result_value := jsonb_build_object('receipt', to_jsonb(receipt_row));
  END IF;

  event_hash := encode(digest(event_payload::text, 'sha256'), 'hex');
  INSERT INTO public.business_events (
    org_id, source_type, business_key, event_version, payload, payload_hash,
    status, request_id, actor_user_id, occurred_at, processed_at
  )
  VALUES (
    p_org_id, 'product_receipt',
    receipt_row.id::text || ':' || p_action || ':' || receipt_row.version::text,
    receipt_row.version, event_payload, event_hash,
    'completed', p_request_id, p_actor_user_id, now(), now()
  )
  RETURNING id INTO event_id;

  INSERT INTO public.event_outbox (
    org_id, business_event_id, topic, payload, payload_hash
  )
  VALUES (p_org_id, event_id, topic_value, event_payload, event_hash);

  INSERT INTO public.operational_audit_logs (
    org_id, request_id, actor_user_id, actor_role, action,
    target_type, target_id, outcome, status_code, metadata
  )
  VALUES (
    p_org_id, p_request_id, p_actor_user_id, actor_role_value, topic_value,
    'product_receipt', receipt_row.id::text, 'success', 200,
    result_value - 'receipt'
  );

  UPDATE public.product_inventory_commands SET
    entity_id = receipt_row.id,
    status = 'completed',
    result = result_value,
    completed_at = now()
  WHERE id = command_row.id;

  RETURN result_value;
END;
$$;

REVOKE ALL ON FUNCTION public.next_product_receipt_number(uuid, date)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.next_product_receipt_number(uuid, date)
  TO service_role;

REVOKE ALL ON FUNCTION public.execute_product_receipt_command(
  uuid, uuid, uuid, uuid, text, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.execute_product_receipt_command(
  uuid, uuid, uuid, uuid, text, jsonb
) TO service_role;

COMMENT ON FUNCTION public.execute_product_receipt_command(
  uuid, uuid, uuid, uuid, text, jsonb
) IS
  'Atomically saves, confirms, or cancels manual serialized product receipts with idempotency, movements, audit, and durable events.';


CREATE OR REPLACE FUNCTION public.execute_product_workbook_preview(
  p_org_id uuid,
  p_actor_user_id uuid,
  p_request_id uuid,
  p_command_id uuid,
  p_receipt_id uuid,
  p_source_id uuid,
  p_managed_file_id uuid,
  p_header jsonb,
  p_file jsonb,
  p_rows jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  command_row public.product_inventory_import_commands%ROWTYPE;
  receipt_row public.product_receipts%ROWTYPE;
  source_row public.product_receipt_sources%ROWTYPE;
  warehouse_row public.inventory_warehouses%ROWTYPE;
  actor_role_value text;
  supplier_id_value uuid;
  warehouse_id_value uuid;
  ownership_value text;
  source_type_value text;
  receipt_date_value date;
  currency_value text;
  row_count_value integer;
  valid_count_value integer;
  warning_count_value integer;
  invalid_count_value integer;
  duplicate_count_value integer;
  unmatched_count_value integer;
  payload_value jsonb;
  hash_value text;
  event_payload jsonb;
  event_hash text;
  event_id_value uuid;
  result_value jsonb;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501';
  END IF;
  IF p_org_id IS NULL OR p_actor_user_id IS NULL OR p_request_id IS NULL
     OR p_command_id IS NULL OR p_receipt_id IS NULL OR p_source_id IS NULL
     OR p_managed_file_id IS NULL THEN
    RAISE EXCEPTION 'Workbook preview identifiers are required.'
      USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(COALESCE(p_header, '{}'::jsonb)) <> 'object'
     OR jsonb_typeof(COALESCE(p_file, '{}'::jsonb)) <> 'object'
     OR jsonb_typeof(COALESCE(p_rows, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'Workbook preview payload is invalid.'
      USING ERRCODE = '22023';
  END IF;

  SELECT member.role::text INTO actor_role_value
  FROM public.org_members member
  JOIN public.organizations organization ON organization.id = member.org_id
  JOIN public.profiles profile
    ON profile.user_id = member.user_id AND profile.org_id = member.org_id
  WHERE member.org_id = p_org_id
    AND member.user_id = p_actor_user_id
    AND member.role::text IN (
      'admin', 'finance_manager'
    )
    AND lower(COALESCE(organization.status, '')) = 'active'
    AND lower(COALESCE(profile.account_status, '')) = 'active'
  LIMIT 1;
  IF actor_role_value IS NULL THEN
    RAISE EXCEPTION 'Product inventory receiving access is required.'
      USING ERRCODE = '42501';
  END IF;

  payload_value := jsonb_build_object(
    'receipt_id', p_receipt_id,
    'source_id', p_source_id,
    'managed_file_id', p_managed_file_id,
    'header', p_header,
    'file', p_file,
    'rows', p_rows
  );
  hash_value := encode(digest(payload_value::text, 'sha256'), 'hex');

  INSERT INTO public.product_inventory_import_commands (
    organization_id, idempotency_key, action, receipt_id, source_id,
    payload_hash, actor_user_id, request_id
  )
  VALUES (
    p_org_id, p_command_id, 'workbook_preview', p_receipt_id, p_source_id,
    hash_value, p_actor_user_id, p_request_id
  )
  ON CONFLICT (organization_id, idempotency_key) DO NOTHING;

  SELECT * INTO command_row
  FROM public.product_inventory_import_commands
  WHERE organization_id = p_org_id AND idempotency_key = p_command_id
  FOR UPDATE;
  IF command_row.action <> 'workbook_preview'
     OR command_row.payload_hash <> hash_value
     OR command_row.actor_user_id IS DISTINCT FROM p_actor_user_id THEN
    RAISE EXCEPTION 'Workbook preview idempotency key was reused.'
      USING ERRCODE = '23505';
  END IF;
  IF command_row.status = 'completed' THEN
    RETURN command_row.result;
  END IF;

  supplier_id_value := NULLIF(p_header->>'supplier_company_id', '')::uuid;
  warehouse_id_value := NULLIF(p_header->>'warehouse_id', '')::uuid;
  ownership_value := lower(btrim(COALESCE(p_header->>'ownership_type', 'purchased')));
  receipt_date_value := COALESCE(NULLIF(p_header->>'receipt_date', '')::date, CURRENT_DATE);
  currency_value := upper(btrim(COALESCE(p_header->>'currency', 'SAR')));
  source_type_value := lower(btrim(COALESCE(p_file->>'source_type', '')));
  row_count_value := jsonb_array_length(p_rows);

  IF supplier_id_value IS NULL OR warehouse_id_value IS NULL
     OR ownership_value NOT IN ('purchased', 'consignment')
     OR currency_value !~ '^[A-Z]{3}$'
     OR source_type_value NOT IN ('excel', 'csv') THEN
    RAISE EXCEPTION 'Workbook receipt header is invalid.' USING ERRCODE = '23514';
  END IF;
  IF row_count_value < 1 OR row_count_value > 10000 THEN
    RAISE EXCEPTION 'Workbook must contain between 1 and 10000 data rows.'
      USING ERRCODE = '23514';
  END IF;
  IF p_file->>'bucket' <> 'product-inventory-imports'
     OR p_file->>'scan_status' <> 'clean'
     OR length(COALESCE(p_file->>'sha256', '')) <> 64
     OR COALESCE((p_file->>'size_bytes')::bigint, 0) <= 0
     OR COALESCE((p_file->>'size_bytes')::bigint, 0) > 10485760
     OR p_file->>'path' NOT LIKE
       p_org_id::text || '/' || p_receipt_id::text || '/' || p_command_id::text || '/%' THEN
    RAISE EXCEPTION 'Workbook evidence must be clean and tenant scoped.'
      USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.product_inventory_import_rows
    WHERE organization_id = p_org_id AND receipt_id = p_receipt_id
  ) OR EXISTS (
    SELECT 1 FROM public.product_receipts
    WHERE organization_id = p_org_id AND id = p_receipt_id
  ) THEN
    RAISE EXCEPTION 'Workbook receipt already exists.' USING ERRCODE = '23505';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.sales_companies company
    WHERE company.organization_id = p_org_id
      AND company.id = supplier_id_value
      AND company.is_active = true
  ) THEN
    RAISE EXCEPTION 'Supplier company was not found or is inactive.'
      USING ERRCODE = 'P0002';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_rows) item(value)
    LEFT JOIN public.sales_products product
      ON product.organization_id = p_org_id
     AND product.company_id = supplier_id_value
     AND product.id = NULLIF(item.value->>'product_id', '')::uuid
     AND product.is_active = true
     AND product.inventory_enabled = true
     AND product.tracking_mode = 'serialized'
    WHERE NULLIF(item.value->>'product_id', '') IS NOT NULL
      AND product.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Workbook preview contains a product outside the selected supplier catalog.'
      USING ERRCODE = '23514';
  END IF;

  SELECT * INTO warehouse_row
  FROM public.inventory_warehouses warehouse
  WHERE warehouse.organization_id = p_org_id
    AND warehouse.id = warehouse_id_value
    AND warehouse.is_active = true
  FOR SHARE;
  IF warehouse_row.id IS NULL THEN
    RAISE EXCEPTION 'Warehouse was not found or is inactive.'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT
    count(*) FILTER (WHERE item.value->>'status' = 'valid'),
    count(*) FILTER (WHERE item.value->>'status' = 'warning'),
    count(*) FILTER (WHERE item.value->>'status' = 'invalid'),
    count(*) FILTER (WHERE item.value->>'status' = 'duplicate'),
    count(*) FILTER (WHERE item.value->>'status' = 'unmatched')
  INTO
    valid_count_value, warning_count_value, invalid_count_value,
    duplicate_count_value, unmatched_count_value
  FROM jsonb_array_elements(p_rows) item(value);

  INSERT INTO public.product_receipts (
    id, organization_id, receipt_no, supplier_company_id,
    legal_entity_id, branch_id, warehouse_id, ownership_type,
    receipt_date, delivery_note_no, supplier_invoice_no,
    invoice_received, currency, notes, source_methods, status,
    accounting_status, created_by
  )
  VALUES (
    p_receipt_id, p_org_id,
    public.next_product_receipt_number(p_org_id, receipt_date_value),
    supplier_id_value, warehouse_row.legal_entity_id, warehouse_row.branch_id,
    warehouse_id_value, ownership_value, receipt_date_value,
    NULLIF(btrim(p_header->>'delivery_note_no'), ''),
    NULLIF(btrim(p_header->>'supplier_invoice_no'), ''),
    COALESCE((p_header->>'invoice_received')::boolean, false),
    currency_value, NULLIF(btrim(p_header->>'notes'), ''),
    ARRAY[source_type_value]::text[], 'needs_review',
    CASE WHEN ownership_value = 'consignment' THEN 'not_required' ELSE 'pending' END,
    p_actor_user_id
  )
  RETURNING * INTO receipt_row;

  INSERT INTO public.managed_files (
    id, org_id, bucket_id, storage_path, owner_type, owner_id,
    original_name, detected_mime, size_bytes, sha256,
    scan_status, scan_engine, scanned_at, retention_until, uploaded_by
  )
  VALUES (
    p_managed_file_id, p_org_id, p_file->>'bucket', p_file->>'path',
    'product_inventory_workbook', p_source_id,
    p_file->>'filename', p_file->>'type', (p_file->>'size_bytes')::bigint,
    p_file->>'sha256', p_file->>'scan_status', p_file->>'scan_engine',
    (p_file->>'scanned_at')::timestamptz, CURRENT_DATE + 365, p_actor_user_id
  );

  INSERT INTO public.product_receipt_sources (
    id, organization_id, receipt_id, source_type, storage_path,
    original_name, mime_type, size_bytes, extraction_provider,
    extraction_version, extraction_status, raw_extraction, confidence,
    uploaded_by, managed_file_id, file_sha256, total_rows,
    valid_rows, warning_rows, invalid_rows, duplicate_rows, unmatched_rows
  )
  VALUES (
    p_source_id, p_org_id, p_receipt_id, source_type_value,
    p_file->>'path', p_file->>'filename', p_file->>'type',
    (p_file->>'size_bytes')::bigint, 'product_inventory_workbook_parser',
    'v1', 'completed',
    jsonb_build_object(
      'headers', COALESCE(p_file->'headers', '[]'::jsonb),
      'contract_version', 'product-inventory-workbook-v1',
      'sha256', p_file->>'sha256'
    ),
    CASE
      WHEN row_count_value = 0 THEN 0
      ELSE round((valid_count_value + warning_count_value)::numeric / row_count_value, 4)
    END,
    p_actor_user_id, p_managed_file_id, p_file->>'sha256', row_count_value,
    valid_count_value, warning_count_value, invalid_count_value,
    duplicate_count_value, unmatched_count_value
  )
  RETURNING * INTO source_row;

  INSERT INTO public.product_inventory_import_rows (
    organization_id, receipt_id, source_id, row_number, raw_data,
    raw_product_name, product_sku, model, product_id, raw_serial,
    normalized_serial, barcode, unit_cost, planned_sale_price,
    currency, condition, row_status, confidence,
    validation_errors, validation_warnings
  )
  SELECT
    p_org_id, p_receipt_id, p_source_id,
    (item.value->>'row_number')::integer,
    COALESCE(item.value->'raw_data', '{}'::jsonb),
    NULLIF(item.value->>'product_name', ''),
    NULLIF(item.value->>'product_sku', ''),
    NULLIF(item.value->>'model', ''),
    NULLIF(item.value->>'product_id', '')::uuid,
    NULLIF(item.value->>'serial_number', ''),
    NULLIF(item.value->>'normalized_serial', ''),
    NULLIF(item.value->>'barcode', ''),
    NULLIF(item.value->>'unit_cost', '')::numeric,
    NULLIF(item.value->>'planned_sale_price', '')::numeric,
    NULLIF(item.value->>'currency', ''),
    NULLIF(item.value->>'condition', ''),
    item.value->>'status',
    NULLIF(item.value->>'confidence', '')::numeric,
    COALESCE(item.value->'validation_errors', '[]'::jsonb),
    COALESCE(item.value->'validation_warnings', '[]'::jsonb)
  FROM jsonb_array_elements(p_rows) item(value);

  event_payload := jsonb_build_object(
    'event_type', 'product_inventory.workbook_previewed',
    'receipt_id', receipt_row.id,
    'receipt_no', receipt_row.receipt_no,
    'source_id', source_row.id,
    'source_type', source_row.source_type,
    'total_rows', source_row.total_rows,
    'valid_rows', source_row.valid_rows,
    'warning_rows', source_row.warning_rows,
    'invalid_rows', source_row.invalid_rows,
    'duplicate_rows', source_row.duplicate_rows,
    'unmatched_rows', source_row.unmatched_rows,
    'version', receipt_row.version
  );
  event_hash := encode(digest(event_payload::text, 'sha256'), 'hex');
  INSERT INTO public.business_events (
    org_id, source_type, business_key, event_version, payload, payload_hash,
    status, request_id, actor_user_id, occurred_at, processed_at
  )
  VALUES (
    p_org_id, 'product_inventory_import',
    source_row.id::text || ':preview', receipt_row.version,
    event_payload, event_hash, 'completed', p_request_id,
    p_actor_user_id, now(), now()
  )
  RETURNING id INTO event_id_value;
  INSERT INTO public.event_outbox (
    org_id, business_event_id, topic, payload, payload_hash
  )
  VALUES (
    p_org_id, event_id_value, 'product_inventory.workbook_previewed',
    event_payload, event_hash
  );

  result_value := jsonb_build_object(
    'receipt', to_jsonb(receipt_row),
    'source', to_jsonb(source_row)
  );
  UPDATE public.product_inventory_import_commands
  SET status = 'completed', result = result_value, completed_at = now()
  WHERE id = command_row.id;
  RETURN result_value;
END;
$$;

CREATE OR REPLACE FUNCTION public.execute_product_workbook_commit(
  p_org_id uuid,
  p_actor_user_id uuid,
  p_request_id uuid,
  p_command_id uuid,
  p_receipt_id uuid,
  p_source_id uuid,
  p_expected_version integer,
  p_rows jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  command_row public.product_inventory_import_commands%ROWTYPE;
  receipt_row public.product_receipts%ROWTYPE;
  source_row public.product_receipt_sources%ROWTYPE;
  actor_role_value text;
  payload_value jsonb;
  hash_value text;
  groups_value jsonb;
  receipt_result jsonb;
  row_count_value integer;
  valid_count_value integer;
  warning_count_value integer;
  event_payload jsonb;
  event_hash text;
  event_id_value uuid;
  result_value jsonb;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501';
  END IF;
  IF p_org_id IS NULL OR p_actor_user_id IS NULL OR p_request_id IS NULL
     OR p_command_id IS NULL OR p_receipt_id IS NULL OR p_source_id IS NULL THEN
    RAISE EXCEPTION 'Workbook commit identifiers are required.'
      USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(COALESCE(p_rows, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'Workbook commit rows must be an array.'
      USING ERRCODE = '22023';
  END IF;

  SELECT member.role::text INTO actor_role_value
  FROM public.org_members member
  JOIN public.organizations organization ON organization.id = member.org_id
  JOIN public.profiles profile
    ON profile.user_id = member.user_id AND profile.org_id = member.org_id
  WHERE member.org_id = p_org_id
    AND member.user_id = p_actor_user_id
    AND member.role::text IN (
      'admin', 'finance_manager'
    )
    AND lower(COALESCE(organization.status, '')) = 'active'
    AND lower(COALESCE(profile.account_status, '')) = 'active'
  LIMIT 1;
  IF actor_role_value IS NULL THEN
    RAISE EXCEPTION 'Product inventory receiving access is required.'
      USING ERRCODE = '42501';
  END IF;

  payload_value := jsonb_build_object(
    'receipt_id', p_receipt_id,
    'source_id', p_source_id,
    'expected_version', p_expected_version,
    'rows', p_rows
  );
  hash_value := encode(digest(payload_value::text, 'sha256'), 'hex');
  INSERT INTO public.product_inventory_import_commands (
    organization_id, idempotency_key, action, receipt_id, source_id,
    payload_hash, actor_user_id, request_id
  )
  VALUES (
    p_org_id, p_command_id, 'workbook_commit', p_receipt_id, p_source_id,
    hash_value, p_actor_user_id, p_request_id
  )
  ON CONFLICT (organization_id, idempotency_key) DO NOTHING;

  SELECT * INTO command_row
  FROM public.product_inventory_import_commands
  WHERE organization_id = p_org_id AND idempotency_key = p_command_id
  FOR UPDATE;
  IF command_row.action <> 'workbook_commit'
     OR command_row.payload_hash <> hash_value
     OR command_row.actor_user_id IS DISTINCT FROM p_actor_user_id THEN
    RAISE EXCEPTION 'Workbook commit idempotency key was reused.'
      USING ERRCODE = '23505';
  END IF;
  IF command_row.status = 'completed' THEN
    RETURN command_row.result;
  END IF;

  SELECT * INTO receipt_row
  FROM public.product_receipts receipt
  WHERE receipt.organization_id = p_org_id AND receipt.id = p_receipt_id
  FOR UPDATE;
  SELECT * INTO source_row
  FROM public.product_receipt_sources source
  WHERE source.organization_id = p_org_id
    AND source.receipt_id = p_receipt_id
    AND source.id = p_source_id
  FOR UPDATE;
  IF receipt_row.id IS NULL OR source_row.id IS NULL THEN
    RAISE EXCEPTION 'Workbook receipt or source was not found.'
      USING ERRCODE = 'P0002';
  END IF;
  IF receipt_row.status NOT IN ('draft', 'needs_review', 'ready_to_confirm')
     OR source_row.committed_at IS NOT NULL THEN
    RAISE EXCEPTION 'Only an uncommitted workbook preview can be committed.'
      USING ERRCODE = '55000';
  END IF;
  IF receipt_row.version <> p_expected_version THEN
    RAISE EXCEPTION 'Receipt version conflict.' USING ERRCODE = '40001';
  END IF;
  IF receipt_row.created_by <> p_actor_user_id
     AND actor_role_value = 'inventory_receiver' THEN
    RAISE EXCEPTION 'Receivers can commit only their own workbook previews.'
      USING ERRCODE = '42501';
  END IF;

  row_count_value := jsonb_array_length(p_rows);
  IF row_count_value <> source_row.total_rows
     OR row_count_value < 1 OR row_count_value > 10000 THEN
    RAISE EXCEPTION 'Every workbook row must be included before commit.'
      USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_rows) item(value)
    WHERE item.value->>'status' NOT IN ('valid', 'warning')
      OR jsonb_typeof(COALESCE(item.value->'validation_errors', '[]'::jsonb)) <> 'array'
      OR jsonb_array_length(COALESCE(item.value->'validation_errors', '[]'::jsonb)) > 0
      OR NULLIF(item.value->>'product_id', '') IS NULL
      OR NULLIF(item.value->>'serial_number', '') IS NULL
      OR COALESCE(NULLIF(item.value->>'unit_cost', '')::numeric, 0) <= 0
      OR COALESCE(NULLIF(item.value->>'planned_sale_price', '')::numeric, 0) <= 0
      OR COALESCE(item.value->>'currency', '') !~ '^[A-Z]{3}$'
      OR COALESCE(item.value->>'condition', '') NOT IN ('new', 'open_box', 'refurbished')
  ) THEN
    RAISE EXCEPTION 'All workbook rows must be valid, matched, uniquely serialized, and priced.'
      USING ERRCODE = '23514';
  END IF;
  SELECT
    count(*) FILTER (WHERE item.value->>'status' = 'valid'),
    count(*) FILTER (WHERE item.value->>'status' = 'warning')
  INTO valid_count_value, warning_count_value
  FROM jsonb_array_elements(p_rows) item(value);
  IF (
    SELECT count(DISTINCT (item.value->>'row_number')::integer)
    FROM jsonb_array_elements(p_rows) item(value)
  ) <> row_count_value OR EXISTS (
    SELECT 1
    FROM public.product_inventory_import_rows stored
    WHERE stored.organization_id = p_org_id
      AND stored.source_id = p_source_id
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_rows) item(value)
        WHERE (item.value->>'row_number')::integer = stored.row_number
      )
  ) THEN
    RAISE EXCEPTION 'Workbook row numbers do not match the stored preview.'
      USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_rows) item(value)
    LEFT JOIN public.sales_products product
      ON product.organization_id = p_org_id
     AND product.company_id = receipt_row.supplier_company_id
     AND product.id = (item.value->>'product_id')::uuid
     AND product.is_active = true
     AND product.inventory_enabled = true
     AND product.tracking_mode = 'serialized'
    WHERE product.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Every workbook product must be active, serialized, and supplied by the selected company.'
      USING ERRCODE = '23514';
  END IF;
  IF (
    SELECT count(DISTINCT public.normalize_product_serial(item.value->>'serial_number'))
    FROM jsonb_array_elements(p_rows) item(value)
  ) <> row_count_value THEN
    RAISE EXCEPTION 'Workbook serial numbers must be unique.'
      USING ERRCODE = '23505';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_rows) item(value)
    JOIN public.product_inventory_units unit
      ON unit.organization_id = p_org_id
     AND unit.normalized_serial_number =
       public.normalize_product_serial(item.value->>'serial_number')
  ) THEN
    RAISE EXCEPTION 'One or more workbook serial numbers already exist in confirmed stock.'
      USING ERRCODE = '23505';
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'product_id', grouped.product_id,
      'unit_cost', grouped.unit_cost,
      'planned_sale_price', grouped.planned_sale_price,
      'currency', grouped.currency,
      'tax_included', true,
      'condition', grouped.condition,
      'serial_numbers', grouped.serial_numbers
    )
    ORDER BY grouped.first_row
  )
  INTO groups_value
  FROM (
    SELECT
      (item.value->>'product_id')::uuid AS product_id,
      (item.value->>'unit_cost')::numeric AS unit_cost,
      (item.value->>'planned_sale_price')::numeric AS planned_sale_price,
      item.value->>'currency' AS currency,
      item.value->>'condition' AS condition,
      min((item.value->>'row_number')::integer) AS first_row,
      jsonb_agg(
        item.value->>'serial_number'
        ORDER BY (item.value->>'row_number')::integer
      ) AS serial_numbers
    FROM jsonb_array_elements(p_rows) item(value)
    GROUP BY
      (item.value->>'product_id')::uuid,
      (item.value->>'unit_cost')::numeric,
      (item.value->>'planned_sale_price')::numeric,
      item.value->>'currency',
      item.value->>'condition'
  ) grouped;

  receipt_result := public.execute_product_receipt_command(
    p_org_id,
    p_actor_user_id,
    p_request_id,
    p_command_id,
    'receipt_draft_save',
    jsonb_build_object(
      'receipt_id', receipt_row.id,
      'expected_version', receipt_row.version,
      'supplier_company_id', receipt_row.supplier_company_id,
      'warehouse_id', receipt_row.warehouse_id,
      'ownership_type', receipt_row.ownership_type,
      'receipt_date', receipt_row.receipt_date,
      'delivery_note_no', receipt_row.delivery_note_no,
      'supplier_invoice_no', receipt_row.supplier_invoice_no,
      'invoice_received', receipt_row.invoice_received,
      'currency', receipt_row.currency,
      'notes', receipt_row.notes,
      'groups', groups_value
    )
  );

  UPDATE public.product_inventory_import_rows stored
  SET raw_product_name = NULLIF(item.value->>'product_name', ''),
      product_sku = NULLIF(item.value->>'product_sku', ''),
      model = NULLIF(item.value->>'model', ''),
      product_id = (item.value->>'product_id')::uuid,
      raw_serial = item.value->>'serial_number',
      normalized_serial = public.normalize_product_serial(item.value->>'serial_number'),
      barcode = NULLIF(item.value->>'barcode', ''),
      unit_cost = (item.value->>'unit_cost')::numeric,
      planned_sale_price = (item.value->>'planned_sale_price')::numeric,
      currency = item.value->>'currency',
      condition = item.value->>'condition',
      row_status = item.value->>'status',
      confidence = COALESCE(NULLIF(item.value->>'confidence', '')::numeric, 1),
      validation_errors = '[]'::jsonb,
      validation_warnings = COALESCE(item.value->'validation_warnings', '[]'::jsonb),
      updated_at = now()
  FROM jsonb_array_elements(p_rows) item(value)
  WHERE stored.organization_id = p_org_id
    AND stored.source_id = p_source_id
    AND stored.row_number = (item.value->>'row_number')::integer;

  UPDATE public.product_receipt_candidates candidate
  SET source_id = p_source_id,
      source_reference = 'row:' || (item.value->>'row_number'),
      raw_product_name = NULLIF(item.value->>'product_name', ''),
      barcode = NULLIF(item.value->>'barcode', ''),
      confidence = COALESCE(NULLIF(item.value->>'confidence', '')::numeric, 1),
      reviewed_by = p_actor_user_id,
      reviewed_at = now(),
      updated_at = now()
  FROM jsonb_array_elements(p_rows) item(value)
  WHERE candidate.organization_id = p_org_id
    AND candidate.receipt_id = p_receipt_id
    AND candidate.normalized_serial =
      public.normalize_product_serial(item.value->>'serial_number');

  UPDATE public.product_receipt_sources
  SET valid_rows = valid_count_value,
      warning_rows = warning_count_value,
      invalid_rows = 0,
      duplicate_rows = 0,
      unmatched_rows = 0,
      committed_at = now(),
      updated_at = now()
  WHERE organization_id = p_org_id AND id = p_source_id
  RETURNING * INTO source_row;

  UPDATE public.product_receipts
  SET source_methods = ARRAY[source_row.source_type]::text[],
      updated_at = now()
  WHERE organization_id = p_org_id AND id = p_receipt_id
  RETURNING * INTO receipt_row;

  event_payload := jsonb_build_object(
    'event_type', 'product_inventory.workbook_committed',
    'receipt_id', receipt_row.id,
    'receipt_no', receipt_row.receipt_no,
    'source_id', source_row.id,
    'source_type', source_row.source_type,
    'total_rows', row_count_value,
    'group_count', jsonb_array_length(groups_value),
    'total_units', receipt_row.total_units,
    'total_cost', receipt_row.physical_total_cost,
    'expected_sales_value', receipt_row.expected_sales_value,
    'version', receipt_row.version
  );
  event_hash := encode(digest(event_payload::text, 'sha256'), 'hex');
  INSERT INTO public.business_events (
    org_id, source_type, business_key, event_version, payload, payload_hash,
    status, request_id, actor_user_id, occurred_at, processed_at
  )
  VALUES (
    p_org_id, 'product_inventory_import',
    source_row.id::text || ':commit', receipt_row.version,
    event_payload, event_hash, 'completed', p_request_id,
    p_actor_user_id, now(), now()
  )
  RETURNING id INTO event_id_value;
  INSERT INTO public.event_outbox (
    org_id, business_event_id, topic, payload, payload_hash
  )
  VALUES (
    p_org_id, event_id_value, 'product_inventory.workbook_committed',
    event_payload, event_hash
  );

  result_value := jsonb_build_object(
    'receipt', to_jsonb(receipt_row),
    'source', to_jsonb(source_row),
    'group_count', jsonb_array_length(groups_value)
  );
  UPDATE public.product_inventory_import_commands
  SET status = 'completed', result = result_value, completed_at = now()
  WHERE id = command_row.id;
  RETURN result_value;
END;
$$;

REVOKE ALL ON FUNCTION public.execute_product_workbook_preview(
  uuid, uuid, uuid, uuid, uuid, uuid, uuid, jsonb, jsonb, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.execute_product_workbook_preview(
  uuid, uuid, uuid, uuid, uuid, uuid, uuid, jsonb, jsonb, jsonb
) TO service_role;

REVOKE ALL ON FUNCTION public.execute_product_workbook_commit(
  uuid, uuid, uuid, uuid, uuid, uuid, integer, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.execute_product_workbook_commit(
  uuid, uuid, uuid, uuid, uuid, uuid, integer, jsonb
) TO service_role;

COMMENT ON TABLE public.product_inventory_import_rows IS
  'Every original Excel/CSV data row, its match, corrections, warnings, and validation evidence.';


CREATE OR REPLACE FUNCTION public.execute_product_photo_preview(
  p_org_id uuid,
  p_actor_user_id uuid,
  p_request_id uuid,
  p_command_id uuid,
  p_receipt_id uuid,
  p_header jsonb,
  p_sources jsonb,
  p_candidates jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  command_row public.product_inventory_photo_commands%ROWTYPE;
  receipt_row public.product_receipts%ROWTYPE;
  warehouse_row public.inventory_warehouses%ROWTYPE;
  actor_role_value text;
  supplier_id_value uuid;
  warehouse_id_value uuid;
  ownership_value text;
  receipt_date_value date;
  currency_value text;
  source_count_value integer;
  candidate_count_value integer;
  payload_value jsonb;
  hash_value text;
  event_payload jsonb;
  event_hash text;
  event_id_value uuid;
  result_value jsonb;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501';
  END IF;
  IF p_org_id IS NULL OR p_actor_user_id IS NULL OR p_request_id IS NULL
     OR p_command_id IS NULL OR p_receipt_id IS NULL THEN
    RAISE EXCEPTION 'Photo preview identifiers are required.'
      USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(COALESCE(p_header, '{}'::jsonb)) <> 'object'
     OR jsonb_typeof(COALESCE(p_sources, '[]'::jsonb)) <> 'array'
     OR jsonb_typeof(COALESCE(p_candidates, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'Photo preview payload is invalid.'
      USING ERRCODE = '22023';
  END IF;

  SELECT member.role::text INTO actor_role_value
  FROM public.org_members member
  JOIN public.organizations organization ON organization.id = member.org_id
  JOIN public.profiles profile
    ON profile.user_id = member.user_id AND profile.org_id = member.org_id
  WHERE member.org_id = p_org_id
    AND member.user_id = p_actor_user_id
    AND member.role::text IN (
      'admin', 'finance_manager'
    )
    AND lower(COALESCE(organization.status, '')) = 'active'
    AND lower(COALESCE(profile.account_status, '')) = 'active'
  LIMIT 1;
  IF actor_role_value IS NULL THEN
    RAISE EXCEPTION 'Product inventory receiving access is required.'
      USING ERRCODE = '42501';
  END IF;

  payload_value := jsonb_build_object(
    'receipt_id', p_receipt_id,
    'header', p_header,
    'sources', p_sources,
    'candidates', p_candidates
  );
  hash_value := encode(digest(payload_value::text, 'sha256'), 'hex');
  INSERT INTO public.product_inventory_photo_commands (
    organization_id, idempotency_key, action, receipt_id,
    payload_hash, actor_user_id, request_id
  )
  VALUES (
    p_org_id, p_command_id, 'photo_preview', p_receipt_id,
    hash_value, p_actor_user_id, p_request_id
  )
  ON CONFLICT (organization_id, idempotency_key) DO NOTHING;

  SELECT * INTO command_row
  FROM public.product_inventory_photo_commands
  WHERE organization_id = p_org_id AND idempotency_key = p_command_id
  FOR UPDATE;
  IF command_row.action <> 'photo_preview'
     OR command_row.payload_hash <> hash_value
     OR command_row.actor_user_id IS DISTINCT FROM p_actor_user_id THEN
    RAISE EXCEPTION 'Photo preview idempotency key was reused.'
      USING ERRCODE = '23505';
  END IF;
  IF command_row.status = 'completed' THEN
    RETURN command_row.result;
  END IF;

  supplier_id_value := NULLIF(p_header->>'supplier_company_id', '')::uuid;
  warehouse_id_value := NULLIF(p_header->>'warehouse_id', '')::uuid;
  ownership_value := lower(btrim(COALESCE(p_header->>'ownership_type', 'purchased')));
  receipt_date_value := COALESCE(NULLIF(p_header->>'receipt_date', '')::date, CURRENT_DATE);
  currency_value := upper(btrim(COALESCE(p_header->>'currency', 'SAR')));
  source_count_value := jsonb_array_length(p_sources);
  candidate_count_value := jsonb_array_length(p_candidates);

  IF supplier_id_value IS NULL OR warehouse_id_value IS NULL
     OR ownership_value NOT IN ('purchased', 'consignment')
     OR currency_value !~ '^[A-Z]{3}$' THEN
    RAISE EXCEPTION 'Photo receipt header is invalid.' USING ERRCODE = '23514';
  END IF;
  IF source_count_value < 1 OR source_count_value > 8
     OR candidate_count_value < 1 OR candidate_count_value > 200 THEN
    RAISE EXCEPTION 'Photo intake supports 1-8 images and 1-200 candidates.'
      USING ERRCODE = '23514';
  END IF;
  IF (
    SELECT count(DISTINCT item.value->>'source_id')
    FROM jsonb_array_elements(p_sources) item(value)
  ) <> source_count_value OR (
    SELECT count(DISTINCT item.value->>'managed_file_id')
    FROM jsonb_array_elements(p_sources) item(value)
  ) <> source_count_value THEN
    RAISE EXCEPTION 'Photo source and file identifiers must be unique.'
      USING ERRCODE = '23505';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_sources) item(value)
    WHERE item.value->'file'->>'bucket' <> 'product-inventory-photos'
      OR item.value->'file'->>'scan_status' <> 'clean'
      OR item.value->'file'->>'type' NOT IN ('image/jpeg', 'image/png', 'image/webp')
      OR length(COALESCE(item.value->'file'->>'sha256', '')) <> 64
      OR COALESCE((item.value->'file'->>'size_bytes')::bigint, 0) <= 0
      OR COALESCE((item.value->'file'->>'size_bytes')::bigint, 0) > 10485760
      OR item.value->'file'->>'path' NOT LIKE
        p_org_id::text || '/' || p_receipt_id::text || '/' || p_command_id::text || '/%'
      OR item.value->'extraction'->>'engine' <> 'tesseract-zxing-local'
      OR item.value->'extraction'->>'version' <> 'local-product-label-v1'
      OR jsonb_typeof(COALESCE(item.value->'extraction'->'barcode_values', '[]'::jsonb)) <> 'array'
      OR jsonb_typeof(COALESCE(item.value->'extraction'->'bounding_boxes', '[]'::jsonb)) <> 'array'
  ) THEN
    RAISE EXCEPTION 'Every photo must be clean, private, and locally extracted.'
      USING ERRCODE = '23514';
  END IF;
  IF (
    SELECT COALESCE(sum((item.value->'file'->>'size_bytes')::bigint), 0)
    FROM jsonb_array_elements(p_sources) item(value)
  ) > 41943040 THEN
    RAISE EXCEPTION 'The combined photo upload exceeds 40 MB.'
      USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_candidates) item(value)
    WHERE NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_sources) source(value)
      WHERE source.value->>'source_id' = item.value->>'source_id'
    )
      OR COALESCE((item.value->>'candidate_index')::integer, 0) <= 0
      OR item.value->>'status' NOT IN ('valid', 'warning', 'invalid', 'duplicate', 'unmatched')
      OR jsonb_typeof(COALESCE(item.value->'validation_errors', '[]'::jsonb)) <> 'array'
      OR jsonb_typeof(COALESCE(item.value->'validation_warnings', '[]'::jsonb)) <> 'array'
  ) THEN
    RAISE EXCEPTION 'Photo candidates do not match their source images.'
      USING ERRCODE = '23514';
  END IF;
  IF (
    SELECT count(DISTINCT (item.value->>'source_id') || ':' || (item.value->>'candidate_index'))
    FROM jsonb_array_elements(p_candidates) item(value)
  ) <> candidate_count_value THEN
    RAISE EXCEPTION 'Photo candidate indexes must be unique per source.'
      USING ERRCODE = '23505';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.product_receipts
    WHERE organization_id = p_org_id AND id = p_receipt_id
  ) THEN
    RAISE EXCEPTION 'Photo receipt already exists.' USING ERRCODE = '23505';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.sales_companies company
    WHERE company.organization_id = p_org_id
      AND company.id = supplier_id_value
      AND company.is_active = true
  ) THEN
    RAISE EXCEPTION 'Supplier company was not found or is inactive.'
      USING ERRCODE = 'P0002';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_candidates) item(value)
    LEFT JOIN public.sales_products product
      ON product.organization_id = p_org_id
     AND product.company_id = supplier_id_value
     AND product.id = NULLIF(item.value->>'product_id', '')::uuid
     AND product.is_active = true
     AND product.inventory_enabled = true
     AND product.tracking_mode = 'serialized'
    WHERE NULLIF(item.value->>'product_id', '') IS NOT NULL
      AND product.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Photo preview contains a product outside the selected supplier catalog.'
      USING ERRCODE = '23514';
  END IF;

  SELECT * INTO warehouse_row
  FROM public.inventory_warehouses warehouse
  WHERE warehouse.organization_id = p_org_id
    AND warehouse.id = warehouse_id_value
    AND warehouse.is_active = true
  FOR SHARE;
  IF warehouse_row.id IS NULL THEN
    RAISE EXCEPTION 'Warehouse was not found or is inactive.'
      USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.product_receipts (
    id, organization_id, receipt_no, supplier_company_id,
    legal_entity_id, branch_id, warehouse_id, ownership_type,
    receipt_date, delivery_note_no, supplier_invoice_no,
    invoice_received, currency, notes, source_methods, status,
    accounting_status, created_by
  )
  VALUES (
    p_receipt_id, p_org_id,
    public.next_product_receipt_number(p_org_id, receipt_date_value),
    supplier_id_value, warehouse_row.legal_entity_id, warehouse_row.branch_id,
    warehouse_id_value, ownership_value, receipt_date_value,
    NULLIF(btrim(p_header->>'delivery_note_no'), ''),
    NULLIF(btrim(p_header->>'supplier_invoice_no'), ''),
    COALESCE((p_header->>'invoice_received')::boolean, false),
    currency_value, NULLIF(btrim(p_header->>'notes'), ''),
    ARRAY['photo']::text[], 'needs_review',
    CASE WHEN ownership_value = 'consignment' THEN 'not_required' ELSE 'pending' END,
    p_actor_user_id
  )
  RETURNING * INTO receipt_row;

  INSERT INTO public.managed_files (
    id, org_id, bucket_id, storage_path, owner_type, owner_id,
    original_name, detected_mime, size_bytes, sha256,
    scan_status, scan_engine, scanned_at, retention_until, uploaded_by
  )
  SELECT
    (item.value->>'managed_file_id')::uuid, p_org_id,
    item.value->'file'->>'bucket', item.value->'file'->>'path',
    'product_inventory_photo', (item.value->>'source_id')::uuid,
    item.value->'file'->>'filename', item.value->'file'->>'type',
    (item.value->'file'->>'size_bytes')::bigint,
    item.value->'file'->>'sha256', item.value->'file'->>'scan_status',
    item.value->'file'->>'scan_engine',
    (item.value->'file'->>'scanned_at')::timestamptz,
    CURRENT_DATE + 365, p_actor_user_id
  FROM jsonb_array_elements(p_sources) item(value);

  INSERT INTO public.product_receipt_sources (
    id, organization_id, receipt_id, source_type, storage_path,
    original_name, mime_type, size_bytes, extraction_provider,
    extraction_version, extraction_status, raw_extraction, confidence,
    uploaded_by, managed_file_id, file_sha256, total_rows,
    valid_rows, warning_rows, invalid_rows, duplicate_rows, unmatched_rows
  )
  SELECT
    (source.value->>'source_id')::uuid, p_org_id, p_receipt_id, 'photo',
    source.value->'file'->>'path', source.value->'file'->>'filename',
    source.value->'file'->>'type',
    (source.value->'file'->>'size_bytes')::bigint,
    source.value->'extraction'->>'engine',
    source.value->'extraction'->>'version', 'completed',
    source.value->'extraction',
    CASE
      WHEN NULLIF(source.value->'extraction'->>'ocr_confidence', '') IS NULL THEN NULL
      ELSE round((source.value->'extraction'->>'ocr_confidence')::numeric / 100, 4)
    END,
    p_actor_user_id, (source.value->>'managed_file_id')::uuid,
    source.value->'file'->>'sha256',
    (SELECT count(*) FROM jsonb_array_elements(p_candidates) candidate(value)
      WHERE candidate.value->>'source_id' = source.value->>'source_id'),
    (SELECT count(*) FROM jsonb_array_elements(p_candidates) candidate(value)
      WHERE candidate.value->>'source_id' = source.value->>'source_id'
        AND candidate.value->>'status' = 'valid'),
    (SELECT count(*) FROM jsonb_array_elements(p_candidates) candidate(value)
      WHERE candidate.value->>'source_id' = source.value->>'source_id'
        AND candidate.value->>'status' = 'warning'),
    (SELECT count(*) FROM jsonb_array_elements(p_candidates) candidate(value)
      WHERE candidate.value->>'source_id' = source.value->>'source_id'
        AND candidate.value->>'status' = 'invalid'),
    (SELECT count(*) FROM jsonb_array_elements(p_candidates) candidate(value)
      WHERE candidate.value->>'source_id' = source.value->>'source_id'
        AND candidate.value->>'status' = 'duplicate'),
    (SELECT count(*) FROM jsonb_array_elements(p_candidates) candidate(value)
      WHERE candidate.value->>'source_id' = source.value->>'source_id'
        AND candidate.value->>'status' = 'unmatched')
  FROM jsonb_array_elements(p_sources) source(value);

  INSERT INTO public.product_inventory_photo_candidates (
    organization_id, receipt_id, source_id, candidate_index,
    raw_product_name, raw_sku, raw_model, raw_serial, raw_barcode,
    suggested_product_id, final_product_id, final_serial, normalized_serial,
    unit_cost, planned_sale_price, currency, condition, row_status,
    confidence, match_method, validation_errors, validation_warnings
  )
  SELECT
    p_org_id, p_receipt_id, (item.value->>'source_id')::uuid,
    (item.value->>'candidate_index')::integer,
    NULLIF(item.value->>'raw_product_name', ''),
    NULLIF(item.value->>'raw_sku', ''),
    NULLIF(item.value->>'raw_model', ''),
    NULLIF(item.value->>'raw_serial', ''),
    NULLIF(item.value->>'raw_barcode', ''),
    NULLIF(item.value->>'product_id', '')::uuid,
    NULLIF(item.value->>'product_id', '')::uuid,
    NULLIF(item.value->>'serial_number', ''),
    NULLIF(item.value->>'normalized_serial', ''),
    NULLIF(item.value->>'unit_cost', '')::numeric,
    NULLIF(item.value->>'planned_sale_price', '')::numeric,
    NULLIF(item.value->>'currency', ''),
    NULLIF(item.value->>'condition', ''),
    item.value->>'status',
    COALESCE(NULLIF(item.value->>'confidence', '')::numeric, 0),
    COALESCE(NULLIF(item.value->>'match_method', ''), 'none'),
    COALESCE(item.value->'validation_errors', '[]'::jsonb),
    COALESCE(item.value->'validation_warnings', '[]'::jsonb)
  FROM jsonb_array_elements(p_candidates) item(value);

  event_payload := jsonb_build_object(
    'event_type', 'product_inventory.photo_previewed',
    'receipt_id', receipt_row.id,
    'receipt_no', receipt_row.receipt_no,
    'source_count', source_count_value,
    'candidate_count', candidate_count_value,
    'version', receipt_row.version
  );
  event_hash := encode(digest(event_payload::text, 'sha256'), 'hex');
  INSERT INTO public.business_events (
    org_id, source_type, business_key, event_version, payload, payload_hash,
    status, request_id, actor_user_id, occurred_at, processed_at
  )
  VALUES (
    p_org_id, 'product_inventory_photo',
    receipt_row.id::text || ':preview', receipt_row.version,
    event_payload, event_hash, 'completed', p_request_id,
    p_actor_user_id, now(), now()
  )
  RETURNING id INTO event_id_value;
  INSERT INTO public.event_outbox (
    org_id, business_event_id, topic, payload, payload_hash
  )
  VALUES (
    p_org_id, event_id_value, 'product_inventory.photo_previewed',
    event_payload, event_hash
  );

  result_value := jsonb_build_object(
    'receipt', to_jsonb(receipt_row),
    'sources', (
      SELECT COALESCE(jsonb_agg(to_jsonb(source) ORDER BY source.created_at), '[]'::jsonb)
      FROM public.product_receipt_sources source
      WHERE source.organization_id = p_org_id AND source.receipt_id = p_receipt_id
    )
  );
  UPDATE public.product_inventory_photo_commands
  SET status = 'completed', result = result_value, completed_at = now()
  WHERE id = command_row.id;
  RETURN result_value;
END;
$$;

CREATE OR REPLACE FUNCTION public.execute_product_photo_commit(
  p_org_id uuid,
  p_actor_user_id uuid,
  p_request_id uuid,
  p_command_id uuid,
  p_receipt_id uuid,
  p_expected_version integer,
  p_warnings_accepted boolean,
  p_candidates jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  command_row public.product_inventory_photo_commands%ROWTYPE;
  receipt_row public.product_receipts%ROWTYPE;
  actor_role_value text;
  candidate_count_value integer;
  group_count_value integer;
  payload_value jsonb;
  hash_value text;
  groups_value jsonb;
  receipt_result jsonb;
  event_payload jsonb;
  event_hash text;
  event_id_value uuid;
  result_value jsonb;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501';
  END IF;
  IF p_org_id IS NULL OR p_actor_user_id IS NULL OR p_request_id IS NULL
     OR p_command_id IS NULL OR p_receipt_id IS NULL THEN
    RAISE EXCEPTION 'Photo commit identifiers are required.'
      USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(COALESCE(p_candidates, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'Photo candidates must be an array.'
      USING ERRCODE = '22023';
  END IF;

  SELECT member.role::text INTO actor_role_value
  FROM public.org_members member
  JOIN public.organizations organization ON organization.id = member.org_id
  JOIN public.profiles profile
    ON profile.user_id = member.user_id AND profile.org_id = member.org_id
  WHERE member.org_id = p_org_id
    AND member.user_id = p_actor_user_id
    AND member.role::text IN (
      'admin', 'finance_manager'
    )
    AND lower(COALESCE(organization.status, '')) = 'active'
    AND lower(COALESCE(profile.account_status, '')) = 'active'
  LIMIT 1;
  IF actor_role_value IS NULL THEN
    RAISE EXCEPTION 'Product inventory receiving access is required.'
      USING ERRCODE = '42501';
  END IF;

  payload_value := jsonb_build_object(
    'receipt_id', p_receipt_id,
    'expected_version', p_expected_version,
    'warnings_accepted', COALESCE(p_warnings_accepted, false),
    'candidates', p_candidates
  );
  hash_value := encode(digest(payload_value::text, 'sha256'), 'hex');
  INSERT INTO public.product_inventory_photo_commands (
    organization_id, idempotency_key, action, receipt_id,
    payload_hash, actor_user_id, request_id
  )
  VALUES (
    p_org_id, p_command_id, 'photo_commit', p_receipt_id,
    hash_value, p_actor_user_id, p_request_id
  )
  ON CONFLICT (organization_id, idempotency_key) DO NOTHING;

  SELECT * INTO command_row
  FROM public.product_inventory_photo_commands
  WHERE organization_id = p_org_id AND idempotency_key = p_command_id
  FOR UPDATE;
  IF command_row.action <> 'photo_commit'
     OR command_row.payload_hash <> hash_value
     OR command_row.actor_user_id IS DISTINCT FROM p_actor_user_id THEN
    RAISE EXCEPTION 'Photo commit idempotency key was reused.'
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
    RAISE EXCEPTION 'Photo receipt was not found.' USING ERRCODE = 'P0002';
  END IF;
  IF receipt_row.status NOT IN ('draft', 'needs_review', 'ready_to_confirm') THEN
    RAISE EXCEPTION 'Only an editable photo receipt can be committed.'
      USING ERRCODE = '55000';
  END IF;
  IF receipt_row.version <> p_expected_version THEN
    RAISE EXCEPTION 'Receipt version conflict.' USING ERRCODE = '40001';
  END IF;
  IF receipt_row.created_by <> p_actor_user_id
     AND actor_role_value = 'inventory_receiver' THEN
    RAISE EXCEPTION 'Receivers can commit only their own photo receipts.'
      USING ERRCODE = '42501';
  END IF;

  candidate_count_value := jsonb_array_length(p_candidates);
  IF candidate_count_value < 1 OR candidate_count_value > 200
     OR candidate_count_value <> (
       SELECT count(*) FROM public.product_inventory_photo_candidates stored
       WHERE stored.organization_id = p_org_id AND stored.receipt_id = p_receipt_id
     ) THEN
    RAISE EXCEPTION 'Every extracted photo candidate must be included before commit.'
      USING ERRCODE = '23514';
  END IF;
  IF (
    SELECT count(DISTINCT (item.value->>'source_id') || ':' || (item.value->>'candidate_index'))
    FROM jsonb_array_elements(p_candidates) item(value)
  ) <> candidate_count_value OR EXISTS (
    SELECT 1
    FROM public.product_inventory_photo_candidates stored
    WHERE stored.organization_id = p_org_id
      AND stored.receipt_id = p_receipt_id
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_candidates) item(value)
        WHERE (item.value->>'source_id')::uuid = stored.source_id
          AND (item.value->>'candidate_index')::integer = stored.candidate_index
      )
  ) THEN
    RAISE EXCEPTION 'Photo candidate identifiers do not match the stored preview.'
      USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_candidates) item(value)
    WHERE item.value->>'status' NOT IN ('valid', 'warning')
      OR jsonb_array_length(COALESCE(item.value->'validation_errors', '[]'::jsonb)) > 0
      OR NULLIF(item.value->>'product_id', '') IS NULL
      OR NULLIF(item.value->>'serial_number', '') IS NULL
      OR COALESCE(NULLIF(item.value->>'unit_cost', '')::numeric, 0) <= 0
      OR COALESCE(NULLIF(item.value->>'planned_sale_price', '')::numeric, 0) <= 0
      OR COALESCE(item.value->>'currency', '') !~ '^[A-Z]{3}$'
      OR COALESCE(item.value->>'condition', '') NOT IN ('new', 'open_box', 'refurbished')
  ) THEN
    RAISE EXCEPTION 'All photo candidates must be matched, uniquely serialized, and priced.'
      USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_candidates) item(value)
    WHERE item.value->>'status' = 'warning'
  ) AND NOT COALESCE(p_warnings_accepted, false) THEN
    RAISE EXCEPTION 'Photo extraction warnings require explicit receiver acceptance.'
      USING ERRCODE = '23514';
  END IF;
  IF actor_role_value = 'inventory_receiver' AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_candidates) item(value)
    WHERE COALESCE((item.value->>'save_as_alias')::boolean, false)
  ) THEN
    RAISE EXCEPTION 'Only inventory managers can approve product aliases.'
      USING ERRCODE = '42501';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_candidates) item(value)
    LEFT JOIN public.product_receipt_sources source
      ON source.organization_id = p_org_id
     AND source.receipt_id = p_receipt_id
     AND source.source_type = 'photo'
     AND source.id = (item.value->>'source_id')::uuid
    LEFT JOIN public.sales_products product
      ON product.organization_id = p_org_id
     AND product.company_id = receipt_row.supplier_company_id
     AND product.id = (item.value->>'product_id')::uuid
     AND product.is_active = true
     AND product.inventory_enabled = true
     AND product.tracking_mode = 'serialized'
    WHERE source.id IS NULL OR product.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Every photo candidate must use its own source and an active supplier product.'
      USING ERRCODE = '23514';
  END IF;
  IF (
    SELECT count(DISTINCT public.normalize_product_serial(item.value->>'serial_number'))
    FROM jsonb_array_elements(p_candidates) item(value)
  ) <> candidate_count_value THEN
    RAISE EXCEPTION 'Photo candidate serial numbers must be unique.'
      USING ERRCODE = '23505';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_candidates) item(value)
    JOIN public.product_inventory_units unit
      ON unit.organization_id = p_org_id
     AND unit.normalized_serial_number =
       public.normalize_product_serial(item.value->>'serial_number')
  ) THEN
    RAISE EXCEPTION 'One or more photo serial numbers already exist in confirmed stock.'
      USING ERRCODE = '23505';
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'product_id', grouped.product_id,
      'unit_cost', grouped.unit_cost,
      'planned_sale_price', grouped.planned_sale_price,
      'currency', grouped.currency,
      'tax_included', true,
      'condition', grouped.condition,
      'serial_numbers', grouped.serial_numbers
    )
    ORDER BY grouped.first_candidate
  ), count(*)
  INTO groups_value, group_count_value
  FROM (
    SELECT
      (item.value->>'product_id')::uuid AS product_id,
      (item.value->>'unit_cost')::numeric AS unit_cost,
      (item.value->>'planned_sale_price')::numeric AS planned_sale_price,
      item.value->>'currency' AS currency,
      item.value->>'condition' AS condition,
      min((item.value->>'candidate_index')::integer) AS first_candidate,
      jsonb_agg(
        item.value->>'serial_number'
        ORDER BY (item.value->>'source_id'), (item.value->>'candidate_index')::integer
      ) AS serial_numbers
    FROM jsonb_array_elements(p_candidates) item(value)
    GROUP BY
      (item.value->>'product_id')::uuid,
      (item.value->>'unit_cost')::numeric,
      (item.value->>'planned_sale_price')::numeric,
      item.value->>'currency',
      item.value->>'condition'
  ) grouped;
  IF group_count_value > 100 THEN
    RAISE EXCEPTION 'Photo candidates produce more than 100 price groups.'
      USING ERRCODE = '23514';
  END IF;

  receipt_result := public.execute_product_receipt_command(
    p_org_id,
    p_actor_user_id,
    p_request_id,
    p_command_id,
    'receipt_draft_save',
    jsonb_build_object(
      'receipt_id', receipt_row.id,
      'expected_version', receipt_row.version,
      'supplier_company_id', receipt_row.supplier_company_id,
      'warehouse_id', receipt_row.warehouse_id,
      'ownership_type', receipt_row.ownership_type,
      'receipt_date', receipt_row.receipt_date,
      'delivery_note_no', receipt_row.delivery_note_no,
      'supplier_invoice_no', receipt_row.supplier_invoice_no,
      'invoice_received', receipt_row.invoice_received,
      'currency', receipt_row.currency,
      'notes', receipt_row.notes,
      'groups', groups_value
    )
  );

  UPDATE public.product_inventory_photo_candidates stored
  SET final_product_id = (item.value->>'product_id')::uuid,
      final_serial = item.value->>'serial_number',
      normalized_serial = public.normalize_product_serial(item.value->>'serial_number'),
      unit_cost = (item.value->>'unit_cost')::numeric,
      planned_sale_price = (item.value->>'planned_sale_price')::numeric,
      currency = item.value->>'currency',
      condition = item.value->>'condition',
      row_status = item.value->>'status',
      confidence = COALESCE(NULLIF(item.value->>'confidence', '')::numeric, stored.confidence),
      match_method = COALESCE(NULLIF(item.value->>'match_method', ''), stored.match_method),
      validation_errors = '[]'::jsonb,
      validation_warnings = COALESCE(item.value->'validation_warnings', '[]'::jsonb),
      save_as_alias = COALESCE((item.value->>'save_as_alias')::boolean, false),
      warning_accepted = item.value->>'status' = 'warning' AND COALESCE(p_warnings_accepted, false),
      product_corrected = stored.suggested_product_id IS DISTINCT FROM (item.value->>'product_id')::uuid,
      serial_corrected = public.normalize_product_serial(stored.raw_serial)
        IS DISTINCT FROM public.normalize_product_serial(item.value->>'serial_number'),
      reviewed_by = p_actor_user_id,
      reviewed_at = now(),
      updated_at = now()
  FROM jsonb_array_elements(p_candidates) item(value)
  WHERE stored.organization_id = p_org_id
    AND stored.receipt_id = p_receipt_id
    AND stored.source_id = (item.value->>'source_id')::uuid
    AND stored.candidate_index = (item.value->>'candidate_index')::integer;

  UPDATE public.product_receipt_candidates candidate
  SET source_id = (item.value->>'source_id')::uuid,
      source_reference = 'photo:' || (item.value->>'candidate_index'),
      raw_product_name = NULLIF(item.value->>'raw_product_name', ''),
      barcode = NULLIF(item.value->>'raw_barcode', ''),
      confidence = COALESCE(NULLIF(item.value->>'confidence', '')::numeric, 1),
      reviewed_by = p_actor_user_id,
      reviewed_at = now(),
      updated_at = now()
  FROM jsonb_array_elements(p_candidates) item(value)
  WHERE candidate.organization_id = p_org_id
    AND candidate.receipt_id = p_receipt_id
    AND candidate.normalized_serial =
      public.normalize_product_serial(item.value->>'serial_number');

  IF actor_role_value IN ('admin', 'finance_manager') THEN
    INSERT INTO public.product_inventory_aliases (
      organization_id, product_id, alias_type, alias_value, normalized_value,
      source, is_approved, approved_by, approved_at, created_by
    )
    SELECT
      p_org_id, (item.value->>'product_id')::uuid, 'name',
      btrim(item.value->>'raw_product_name'),
      public.normalize_product_alias(item.value->>'raw_product_name'),
      'photo_correction', true, p_actor_user_id, now(), p_actor_user_id
    FROM jsonb_array_elements(p_candidates) item(value)
    WHERE COALESCE((item.value->>'save_as_alias')::boolean, false)
      AND length(public.normalize_product_alias(item.value->>'raw_product_name')) >= 2
    ON CONFLICT (organization_id, alias_type, normalized_value) DO NOTHING;
  END IF;

  UPDATE public.product_receipt_sources source
  SET valid_rows = counts.valid_rows,
      warning_rows = counts.warning_rows,
      invalid_rows = 0,
      duplicate_rows = 0,
      unmatched_rows = 0,
      committed_at = now(),
      updated_at = now()
  FROM (
    SELECT
      (item.value->>'source_id')::uuid AS source_id,
      count(*) FILTER (WHERE item.value->>'status' = 'valid') AS valid_rows,
      count(*) FILTER (WHERE item.value->>'status' = 'warning') AS warning_rows
    FROM jsonb_array_elements(p_candidates) item(value)
    GROUP BY (item.value->>'source_id')::uuid
  ) counts
  WHERE source.organization_id = p_org_id
    AND source.receipt_id = p_receipt_id
    AND source.id = counts.source_id;

  UPDATE public.product_receipts
  SET source_methods = ARRAY['photo']::text[],
      updated_at = now()
  WHERE organization_id = p_org_id AND id = p_receipt_id
  RETURNING * INTO receipt_row;

  event_payload := jsonb_build_object(
    'event_type', 'product_inventory.photo_committed',
    'receipt_id', receipt_row.id,
    'receipt_no', receipt_row.receipt_no,
    'candidate_count', candidate_count_value,
    'group_count', group_count_value,
    'warning_count', (
      SELECT count(*) FROM jsonb_array_elements(p_candidates) item(value)
      WHERE item.value->>'status' = 'warning'
    ),
    'product_corrections', (
      SELECT count(*) FROM public.product_inventory_photo_candidates candidate
      WHERE candidate.organization_id = p_org_id
        AND candidate.receipt_id = p_receipt_id
        AND candidate.product_corrected
    ),
    'serial_corrections', (
      SELECT count(*) FROM public.product_inventory_photo_candidates candidate
      WHERE candidate.organization_id = p_org_id
        AND candidate.receipt_id = p_receipt_id
        AND candidate.serial_corrected
    ),
    'total_units', receipt_row.total_units,
    'total_cost', receipt_row.physical_total_cost,
    'expected_sales_value', receipt_row.expected_sales_value,
    'version', receipt_row.version
  );
  event_hash := encode(digest(event_payload::text, 'sha256'), 'hex');
  INSERT INTO public.business_events (
    org_id, source_type, business_key, event_version, payload, payload_hash,
    status, request_id, actor_user_id, occurred_at, processed_at
  )
  VALUES (
    p_org_id, 'product_inventory_photo',
    receipt_row.id::text || ':commit', receipt_row.version,
    event_payload, event_hash, 'completed', p_request_id,
    p_actor_user_id, now(), now()
  )
  RETURNING id INTO event_id_value;
  INSERT INTO public.event_outbox (
    org_id, business_event_id, topic, payload, payload_hash
  )
  VALUES (
    p_org_id, event_id_value, 'product_inventory.photo_committed',
    event_payload, event_hash
  );

  result_value := jsonb_build_object(
    'receipt', to_jsonb(receipt_row),
    'group_count', group_count_value,
    'candidate_count', candidate_count_value
  );
  UPDATE public.product_inventory_photo_commands
  SET status = 'completed', result = result_value, completed_at = now()
  WHERE id = command_row.id;
  RETURN result_value;
END;
$$;

REVOKE ALL ON FUNCTION public.execute_product_photo_preview(
  uuid, uuid, uuid, uuid, uuid, jsonb, jsonb, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.execute_product_photo_preview(
  uuid, uuid, uuid, uuid, uuid, jsonb, jsonb, jsonb
) TO service_role;

REVOKE ALL ON FUNCTION public.execute_product_photo_commit(
  uuid, uuid, uuid, uuid, uuid, integer, boolean, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.execute_product_photo_commit(
  uuid, uuid, uuid, uuid, uuid, integer, boolean, jsonb
) TO service_role;

COMMENT ON TABLE public.product_inventory_photo_candidates IS
  'Locally extracted product/serial candidates with source image, confidence, corrections, and alias review evidence.';


CREATE OR REPLACE FUNCTION public.execute_product_commerce_command(
  p_org_id uuid,
  p_actor_user_id uuid,
  p_request_id uuid,
  p_command_id uuid,
  p_action text,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  command_row public.product_inventory_commands%ROWTYPE;
  actor_role_value text;
  actor_agent_id uuid;
  custody_agent_id uuid;
  payload_hash_value text;
  entity_id_value uuid;
  expected_version_value integer;
  topic_value text;
  event_payload jsonb;
  event_hash_value text;
  event_id_value uuid;
  result_value jsonb;
  handover_row public.product_handovers%ROWTYPE;
  sale_row public.agent_product_sales%ROWTYPE;
  unit_row public.product_inventory_units%ROWTYPE;
  override_row public.product_price_override_requests%ROWTYPE;
  agent_row public.field_agents%ROWTYPE;
  warehouse_row public.inventory_warehouses%ROWTYPE;
  settings_row public.product_inventory_commerce_settings%ROWTYPE;
  units_value jsonb;
  unit_count_value integer;
  affected_count_value integer;
  outstanding_value numeric(14,2);
  price_value numeric(14,2);
  minimum_price_value numeric(14,2);
  maximum_price_value numeric(14,2);
  vat_rate_value numeric(5,2);
  tax_included_value boolean;
  net_value numeric(14,2);
  vat_value numeric(14,2);
  total_value numeric(14,2);
  commission_value numeric(14,2);
  disposition_value text;
  decision_value text;
  date_value date;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501';
  END IF;
  IF p_org_id IS NULL OR p_actor_user_id IS NULL OR p_request_id IS NULL
     OR p_command_id IS NULL OR p_action IS NULL
     OR jsonb_typeof(COALESCE(p_payload, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'Product commerce command input is invalid.'
      USING ERRCODE = '22023';
  END IF;
  IF p_action NOT IN (
    'handover_issue', 'handover_accept', 'agent_return',
    'price_override_request', 'price_override_review',
    'sale', 'sale_void', 'collection_post'
  ) THEN
    RAISE EXCEPTION 'Unsupported product commerce action.'
      USING ERRCODE = '22023';
  END IF;

  SELECT member.role::text, agent.id
  INTO actor_role_value, actor_agent_id
  FROM public.org_members member
  JOIN public.organizations organization ON organization.id = member.org_id
  JOIN public.profiles profile
    ON profile.user_id = member.user_id AND profile.org_id = member.org_id
  LEFT JOIN public.field_agents agent
    ON agent.organization_id = member.org_id
   AND agent.user_id = member.user_id
   AND agent.status = 'active'
  WHERE member.org_id = p_org_id
    AND member.user_id = p_actor_user_id
    AND member.role::text IN (
      'admin', 'finance_manager', 'field_agent'
    )
    AND lower(COALESCE(organization.status, '')) = 'active'
    AND lower(COALESCE(profile.account_status, '')) = 'active'
  LIMIT 1;
  IF actor_role_value IS NULL
     OR (actor_role_value = 'field_agent' AND actor_agent_id IS NULL) THEN
    RAISE EXCEPTION 'Product commerce access is required.'
      USING ERRCODE = '42501';
  END IF;

  payload_hash_value := encode(
    digest(jsonb_build_object('action', p_action, 'payload', p_payload)::text, 'sha256'),
    'hex'
  );
  INSERT INTO public.product_inventory_commands (
    organization_id, idempotency_key, action, entity_id,
    payload_hash, actor_user_id, request_id
  )
  VALUES (
    p_org_id, p_command_id, p_action,
    NULLIF(p_payload->>'entity_id', '')::uuid,
    payload_hash_value, p_actor_user_id, p_request_id
  )
  ON CONFLICT (organization_id, idempotency_key) DO NOTHING;

  SELECT * INTO command_row
  FROM public.product_inventory_commands
  WHERE organization_id = p_org_id AND idempotency_key = p_command_id
  FOR UPDATE;
  IF command_row.action <> p_action
     OR command_row.payload_hash <> payload_hash_value
     OR command_row.actor_user_id IS DISTINCT FROM p_actor_user_id THEN
    RAISE EXCEPTION 'Product commerce idempotency key was reused.'
      USING ERRCODE = '23505';
  END IF;
  IF command_row.status = 'completed' THEN
    RETURN command_row.result;
  END IF;

  SELECT * INTO settings_row
  FROM public.product_inventory_commerce_settings
  WHERE organization_id = p_org_id;
  IF settings_row.organization_id IS NULL THEN
    INSERT INTO public.product_inventory_commerce_settings (organization_id)
    VALUES (p_org_id)
    RETURNING * INTO settings_row;
  END IF;

  PERFORM set_config('app.product_commerce_command', 'trusted', true);

  IF p_action = 'handover_issue' THEN
    IF actor_role_value NOT IN ('admin', 'finance_manager') THEN
      RAISE EXCEPTION 'Only an inventory manager can issue product custody.'
        USING ERRCODE = '42501';
    END IF;
    entity_id_value := NULLIF(p_payload->>'handover_id', '')::uuid;
    IF entity_id_value IS NULL THEN
      RAISE EXCEPTION 'Handover id is required.' USING ERRCODE = '23514';
    END IF;
    units_value := COALESCE(p_payload->'units', '[]'::jsonb);
    IF jsonb_typeof(units_value) <> 'array' THEN
      RAISE EXCEPTION 'Handover units must be an array.' USING ERRCODE = '23514';
    END IF;
    unit_count_value := jsonb_array_length(units_value);
    IF unit_count_value < 1 OR unit_count_value > settings_row.max_handover_units THEN
      RAISE EXCEPTION 'Handover unit count is outside the configured limit.'
        USING ERRCODE = '23514';
    END IF;
    IF (
      SELECT count(DISTINCT item.value->>'unit_id')
      FROM jsonb_array_elements(units_value) item(value)
    ) <> unit_count_value THEN
      RAISE EXCEPTION 'Handover unit ids must be unique.' USING ERRCODE = '23505';
    END IF;

    SELECT * INTO agent_row
    FROM public.field_agents agent
    WHERE agent.organization_id = p_org_id
      AND agent.id = NULLIF(p_payload->>'agent_id', '')::uuid
      AND agent.status = 'active'
    FOR UPDATE;
    IF agent_row.id IS NULL THEN
      RAISE EXCEPTION 'Active field agent was not found.' USING ERRCODE = 'P0002';
    END IF;
    SELECT * INTO warehouse_row
    FROM public.inventory_warehouses warehouse
    WHERE warehouse.organization_id = p_org_id
      AND warehouse.id = NULLIF(p_payload->>'warehouse_id', '')::uuid
      AND warehouse.is_active
    FOR SHARE;
    IF warehouse_row.id IS NULL THEN
      RAISE EXCEPTION 'Active warehouse was not found.' USING ERRCODE = 'P0002';
    END IF;

    PERFORM unit.id
    FROM public.product_inventory_units unit
    JOIN jsonb_array_elements(units_value) item(value)
      ON unit.id = (item.value->>'unit_id')::uuid
    WHERE unit.organization_id = p_org_id
    ORDER BY unit.id
    FOR UPDATE OF unit;
    IF (
      SELECT count(*)
      FROM public.product_inventory_units unit
      JOIN jsonb_array_elements(units_value) item(value)
        ON unit.id = (item.value->>'unit_id')::uuid
      WHERE unit.organization_id = p_org_id
        AND unit.status = 'in_stock'
        AND unit.warehouse_id = warehouse_row.id
        AND unit.current_agent_id IS NULL
        AND unit.current_handover_id IS NULL
        AND unit.current_sale_id IS NULL
    ) <> unit_count_value THEN
      RAISE EXCEPTION 'Only available units in the selected warehouse can be issued.'
        USING ERRCODE = '55000';
    END IF;

    INSERT INTO public.product_handovers (
      id, organization_id, handover_no, warehouse_id, agent_id,
      status, require_acknowledgment, notes, issued_by,
      accepted_by, accepted_at
    )
    VALUES (
      entity_id_value, p_org_id,
      public.next_product_commerce_number(p_org_id, 'handover', CURRENT_DATE),
      warehouse_row.id, agent_row.id,
      CASE
        WHEN COALESCE(
          NULLIF(p_payload->>'require_acknowledgment', '')::boolean,
          settings_row.require_agent_acknowledgment
        ) THEN 'issued'
        ELSE 'accepted'
      END,
      COALESCE(
        NULLIF(p_payload->>'require_acknowledgment', '')::boolean,
        settings_row.require_agent_acknowledgment
      ),
      NULLIF(btrim(p_payload->>'notes'), ''),
      p_actor_user_id,
      CASE
        WHEN COALESCE(
          NULLIF(p_payload->>'require_acknowledgment', '')::boolean,
          settings_row.require_agent_acknowledgment
        ) THEN NULL ELSE p_actor_user_id
      END,
      CASE
        WHEN COALESCE(
          NULLIF(p_payload->>'require_acknowledgment', '')::boolean,
          settings_row.require_agent_acknowledgment
        ) THEN NULL ELSE now()
      END
    )
    RETURNING * INTO handover_row;

    INSERT INTO public.product_handover_lines (
      organization_id, handover_id, unit_id, product_id,
      planned_sale_price_snapshot, minimum_sale_price, maximum_sale_price,
      currency, tax_included, line_status, accepted_at
    )
    SELECT
      p_org_id, handover_row.id, unit.id, unit.product_id,
      unit.planned_sale_price_snapshot,
      COALESCE(
        NULLIF(item.value->>'minimum_sale_price', '')::numeric,
        greatest(
          0.01,
          round(
            unit.planned_sale_price_snapshot
            * (1 - settings_row.default_price_tolerance_percent / 100),
            2
          )
        )
      ),
      COALESCE(
        NULLIF(item.value->>'maximum_sale_price', '')::numeric,
        round(
          unit.planned_sale_price_snapshot
          * (1 + settings_row.default_price_tolerance_percent / 100),
          2
        )
      ),
      unit.currency, receipt_line.tax_included,
      CASE WHEN handover_row.status = 'accepted' THEN 'accepted' ELSE 'pending' END,
      CASE WHEN handover_row.status = 'accepted' THEN now() END
    FROM jsonb_array_elements(units_value) item(value)
    JOIN public.product_inventory_units unit
      ON unit.organization_id = p_org_id
     AND unit.id = (item.value->>'unit_id')::uuid
    JOIN public.product_receipt_lines receipt_line
      ON receipt_line.organization_id = p_org_id
     AND receipt_line.id = unit.receipt_line_id;

    IF EXISTS (
      SELECT 1 FROM public.product_handover_lines line
      WHERE line.organization_id = p_org_id
        AND line.handover_id = handover_row.id
        AND line.minimum_sale_price > line.maximum_sale_price
    ) THEN
      RAISE EXCEPTION 'Handover sale-price boundaries are invalid.'
        USING ERRCODE = '23514';
    END IF;

    UPDATE public.product_inventory_units unit
    SET status = CASE WHEN handover_row.status = 'accepted' THEN 'with_agent' ELSE 'in_transit' END,
        warehouse_id = NULL,
        current_agent_id = handover_row.agent_id,
        current_handover_id = handover_row.id,
        assigned_at = now(),
        version = version + 1,
        updated_at = now()
    FROM jsonb_array_elements(units_value) item(value)
    WHERE unit.organization_id = p_org_id
      AND unit.id = (item.value->>'unit_id')::uuid;

    INSERT INTO public.product_inventory_movements (
      organization_id, unit_id, movement_type,
      from_warehouse_id, to_agent_id, handover_id,
      reason, performed_by, metadata
    )
    SELECT
      p_org_id, (item.value->>'unit_id')::uuid, 'handover_issued',
      warehouse_row.id, handover_row.agent_id, handover_row.id,
      NULLIF(btrim(p_payload->>'notes'), ''), p_actor_user_id,
      jsonb_build_object(
        'handover_no', handover_row.handover_no,
        'command_id', p_command_id,
        'require_acknowledgment', handover_row.require_acknowledgment
      )
    FROM jsonb_array_elements(units_value) item(value);

    IF handover_row.status = 'accepted' THEN
      INSERT INTO public.product_inventory_movements (
        organization_id, unit_id, movement_type,
        to_agent_id, handover_id, reason, performed_by, metadata
      )
      SELECT
        p_org_id, (item.value->>'unit_id')::uuid, 'handover_accepted',
        handover_row.agent_id, handover_row.id,
        'Immediate manager-approved custody', p_actor_user_id,
        jsonb_build_object('handover_no', handover_row.handover_no, 'command_id', p_command_id)
      FROM jsonb_array_elements(units_value) item(value);
    END IF;

    topic_value := 'product_inventory.handover_issued';
    event_payload := jsonb_build_object(
      'event_type', topic_value,
      'handover_id', handover_row.id,
      'handover_no', handover_row.handover_no,
      'agent_id', handover_row.agent_id,
      'agent_user_id', agent_row.user_id,
      'unit_count', unit_count_value,
      'status', handover_row.status,
      'version', handover_row.version
    );
    result_value := jsonb_build_object(
      'handover', to_jsonb(handover_row),
      'unit_count', unit_count_value
    );

  ELSIF p_action = 'handover_accept' THEN
    entity_id_value := NULLIF(p_payload->>'handover_id', '')::uuid;
    expected_version_value := COALESCE(NULLIF(p_payload->>'expected_version', '')::integer, 0);
    SELECT * INTO handover_row
    FROM public.product_handovers handover
    WHERE handover.organization_id = p_org_id
      AND handover.id = entity_id_value
    FOR UPDATE;
    IF handover_row.id IS NULL THEN
      RAISE EXCEPTION 'Product handover was not found.' USING ERRCODE = 'P0002';
    END IF;
    IF handover_row.status <> 'issued' OR handover_row.version <> expected_version_value THEN
      RAISE EXCEPTION 'Handover is no longer awaiting this acceptance.'
        USING ERRCODE = '40001';
    END IF;
    IF actor_role_value = 'field_agent' AND actor_agent_id <> handover_row.agent_id THEN
      RAISE EXCEPTION 'Agents can accept only their own handovers.'
        USING ERRCODE = '42501';
    END IF;

    PERFORM unit.id
    FROM public.product_inventory_units unit
    WHERE unit.organization_id = p_org_id
      AND unit.current_handover_id = handover_row.id
    ORDER BY unit.id
    FOR UPDATE;
    UPDATE public.product_inventory_units
    SET status = 'with_agent',
        version = version + 1,
        updated_at = now()
    WHERE organization_id = p_org_id
      AND current_handover_id = handover_row.id
      AND current_agent_id = handover_row.agent_id
      AND status = 'in_transit';
    GET DIAGNOSTICS affected_count_value = ROW_COUNT;
    IF affected_count_value < 1 OR affected_count_value <> (
      SELECT count(*) FROM public.product_handover_lines line
      WHERE line.organization_id = p_org_id
        AND line.handover_id = handover_row.id
        AND line.line_status = 'pending'
    ) THEN
      RAISE EXCEPTION 'Handover unit state changed before acceptance.'
        USING ERRCODE = '40001';
    END IF;

    UPDATE public.product_handover_lines
    SET line_status = 'accepted',
        accepted_at = now(),
        updated_at = now()
    WHERE organization_id = p_org_id
      AND handover_id = handover_row.id
      AND line_status = 'pending';

    INSERT INTO public.product_inventory_movements (
      organization_id, unit_id, movement_type,
      to_agent_id, handover_id, reason, performed_by, metadata
    )
    SELECT
      p_org_id, line.unit_id, 'handover_accepted',
      handover_row.agent_id, handover_row.id,
      'Agent custody acknowledgment', p_actor_user_id,
      jsonb_build_object('handover_no', handover_row.handover_no, 'command_id', p_command_id)
    FROM public.product_handover_lines line
    WHERE line.organization_id = p_org_id
      AND line.handover_id = handover_row.id;

    UPDATE public.product_handovers
    SET status = 'accepted',
        accepted_by = p_actor_user_id,
        accepted_at = now(),
        version = version + 1,
        updated_at = now()
    WHERE organization_id = p_org_id AND id = handover_row.id
    RETURNING * INTO handover_row;

    topic_value := 'product_inventory.handover_accepted';
    event_payload := jsonb_build_object(
      'event_type', topic_value,
      'handover_id', handover_row.id,
      'handover_no', handover_row.handover_no,
      'agent_id', handover_row.agent_id,
      'agent_user_id', (
        SELECT user_id FROM public.field_agents WHERE id = handover_row.agent_id
      ),
      'unit_count', affected_count_value,
      'status', handover_row.status,
      'version', handover_row.version
    );
    result_value := jsonb_build_object(
      'handover', to_jsonb(handover_row),
      'unit_count', affected_count_value
    );

  ELSIF p_action = 'agent_return' THEN
    entity_id_value := NULLIF(p_payload->>'return_id', '')::uuid;
    IF entity_id_value IS NULL THEN
      RAISE EXCEPTION 'Return id is required.' USING ERRCODE = '23514';
    END IF;
    units_value := COALESCE(p_payload->'unit_ids', '[]'::jsonb);
    IF jsonb_typeof(units_value) <> 'array' THEN
      RAISE EXCEPTION 'Return unit ids must be an array.' USING ERRCODE = '23514';
    END IF;
    unit_count_value := jsonb_array_length(units_value);
    IF unit_count_value < 1 OR unit_count_value > 200 OR (
      SELECT count(DISTINCT item.value)
      FROM jsonb_array_elements_text(units_value) item(value)
    ) <> unit_count_value THEN
      RAISE EXCEPTION 'Return requires 1-200 unique unit ids.'
        USING ERRCODE = '23514';
    END IF;
    IF length(btrim(COALESCE(p_payload->>'reason', ''))) < 3 THEN
      RAISE EXCEPTION 'Return reason is required.' USING ERRCODE = '23514';
    END IF;
    SELECT * INTO warehouse_row
    FROM public.inventory_warehouses warehouse
    WHERE warehouse.organization_id = p_org_id
      AND warehouse.id = NULLIF(p_payload->>'warehouse_id', '')::uuid
      AND warehouse.is_active
    FOR SHARE;
    IF warehouse_row.id IS NULL THEN
      RAISE EXCEPTION 'Return warehouse was not found.' USING ERRCODE = 'P0002';
    END IF;

    PERFORM unit.id
    FROM public.product_inventory_units unit
    JOIN jsonb_array_elements_text(units_value) item(value)
      ON unit.id = item.value::uuid
    WHERE unit.organization_id = p_org_id
    ORDER BY unit.id
    FOR UPDATE OF unit;
    IF (
      SELECT count(*)
      FROM public.product_inventory_units unit
      JOIN jsonb_array_elements_text(units_value) item(value)
        ON unit.id = item.value::uuid
      WHERE unit.organization_id = p_org_id
        AND unit.current_sale_id IS NULL
        AND (
          unit.status = 'with_agent'
          OR (
            unit.status = 'in_transit'
            AND actor_role_value IN ('admin', 'finance_manager')
          )
        )
        AND (
          actor_role_value IN ('admin', 'finance_manager')
          OR unit.current_agent_id = actor_agent_id
        )
    ) <> unit_count_value THEN
      RAISE EXCEPTION 'Only owned unsold custody units can be returned.'
        USING ERRCODE = '55000';
    END IF;
    IF (
      SELECT count(DISTINCT unit.current_agent_id)
      FROM public.product_inventory_units unit
      JOIN jsonb_array_elements_text(units_value) item(value)
        ON unit.id = item.value::uuid
      WHERE unit.organization_id = p_org_id
    ) <> 1 THEN
      RAISE EXCEPTION 'One return command must contain custody from one agent.'
        USING ERRCODE = '23514';
    END IF;
    SELECT unit.current_agent_id INTO custody_agent_id
    FROM public.product_inventory_units unit
    JOIN jsonb_array_elements_text(units_value) item(value)
      ON unit.id = item.value::uuid
    WHERE unit.organization_id = p_org_id
    LIMIT 1;

    INSERT INTO public.product_inventory_movements (
      organization_id, unit_id, movement_type,
      to_warehouse_id, from_agent_id, handover_id,
      reason, performed_by, metadata
    )
    SELECT
      p_org_id, unit.id, 'agent_return',
      warehouse_row.id, unit.current_agent_id, unit.current_handover_id,
      btrim(p_payload->>'reason'), p_actor_user_id,
      jsonb_build_object('command_id', p_command_id)
    FROM public.product_inventory_units unit
    JOIN jsonb_array_elements_text(units_value) item(value)
      ON unit.id = item.value::uuid
    WHERE unit.organization_id = p_org_id;

    UPDATE public.product_handover_lines line
    SET line_status = 'returned',
        closed_at = now(),
        updated_at = now()
    FROM public.product_inventory_units unit,
      jsonb_array_elements_text(units_value) item(value)
    WHERE unit.organization_id = p_org_id
      AND unit.id = item.value::uuid
      AND line.organization_id = p_org_id
      AND line.handover_id = unit.current_handover_id
      AND line.unit_id = unit.id
      AND line.line_status IN ('pending', 'accepted');

    UPDATE public.product_inventory_units unit
    SET status = 'in_stock',
        warehouse_id = warehouse_row.id,
        current_agent_id = NULL,
        current_handover_id = NULL,
        assigned_at = NULL,
        version = version + 1,
        updated_at = now()
    FROM jsonb_array_elements_text(units_value) item(value)
    WHERE unit.organization_id = p_org_id
      AND unit.id = item.value::uuid;

    UPDATE public.product_handovers handover
    SET status = 'completed',
        completed_at = now(),
        version = version + 1,
        updated_at = now()
    WHERE handover.organization_id = p_org_id
      AND handover.id IN (
        SELECT DISTINCT line.handover_id
        FROM public.product_handover_lines line
        WHERE line.organization_id = p_org_id
          AND line.unit_id IN (
            SELECT item.value::uuid FROM jsonb_array_elements_text(units_value) item(value)
          )
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.product_handover_lines open_line
        WHERE open_line.organization_id = p_org_id
          AND open_line.handover_id = handover.id
          AND open_line.line_status IN ('pending', 'accepted')
      );

    topic_value := 'product_inventory.agent_returned';
    event_payload := jsonb_build_object(
      'event_type', topic_value,
      'return_id', entity_id_value,
      'agent_id', custody_agent_id,
      'warehouse_id', warehouse_row.id,
      'unit_count', unit_count_value,
      'reason', btrim(p_payload->>'reason'),
      'version', 1
    );
    result_value := jsonb_build_object(
      'return_id', entity_id_value,
      'unit_count', unit_count_value,
      'warehouse_id', warehouse_row.id
    );

  ELSIF p_action = 'price_override_request' THEN
    IF actor_role_value <> 'field_agent' THEN
      RAISE EXCEPTION 'Only the assigned agent can request a sale-price exception.'
        USING ERRCODE = '42501';
    END IF;
    entity_id_value := NULLIF(p_payload->>'request_id', '')::uuid;
    price_value := COALESCE(NULLIF(p_payload->>'requested_price', '')::numeric, 0);
    IF entity_id_value IS NULL OR price_value <= 0
       OR length(btrim(COALESCE(p_payload->>'reason', ''))) < 5 THEN
      RAISE EXCEPTION 'Price exception id, price, and reason are required.'
        USING ERRCODE = '23514';
    END IF;
    SELECT * INTO unit_row
    FROM public.product_inventory_units unit
    WHERE unit.organization_id = p_org_id
      AND unit.id = NULLIF(p_payload->>'unit_id', '')::uuid
    FOR UPDATE;
    IF unit_row.id IS NULL OR unit_row.status <> 'with_agent'
       OR unit_row.current_agent_id <> actor_agent_id
       OR unit_row.current_handover_id IS NULL THEN
      RAISE EXCEPTION 'Price exception requires a unit in the agent custody.'
        USING ERRCODE = '55000';
    END IF;

    INSERT INTO public.product_price_override_requests (
      id, organization_id, unit_id, handover_id, agent_id,
      requested_price, currency, reason, requested_by
    )
    VALUES (
      entity_id_value, p_org_id, unit_row.id, unit_row.current_handover_id,
      actor_agent_id, price_value, unit_row.currency,
      btrim(p_payload->>'reason'), p_actor_user_id
    )
    RETURNING * INTO override_row;

    topic_value := 'product_inventory.price_override_requested';
    event_payload := jsonb_build_object(
      'event_type', topic_value,
      'request_id', override_row.id,
      'unit_id', override_row.unit_id,
      'agent_id', override_row.agent_id,
      'requested_price', override_row.requested_price,
      'currency', override_row.currency,
      'version', override_row.version
    );
    result_value := jsonb_build_object('request', to_jsonb(override_row));

  ELSIF p_action = 'price_override_review' THEN
    IF actor_role_value NOT IN ('admin', 'finance_manager') THEN
      RAISE EXCEPTION 'Only an inventory manager can review price exceptions.'
        USING ERRCODE = '42501';
    END IF;
    entity_id_value := NULLIF(p_payload->>'request_id', '')::uuid;
    expected_version_value := COALESCE(NULLIF(p_payload->>'expected_version', '')::integer, 0);
    decision_value := lower(btrim(COALESCE(p_payload->>'decision', '')));
    IF decision_value NOT IN ('approved', 'rejected') THEN
      RAISE EXCEPTION 'Price exception decision is invalid.' USING ERRCODE = '23514';
    END IF;
    SELECT * INTO override_row
    FROM public.product_price_override_requests request
    WHERE request.organization_id = p_org_id AND request.id = entity_id_value
    FOR UPDATE;
    IF override_row.id IS NULL THEN
      RAISE EXCEPTION 'Price exception request was not found.' USING ERRCODE = 'P0002';
    END IF;
    IF override_row.status <> 'pending'
       OR override_row.version <> expected_version_value THEN
      RAISE EXCEPTION 'Price exception request changed before review.'
        USING ERRCODE = '40001';
    END IF;
    UPDATE public.product_price_override_requests
    SET status = decision_value,
        reviewed_by = p_actor_user_id,
        reviewed_at = now(),
        review_note = NULLIF(btrim(p_payload->>'review_note'), ''),
        version = version + 1,
        updated_at = now()
    WHERE organization_id = p_org_id AND id = override_row.id
    RETURNING * INTO override_row;

    topic_value := 'product_inventory.price_override_reviewed';
    event_payload := jsonb_build_object(
      'event_type', topic_value,
      'request_id', override_row.id,
      'unit_id', override_row.unit_id,
      'agent_id', override_row.agent_id,
      'decision', override_row.status,
      'requested_price', override_row.requested_price,
      'currency', override_row.currency,
      'version', override_row.version
    );
    result_value := jsonb_build_object('request', to_jsonb(override_row));

  ELSIF p_action = 'sale' THEN
    IF actor_role_value <> 'field_agent' THEN
      RAISE EXCEPTION 'Only an active field agent can record a product sale.'
        USING ERRCODE = '42501';
    END IF;
    entity_id_value := NULLIF(p_payload->>'sale_id', '')::uuid;
    price_value := COALESCE(NULLIF(p_payload->>'actual_sale_price', '')::numeric, 0);
    date_value := COALESCE(NULLIF(p_payload->>'sale_date', '')::date, CURRENT_DATE);
    IF entity_id_value IS NULL OR price_value <= 0
       OR p_payload->>'payment_method' NOT IN (
         'cash', 'bank_transfer', 'card', 'electronic', 'agent_credit'
       ) THEN
      RAISE EXCEPTION 'Sale id, actual price, and payment method are required.'
        USING ERRCODE = '23514';
    END IF;

    SELECT * INTO unit_row
    FROM public.product_inventory_units unit
    WHERE unit.organization_id = p_org_id
      AND unit.id = NULLIF(p_payload->>'unit_id', '')::uuid
    FOR UPDATE;
    IF unit_row.id IS NULL OR unit_row.status <> 'with_agent'
       OR unit_row.current_agent_id <> actor_agent_id
       OR unit_row.current_handover_id IS NULL
       OR unit_row.current_sale_id IS NOT NULL THEN
      RAISE EXCEPTION 'Only an unsold unit in the current agent custody can be sold.'
        USING ERRCODE = '55000';
    END IF;

    SELECT
      line.minimum_sale_price,
      line.maximum_sale_price,
      line.tax_included
    INTO minimum_price_value, maximum_price_value, tax_included_value
    FROM public.product_handover_lines line
    WHERE line.organization_id = p_org_id
      AND line.handover_id = unit_row.current_handover_id
      AND line.unit_id = unit_row.id
      AND line.line_status = 'accepted'
    FOR UPDATE;
    IF minimum_price_value IS NULL THEN
      RAISE EXCEPTION 'Accepted handover price policy was not found.'
        USING ERRCODE = '55000';
    END IF;

    IF price_value < minimum_price_value OR price_value > maximum_price_value
       OR price_value < unit_row.unit_cost_snapshot THEN
      SELECT * INTO override_row
      FROM public.product_price_override_requests request
      WHERE request.organization_id = p_org_id
        AND request.id = NULLIF(p_payload->>'price_override_request_id', '')::uuid
        AND request.unit_id = unit_row.id
        AND request.handover_id = unit_row.current_handover_id
        AND request.agent_id = actor_agent_id
        AND request.status = 'approved'
        AND request.requested_price = price_value
      FOR UPDATE;
      IF override_row.id IS NULL THEN
        RAISE EXCEPTION 'The sale price is outside policy and needs manager approval.'
          USING ERRCODE = '23514';
      END IF;
    END IF;

    SELECT COALESCE(tax.rate, 0)
    INTO vat_rate_value
    FROM public.sales_products product
    LEFT JOIN public.accounting_tax_rates tax
      ON tax.organization_id = p_org_id
     AND tax.id = product.tax_rate_id
     AND tax.is_active
    WHERE product.organization_id = p_org_id
      AND product.id = unit_row.product_id;
    vat_rate_value := COALESCE(vat_rate_value, 0);
    IF tax_included_value AND vat_rate_value > 0 THEN
      net_value := round(price_value / (1 + vat_rate_value / 100), 2);
      vat_value := price_value - net_value;
      total_value := price_value;
    ELSE
      net_value := price_value;
      vat_value := round(price_value * vat_rate_value / 100, 2);
      total_value := price_value + vat_value;
    END IF;

    SELECT CASE product.agent_commission_type
      WHEN 'flat' THEN product.agent_commission_value
      WHEN 'percentage' THEN round(net_value * product.agent_commission_value / 100, 2)
      ELSE 0
    END
    INTO commission_value
    FROM public.sales_products product
    WHERE product.organization_id = p_org_id AND product.id = unit_row.product_id;
    commission_value := COALESCE(commission_value, 0);

    INSERT INTO public.agent_product_sales (
      id, organization_id, sale_no, agent_id, sale_date,
      customer_name, customer_phone, customer_reference, payment_method,
      subtotal, discount, vat_amount, total_amount, status,
      accounting_status, created_by
    )
    VALUES (
      entity_id_value, p_org_id,
      public.next_product_commerce_number(p_org_id, 'sale', date_value),
      actor_agent_id, date_value,
      NULLIF(btrim(p_payload->>'customer_name'), ''),
      NULLIF(btrim(p_payload->>'customer_phone'), ''),
      NULLIF(btrim(p_payload->>'customer_reference'), ''),
      p_payload->>'payment_method',
      net_value, 0, vat_value, total_value, 'active',
      CASE WHEN unit_row.ownership_type = 'consignment' THEN 'not_required' ELSE 'pending' END,
      p_actor_user_id
    )
    RETURNING * INTO sale_row;

    INSERT INTO public.agent_product_sale_lines (
      organization_id, sale_id, unit_id, handover_id, product_id,
      serial_snapshot, product_name_snapshot, unit_cost_snapshot,
      planned_sale_price_snapshot, minimum_sale_price_snapshot,
      maximum_sale_price_snapshot, actual_sale_price, net_amount,
      vat_rate, vat_amount, total_amount, gross_profit, currency,
      commission_rule_snapshot, agent_commission_amount,
      price_override_request_id
    )
    SELECT
      p_org_id, sale_row.id, unit_row.id, unit_row.current_handover_id,
      unit_row.product_id, unit_row.raw_serial_number, product.name,
      unit_row.unit_cost_snapshot, unit_row.planned_sale_price_snapshot,
      minimum_price_value, maximum_price_value, price_value, net_value,
      vat_rate_value, vat_value, total_value,
      net_value - unit_row.unit_cost_snapshot, unit_row.currency,
      jsonb_build_object(
        'type', product.agent_commission_type,
        'value', product.agent_commission_value,
        'base', 'net_amount'
      ),
      commission_value, override_row.id
    FROM public.sales_products product
    WHERE product.organization_id = p_org_id AND product.id = unit_row.product_id;

    UPDATE public.product_price_override_requests
    SET status = 'used',
        used_sale_id = sale_row.id,
        version = version + 1,
        updated_at = now()
    WHERE organization_id = p_org_id AND id = override_row.id;

    UPDATE public.product_handover_lines
    SET line_status = 'sold',
        closed_at = now(),
        updated_at = now()
    WHERE organization_id = p_org_id
      AND handover_id = unit_row.current_handover_id
      AND unit_id = unit_row.id
      AND line_status = 'accepted';

    UPDATE public.product_inventory_units
    SET status = 'sold',
        current_agent_id = NULL,
        sold_at = now(),
        sold_by_agent_id = actor_agent_id,
        current_sale_id = sale_row.id,
        version = version + 1,
        updated_at = now()
    WHERE organization_id = p_org_id AND id = unit_row.id;

    INSERT INTO public.product_inventory_movements (
      organization_id, unit_id, movement_type,
      from_agent_id, handover_id, sale_id,
      reason, performed_by, metadata
    )
    VALUES (
      p_org_id, unit_row.id, 'sale', actor_agent_id,
      unit_row.current_handover_id, sale_row.id,
      'Serialized product sold by assigned agent', p_actor_user_id,
      jsonb_build_object(
        'sale_no', sale_row.sale_no,
        'actual_sale_price', price_value,
        'total_amount', total_value,
        'command_id', p_command_id
      )
    );

    UPDATE public.product_handovers handover
    SET status = 'completed',
        completed_at = now(),
        version = version + 1,
        updated_at = now()
    WHERE handover.organization_id = p_org_id
      AND handover.id = unit_row.current_handover_id
      AND NOT EXISTS (
        SELECT 1 FROM public.product_handover_lines open_line
        WHERE open_line.organization_id = p_org_id
          AND open_line.handover_id = handover.id
          AND open_line.line_status IN ('pending', 'accepted')
      );

    topic_value := 'product_inventory.sale_recorded';
    event_payload := jsonb_build_object(
      'event_type', topic_value,
      'sale_id', sale_row.id,
      'sale_no', sale_row.sale_no,
      'unit_id', unit_row.id,
      'agent_id', actor_agent_id,
      'agent_user_id', p_actor_user_id,
      'total_amount', sale_row.total_amount,
      'net_amount', sale_row.subtotal,
      'vat_amount', sale_row.vat_amount,
      'unit_cost', unit_row.unit_cost_snapshot,
      'gross_profit', net_value - unit_row.unit_cost_snapshot,
      'accounting_status', sale_row.accounting_status,
      'version', sale_row.version
    );
    result_value := jsonb_build_object('sale', to_jsonb(sale_row));

  ELSIF p_action = 'sale_void' THEN
    IF actor_role_value NOT IN ('admin', 'finance_manager') THEN
      RAISE EXCEPTION 'Only an inventory manager can void a product sale.'
        USING ERRCODE = '42501';
    END IF;
    entity_id_value := NULLIF(p_payload->>'sale_id', '')::uuid;
    expected_version_value := COALESCE(NULLIF(p_payload->>'expected_version', '')::integer, 0);
    disposition_value := lower(btrim(COALESCE(p_payload->>'return_disposition', 'sellable')));
    IF disposition_value NOT IN ('sellable', 'damaged')
       OR length(btrim(COALESCE(p_payload->>'reason', ''))) < 5 THEN
      RAISE EXCEPTION 'Void reason and valid return disposition are required.'
        USING ERRCODE = '23514';
    END IF;
    SELECT * INTO sale_row
    FROM public.agent_product_sales sale
    WHERE sale.organization_id = p_org_id AND sale.id = entity_id_value
    FOR UPDATE;
    IF sale_row.id IS NULL THEN
      RAISE EXCEPTION 'Product sale was not found.' USING ERRCODE = 'P0002';
    END IF;
    IF sale_row.status <> 'active' OR sale_row.version <> expected_version_value THEN
      RAISE EXCEPTION 'Sale is no longer active at the requested version.'
        USING ERRCODE = '40001';
    END IF;
    SELECT unit.* INTO unit_row
    FROM public.product_inventory_units unit
    JOIN public.agent_product_sale_lines line
      ON line.organization_id = p_org_id
     AND line.sale_id = sale_row.id
     AND line.unit_id = unit.id
    WHERE unit.organization_id = p_org_id
    FOR UPDATE OF unit;
    IF unit_row.id IS NULL OR unit_row.status <> 'sold'
       OR unit_row.current_sale_id <> sale_row.id THEN
      RAISE EXCEPTION 'Sold unit state changed before sale void.'
        USING ERRCODE = '40001';
    END IF;
    SELECT * INTO handover_row
    FROM public.product_handovers handover
    WHERE handover.organization_id = p_org_id
      AND handover.id = unit_row.current_handover_id;
    IF handover_row.id IS NULL THEN
      RAISE EXCEPTION 'Original handover was not found.' USING ERRCODE = 'P0002';
    END IF;

    INSERT INTO public.product_inventory_movements (
      organization_id, unit_id, movement_type,
      to_warehouse_id, from_agent_id, handover_id, sale_id,
      reason, performed_by, metadata
    )
    VALUES (
      p_org_id, unit_row.id, 'sale_void',
      CASE WHEN disposition_value = 'sellable' THEN handover_row.warehouse_id END,
      sale_row.agent_id, handover_row.id, sale_row.id,
      btrim(p_payload->>'reason'), p_actor_user_id,
      jsonb_build_object(
        'sale_no', sale_row.sale_no,
        'return_disposition', disposition_value,
        'unit_cost_snapshot', unit_row.unit_cost_snapshot,
        'command_id', p_command_id
      )
    );

    UPDATE public.product_inventory_units
    SET status = CASE WHEN disposition_value = 'sellable' THEN 'in_stock' ELSE 'damaged' END,
        warehouse_id = CASE WHEN disposition_value = 'sellable' THEN handover_row.warehouse_id ELSE NULL END,
        current_agent_id = NULL,
        current_handover_id = NULL,
        current_sale_id = NULL,
        assigned_at = NULL,
        sold_at = NULL,
        sold_by_agent_id = NULL,
        version = version + 1,
        updated_at = now()
    WHERE organization_id = p_org_id AND id = unit_row.id;

    UPDATE public.product_handover_lines
    SET line_status = 'voided',
        closed_at = now(),
        updated_at = now()
    WHERE organization_id = p_org_id
      AND handover_id = handover_row.id
      AND unit_id = unit_row.id;

    UPDATE public.agent_product_sales
    SET status = 'voided',
        voided_by = p_actor_user_id,
        voided_at = now(),
        void_reason = btrim(p_payload->>'reason'),
        return_disposition = disposition_value,
        accounting_status = CASE
          WHEN accounting_status = 'posted' THEN 'pending'
          WHEN accounting_status = 'not_required' THEN 'not_required'
          ELSE 'reversed'
        END,
        version = version + 1,
        updated_at = now()
    WHERE organization_id = p_org_id AND id = sale_row.id
    RETURNING * INTO sale_row;

    topic_value := 'product_inventory.sale_voided';
    event_payload := jsonb_build_object(
      'event_type', topic_value,
      'sale_id', sale_row.id,
      'sale_no', sale_row.sale_no,
      'unit_id', unit_row.id,
      'agent_id', sale_row.agent_id,
      'total_amount', sale_row.total_amount,
      'return_disposition', disposition_value,
      'reason', sale_row.void_reason,
      'version', sale_row.version
    );
    result_value := jsonb_build_object('sale', to_jsonb(sale_row));

  ELSE
    IF actor_role_value NOT IN ('admin', 'finance_manager') THEN
      RAISE EXCEPTION 'Only an inventory manager can post an agent collection.'
        USING ERRCODE = '42501';
    END IF;
    entity_id_value := NULLIF(p_payload->>'collection_id', '')::uuid;
    price_value := COALESCE(NULLIF(p_payload->>'amount', '')::numeric, 0);
    date_value := COALESCE(NULLIF(p_payload->>'collection_date', '')::date, CURRENT_DATE);
    IF entity_id_value IS NULL OR price_value <= 0
       OR p_payload->>'payment_method' NOT IN (
         'cash', 'bank_transfer', 'card', 'electronic'
       ) THEN
      RAISE EXCEPTION 'Collection id, amount, and payment method are required.'
        USING ERRCODE = '23514';
    END IF;
    SELECT * INTO agent_row
    FROM public.field_agents agent
    WHERE agent.organization_id = p_org_id
      AND agent.id = NULLIF(p_payload->>'agent_id', '')::uuid
      AND agent.status = 'active'
    FOR UPDATE;
    IF agent_row.id IS NULL THEN
      RAISE EXCEPTION 'Active field agent was not found.' USING ERRCODE = 'P0002';
    END IF;
    SELECT
      COALESCE((
        SELECT sum(sale.total_amount)
        FROM public.agent_product_sales sale
        WHERE sale.organization_id = p_org_id
          AND sale.agent_id = agent_row.id
          AND sale.status = 'active'
      ), 0)
      - COALESCE((
        SELECT sum(collection.amount)
        FROM public.agent_product_collections collection
        WHERE collection.organization_id = p_org_id
          AND collection.agent_id = agent_row.id
          AND collection.status = 'posted'
      ), 0)
    INTO outstanding_value;
    IF price_value > outstanding_value + 0.005 THEN
      RAISE EXCEPTION 'Collection exceeds the agent outstanding product balance.'
        USING ERRCODE = '23514';
    END IF;

    INSERT INTO public.agent_product_collections (
      id, organization_id, collection_no, agent_id, amount,
      payment_method, reference, collection_date, notes,
      status, accounting_status, collected_by
    )
    VALUES (
      entity_id_value, p_org_id,
      public.next_product_commerce_number(p_org_id, 'collection', date_value),
      agent_row.id, price_value, p_payload->>'payment_method',
      NULLIF(btrim(p_payload->>'reference'), ''), date_value,
      NULLIF(btrim(p_payload->>'notes'), ''), 'posted', 'pending', p_actor_user_id
    )
    RETURNING collection_no INTO decision_value;

    topic_value := 'product_inventory.collection_posted';
    event_payload := jsonb_build_object(
      'event_type', topic_value,
      'collection_id', entity_id_value,
      'agent_id', agent_row.id,
      'amount', price_value,
      'payment_method', p_payload->>'payment_method',
      'collection_date', date_value,
      'outstanding_after', outstanding_value - price_value,
      'accounting_status', 'pending',
      'version', 1
    );
    result_value := jsonb_build_object(
      'collection', (
        SELECT to_jsonb(collection)
        FROM public.agent_product_collections collection
        WHERE collection.organization_id = p_org_id AND collection.id = entity_id_value
      ),
      'outstanding_after', outstanding_value - price_value
    );
  END IF;

  event_hash_value := encode(digest(event_payload::text, 'sha256'), 'hex');
  INSERT INTO public.business_events (
    org_id, source_type, business_key, event_version,
    payload, payload_hash, status, request_id,
    actor_user_id, occurred_at, processed_at
  )
  VALUES (
    p_org_id, 'product_inventory_commerce',
    COALESCE(entity_id_value::text, p_command_id::text) || ':' || p_action,
    COALESCE((event_payload->>'version')::integer, 1),
    event_payload, event_hash_value, 'completed',
    p_request_id, p_actor_user_id, now(), now()
  )
  RETURNING id INTO event_id_value;

  INSERT INTO public.event_outbox (
    org_id, business_event_id, topic, payload, payload_hash
  )
  VALUES (
    p_org_id, event_id_value, topic_value, event_payload, event_hash_value
  );

  INSERT INTO public.operational_audit_logs (
    org_id, request_id, actor_user_id, actor_role, action,
    target_type, target_id, outcome, status_code, metadata
  )
  VALUES (
    p_org_id, p_request_id, p_actor_user_id, actor_role_value,
    topic_value, 'product_inventory_commerce',
    COALESCE(entity_id_value::text, p_command_id::text),
    'success', 200,
    result_value - 'sale' - 'handover' - 'request' - 'collection'
  );

  UPDATE public.product_inventory_commands
  SET entity_id = entity_id_value,
      status = 'completed',
      result = result_value,
      completed_at = now()
  WHERE id = command_row.id;

  RETURN result_value;
END;
$$;

REVOKE ALL ON FUNCTION public.next_product_commerce_number(uuid, text, date)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.next_product_commerce_number(uuid, text, date)
  TO service_role;

REVOKE ALL ON FUNCTION public.execute_product_commerce_command(
  uuid, uuid, uuid, uuid, text, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.execute_product_commerce_command(
  uuid, uuid, uuid, uuid, text, jsonb
) TO service_role;

COMMENT ON FUNCTION public.execute_product_commerce_command(
  uuid, uuid, uuid, uuid, text, jsonb
) IS
  'Atomically moves serialized products through handover, agent custody, controlled sale, return, void, and collection workflows.';
