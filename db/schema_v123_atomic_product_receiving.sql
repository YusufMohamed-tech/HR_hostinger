-- Phase 1: atomic, replay-safe manual product receipt drafting, confirmation,
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
      'admin', 'sales_manager', 'onground_agent_manager', 'inventory_receiver'
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
