-- Atomic, replay-safe SIM inventory imports and assignments.
-- The commerce migration made SIM tables command-owned for browser sessions,
-- but the server import/assignment routes still performed several service-role
-- writes. This command joins inventory, transfer history, audit, and outbox
-- state in one database transaction.

ALTER TABLE public.sim_commerce_commands
  DROP CONSTRAINT IF EXISTS sim_commerce_commands_action_check;
ALTER TABLE public.sim_commerce_commands
  ADD CONSTRAINT sim_commerce_commands_action_check CHECK (
    action IN (
      'sale', 'return', 'void', 'commission_settle',
      'inventory_import', 'inventory_box_import', 'inventory_assign'
    )
  );

CREATE OR REPLACE FUNCTION public.execute_sim_inventory_command(
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
  command_row public.sim_commerce_commands%ROWTYPE;
  batch_row public.sim_import_batches%ROWTYPE;
  agent_row public.field_agents%ROWTYPE;
  actor_role_value text;
  payload_value jsonb := jsonb_build_object(
    'action', p_action,
    'payload', COALESCE(p_payload, '{}'::jsonb)
  );
  hash_value text;
  event_payload jsonb;
  event_id uuid;
  topic_value text;
  result_value jsonb;
  sim_ids_value uuid[] := ARRAY[]::uuid[];
  requested_sim_ids uuid[] := ARRAY[]::uuid[];
  duplicate_codes text[] := ARRAY[]::text[];
  assigned_agent_id_value uuid;
  requested_count integer := 0;
  inserted_count integer := 0;
  current_inventory_count integer := 0;
  updated_count integer := 0;
  provider_value text;
  sim_type_value text;
  notes_value text;
  generated_preview_value jsonb := '[]'::jsonb;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501';
  END IF;
  IF p_org_id IS NULL OR p_actor_user_id IS NULL OR p_request_id IS NULL OR p_command_id IS NULL THEN
    RAISE EXCEPTION 'Organization, actor, request, and command ids are required.' USING ERRCODE = '22023';
  END IF;
  IF p_action NOT IN ('inventory_import', 'inventory_box_import', 'inventory_assign') THEN
    RAISE EXCEPTION 'Unsupported SIM inventory action.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(COALESCE(p_payload, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'SIM inventory payload must be an object.' USING ERRCODE = '22023';
  END IF;

  SELECT member.role::text INTO actor_role_value
  FROM public.org_members member
  JOIN public.organizations organization ON organization.id = member.org_id
  WHERE member.org_id = p_org_id
    AND member.user_id = p_actor_user_id
    AND member.role::text IN ('admin', 'sales_manager', 'onground_agent_manager')
    AND lower(COALESCE(organization.status, '')) = 'active'
  LIMIT 1;
  IF actor_role_value IS NULL THEN
    RAISE EXCEPTION 'Field-agent management access is required.' USING ERRCODE = '42501';
  END IF;

  hash_value := encode(digest(payload_value::text, 'sha256'), 'hex');
  INSERT INTO public.sim_commerce_commands (
    organization_id, idempotency_key, action, payload_hash, actor_user_id, request_id
  ) VALUES (
    p_org_id, p_command_id, p_action, hash_value, p_actor_user_id, p_request_id
  )
  ON CONFLICT (organization_id, idempotency_key) DO NOTHING;

  SELECT * INTO command_row
  FROM public.sim_commerce_commands
  WHERE organization_id = p_org_id AND idempotency_key = p_command_id
  FOR UPDATE;
  IF command_row.action <> p_action OR command_row.payload_hash <> hash_value
     OR command_row.actor_user_id IS DISTINCT FROM p_actor_user_id THEN
    RAISE EXCEPTION 'Idempotency key was reused for a different SIM inventory command.'
      USING ERRCODE = '23505';
  END IF;
  IF command_row.status = 'completed' THEN
    RETURN command_row.result;
  END IF;

  IF p_action = 'inventory_import' THEN
    IF jsonb_typeof(p_payload->'sims') <> 'array' THEN
      RAISE EXCEPTION 'SIM import requires a sims array.' USING ERRCODE = '22023';
    END IF;
    requested_count := jsonb_array_length(p_payload->'sims');
    IF requested_count < 1 OR requested_count > 1000 THEN
      RAISE EXCEPTION 'SIM import must contain between 1 and 1000 rows.' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM jsonb_to_recordset(p_payload->'sims') AS item(
        iccid text, provider text, sim_type text, price numeric
      )
      WHERE length(btrim(COALESCE(item.iccid, ''))) NOT BETWEEN 18 AND 22
        OR length(btrim(COALESCE(item.provider, ''))) NOT BETWEEN 1 AND 40
        OR length(btrim(COALESCE(item.sim_type, ''))) NOT BETWEEN 1 AND 40
        OR item.price IS NULL OR item.price < 0
    ) THEN
      RAISE EXCEPTION 'One or more SIM import rows are invalid.' USING ERRCODE = '23514';
    END IF;
    IF (
      SELECT count(DISTINCT btrim(item.iccid))
      FROM jsonb_to_recordset(p_payload->'sims') AS item(iccid text)
    ) <> requested_count THEN
      RAISE EXCEPTION 'SIM import ICCIDs must be unique.' USING ERRCODE = '23505';
    END IF;

    WITH inserted AS (
      INSERT INTO public.sim_units (
        organization_id, iccid, provider, sim_type, price, status,
        import_source, added_by
      )
      SELECT p_org_id, btrim(item.iccid), lower(btrim(item.provider)),
        lower(btrim(item.sim_type)), item.price, 'in_stock', 'manual', p_actor_user_id
      FROM jsonb_to_recordset(p_payload->'sims') AS item(
        iccid text, provider text, sim_type text, price numeric
      )
      RETURNING id
    )
    SELECT COALESCE(array_agg(inserted.id ORDER BY inserted.id), ARRAY[]::uuid[])
      INTO sim_ids_value
    FROM inserted;

    INSERT INTO public.sim_transfers (
      organization_id, sim_unit_id, transfer_type, performed_by, notes
    )
    SELECT p_org_id, sim_id, 'initial_import', p_actor_user_id,
      'Atomic manual SIM import ' || p_command_id::text
    FROM unnest(sim_ids_value) AS sim_id;

    inserted_count := cardinality(sim_ids_value);
    result_value := jsonb_build_object(
      'imported', inserted_count,
      'sim_unit_ids', to_jsonb(sim_ids_value)
    );
    topic_value := 'sim.inventory_imported';
    event_payload := jsonb_build_object(
      'event_type', topic_value,
      'command_id', p_command_id,
      'import_type', 'manual',
      'imported_count', inserted_count,
      'sim_unit_ids', to_jsonb(sim_ids_value),
      'version', 1
    );

  ELSIF p_action = 'inventory_box_import' THEN
    IF jsonb_typeof(p_payload->'kit_codes') <> 'array' THEN
      RAISE EXCEPTION 'SIM box import requires a kit_codes array.' USING ERRCODE = '22023';
    END IF;
    requested_count := jsonb_array_length(p_payload->'kit_codes');
    IF requested_count < 1 OR requested_count > 1000 THEN
      RAISE EXCEPTION 'SIM box import must contain between 1 and 1000 kit codes.' USING ERRCODE = '23514';
    END IF;
    provider_value := lower(btrim(COALESCE(p_payload->>'provider', '')));
    IF length(provider_value) NOT BETWEEN 1 AND 80 THEN
      RAISE EXCEPTION 'A valid SIM provider is required.' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(p_payload->'kit_codes') AS item(value)
      WHERE length(btrim(item.value)) NOT BETWEEN 1 AND 80
    ) THEN
      RAISE EXCEPTION 'One or more SIM box kit codes are invalid.' USING ERRCODE = '23514';
    END IF;
    IF (
      SELECT count(DISTINCT btrim(item.value))
      FROM jsonb_array_elements_text(p_payload->'kit_codes') AS item(value)
    ) <> requested_count THEN
      RAISE EXCEPTION 'SIM box kit codes must be unique.' USING ERRCODE = '23505';
    END IF;
    IF NULLIF(p_payload->>'image_path', '') IS NOT NULL
       AND (p_payload->>'image_path') NOT LIKE 'orgs/' || p_org_id::text || '/sales/sim-box-imports/%' THEN
      RAISE EXCEPTION 'SIM box image path is not tenant scoped.' USING ERRCODE = '42501';
    END IF;

    IF NULLIF(p_payload->>'assigned_agent_id', '') IS NOT NULL THEN
      assigned_agent_id_value := (p_payload->>'assigned_agent_id')::uuid;
      SELECT * INTO agent_row FROM public.field_agents
      WHERE organization_id = p_org_id AND id = assigned_agent_id_value
      FOR UPDATE;
      IF agent_row.id IS NULL THEN
        RAISE EXCEPTION 'Assigned agent was not found.' USING ERRCODE = 'P0002';
      END IF;
      IF agent_row.status <> 'active' THEN
        RAISE EXCEPTION 'Cannot assign imported SIMs to a suspended agent.' USING ERRCODE = '55000';
      END IF;
    END IF;

    SELECT COALESCE(array_agg(duplicate.kit_code ORDER BY duplicate.kit_code), ARRAY[]::text[])
      INTO duplicate_codes
    FROM (
      SELECT DISTINCT btrim(item.value) AS kit_code
      FROM jsonb_array_elements_text(p_payload->'kit_codes') AS item(value)
      WHERE EXISTS (
        SELECT 1 FROM public.sim_units sim
        WHERE sim.organization_id = p_org_id
          AND sim.provider = provider_value
          AND (sim.kit_code = btrim(item.value) OR sim.iccid = btrim(item.value))
      )
    ) duplicate;

    IF cardinality(duplicate_codes) > 0
       AND COALESCE((p_payload->>'skip_duplicates')::boolean, false) = false THEN
      RAISE EXCEPTION 'Duplicate SIM box kit codes found: %', array_to_string(duplicate_codes, ', ')
        USING ERRCODE = '23505';
    END IF;
    inserted_count := requested_count - cardinality(duplicate_codes);

    IF agent_row.max_sim_capacity IS NOT NULL THEN
      SELECT count(*)::integer INTO current_inventory_count
      FROM public.sim_units
      WHERE organization_id = p_org_id
        AND current_agent_id = assigned_agent_id_value
        AND status::text IN ('with_agent', 'with_merchant');
      IF current_inventory_count + inserted_count > agent_row.max_sim_capacity THEN
        RAISE EXCEPTION 'Import exceeds the agent SIM capacity.' USING ERRCODE = '23514';
      END IF;
    END IF;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'sequence', item.sequence,
      'kit_code', btrim(item.value),
      'is_duplicate', btrim(item.value) = ANY(duplicate_codes)
    ) ORDER BY item.sequence), '[]'::jsonb)
      INTO generated_preview_value
    FROM jsonb_array_elements_text(p_payload->'kit_codes') WITH ORDINALITY AS item(value, sequence);

    INSERT INTO public.sim_import_batches (
      organization_id, provider, order_number, batch_number, barcode_text,
      dealer_box_number, dealer_box_total, first_kitcode, last_kitcode,
      quantity, step, image_path, extracted_json, generated_preview,
      status, imported_count, duplicate_count, assigned_agent_id,
      created_by, confirmed_by, confirmed_at
    ) VALUES (
      p_org_id, provider_value, NULLIF(btrim(p_payload->>'order_number'), ''),
      NULLIF(btrim(p_payload->>'batch_number'), ''), NULLIF(btrim(p_payload->>'barcode_text'), ''),
      NULLIF(p_payload->>'dealer_box_number', '')::integer,
      NULLIF(p_payload->>'dealer_box_total', '')::integer,
      btrim(p_payload->>'first_kitcode'), btrim(p_payload->>'last_kitcode'),
      requested_count, NULLIF(p_payload->>'step', '')::integer,
      NULLIF(p_payload->>'image_path', ''), COALESCE(p_payload->'extracted_json', '{}'::jsonb),
      generated_preview_value, 'confirmed', inserted_count, cardinality(duplicate_codes),
      assigned_agent_id_value, p_actor_user_id, p_actor_user_id, now()
    ) RETURNING * INTO batch_row;

    WITH inserted AS (
      INSERT INTO public.sim_units (
        organization_id, iccid, kit_code, provider, sim_type, price, status,
        current_agent_id, assigned_at, current_merchant_id, import_batch_id,
        dealer_box_number, box_sequence, import_source, added_by
      )
      SELECT p_org_id, btrim(item.value), btrim(item.value), provider_value, 'prepaid', 0,
        CASE WHEN assigned_agent_id_value IS NULL THEN 'in_stock'::public.sim_status
          ELSE 'with_agent'::public.sim_status END,
        assigned_agent_id_value, CASE WHEN assigned_agent_id_value IS NULL THEN NULL ELSE now() END,
        NULL, batch_row.id, NULLIF(p_payload->>'dealer_box_number', '')::integer,
        item.sequence::integer, 'box_ocr', p_actor_user_id
      FROM jsonb_array_elements_text(p_payload->'kit_codes') WITH ORDINALITY AS item(value, sequence)
      WHERE NOT (btrim(item.value) = ANY(duplicate_codes))
      RETURNING id
    )
    SELECT COALESCE(array_agg(inserted.id ORDER BY inserted.id), ARRAY[]::uuid[])
      INTO sim_ids_value
    FROM inserted;

    INSERT INTO public.sim_transfers (
      organization_id, sim_unit_id, transfer_type, performed_by, notes
    )
    SELECT p_org_id, sim_id, 'initial_import', p_actor_user_id,
      'Atomic SIM box import ' || batch_row.id::text
    FROM unnest(sim_ids_value) AS sim_id;
    IF assigned_agent_id_value IS NOT NULL THEN
      INSERT INTO public.sim_transfers (
        organization_id, sim_unit_id, transfer_type, to_agent_id, performed_by, notes
      )
      SELECT p_org_id, sim_id, 'assign_to_agent', assigned_agent_id_value, p_actor_user_id,
        'Direct assignment from atomic SIM box import ' || batch_row.id::text
      FROM unnest(sim_ids_value) AS sim_id;
    END IF;

    result_value := jsonb_build_object(
      'batch', to_jsonb(batch_row),
      'inserted_count', cardinality(sim_ids_value),
      'skipped_duplicates', to_jsonb(duplicate_codes),
      'assigned_agent_id', assigned_agent_id_value
    );
    topic_value := 'sim.inventory_box_imported';
    event_payload := jsonb_build_object(
      'event_type', topic_value,
      'command_id', p_command_id,
      'import_type', 'box_ocr',
      'batch_id', batch_row.id,
      'imported_count', cardinality(sim_ids_value),
      'duplicate_count', cardinality(duplicate_codes),
      'assigned_agent_id', assigned_agent_id_value,
      'version', 1
    );
    UPDATE public.sim_commerce_commands SET entity_id = batch_row.id WHERE id = command_row.id;

  ELSE
    assigned_agent_id_value := NULLIF(p_payload->>'agent_id', '')::uuid;
    notes_value := NULLIF(btrim(p_payload->>'notes'), '');
    SELECT * INTO agent_row FROM public.field_agents
    WHERE organization_id = p_org_id AND id = assigned_agent_id_value
    FOR UPDATE;
    IF agent_row.id IS NULL THEN
      RAISE EXCEPTION 'Agent was not found.' USING ERRCODE = 'P0002';
    END IF;
    IF agent_row.status <> 'active' THEN
      RAISE EXCEPTION 'Cannot assign SIMs to a suspended agent.' USING ERRCODE = '55000';
    END IF;

    IF jsonb_typeof(p_payload->'sim_ids') = 'array'
       AND jsonb_array_length(p_payload->'sim_ids') > 0 THEN
      requested_count := jsonb_array_length(p_payload->'sim_ids');
      IF requested_count > 1000 THEN
        RAISE EXCEPTION 'A SIM assignment cannot exceed 1000 rows.' USING ERRCODE = '23514';
      END IF;
      SELECT COALESCE(array_agg(item.value::uuid ORDER BY item.value), ARRAY[]::uuid[])
        INTO requested_sim_ids
      FROM jsonb_array_elements_text(p_payload->'sim_ids') AS item(value);
      IF cardinality(ARRAY(SELECT DISTINCT unnest(requested_sim_ids))) <> requested_count THEN
        RAISE EXCEPTION 'SIM assignment ids must be unique.' USING ERRCODE = '23505';
      END IF;
      PERFORM 1 FROM public.sim_units sim
      WHERE sim.organization_id = p_org_id AND sim.id = ANY(requested_sim_ids)
      ORDER BY sim.id FOR UPDATE;
      SELECT COALESCE(array_agg(sim.id ORDER BY sim.id), ARRAY[]::uuid[])
        INTO sim_ids_value
      FROM public.sim_units sim
      WHERE sim.organization_id = p_org_id
        AND sim.id = ANY(requested_sim_ids)
        AND sim.status::text = 'in_stock';
      IF cardinality(sim_ids_value) <> requested_count THEN
        RAISE EXCEPTION 'All requested SIMs must exist in stock.' USING ERRCODE = '55000';
      END IF;
    ELSE
      requested_count := COALESCE(NULLIF(p_payload->>'quantity', '')::integer, 0);
      provider_value := lower(btrim(COALESCE(p_payload->>'provider', '')));
      sim_type_value := NULLIF(lower(btrim(p_payload->>'sim_type')), '');
      IF requested_count < 1 OR requested_count > 1000 OR provider_value = '' THEN
        RAISE EXCEPTION 'A valid quantity and provider are required for SIM assignment.' USING ERRCODE = '23514';
      END IF;
      SELECT COALESCE(array_agg(candidate.id ORDER BY candidate.created_at, candidate.id), ARRAY[]::uuid[])
        INTO sim_ids_value
      FROM (
        SELECT sim.id, sim.created_at
        FROM public.sim_units sim
        WHERE sim.organization_id = p_org_id
          AND sim.status::text = 'in_stock'
          AND sim.provider = provider_value
          AND (sim_type_value IS NULL OR sim.sim_type = sim_type_value)
        ORDER BY sim.created_at, sim.id
        FOR UPDATE SKIP LOCKED
        LIMIT requested_count
      ) candidate;
      IF cardinality(sim_ids_value) <> requested_count THEN
        RAISE EXCEPTION 'Not enough matching SIMs are available in stock.' USING ERRCODE = '55000';
      END IF;
    END IF;

    IF agent_row.max_sim_capacity IS NOT NULL THEN
      SELECT count(*)::integer INTO current_inventory_count
      FROM public.sim_units
      WHERE organization_id = p_org_id
        AND current_agent_id = assigned_agent_id_value
        AND status::text IN ('with_agent', 'with_merchant');
      IF current_inventory_count + requested_count > agent_row.max_sim_capacity THEN
        RAISE EXCEPTION 'Assignment exceeds the agent SIM capacity.' USING ERRCODE = '23514';
      END IF;
    END IF;

    UPDATE public.sim_units SET
      status = 'with_agent', current_agent_id = assigned_agent_id_value,
      current_merchant_id = NULL, assigned_at = now(), version = version + 1,
      updated_at = now()
    WHERE organization_id = p_org_id AND id = ANY(sim_ids_value) AND status::text = 'in_stock';
    GET DIAGNOSTICS updated_count = ROW_COUNT;
    IF updated_count <> requested_count THEN
      RAISE EXCEPTION 'SIM inventory changed during assignment.' USING ERRCODE = '40001';
    END IF;

    INSERT INTO public.sim_transfers (
      organization_id, sim_unit_id, transfer_type, to_agent_id, performed_by, notes
    )
    SELECT p_org_id, sim_id, 'assign_to_agent', assigned_agent_id_value,
      p_actor_user_id, notes_value
    FROM unnest(sim_ids_value) AS sim_id;

    result_value := jsonb_build_object(
      'assigned', requested_count,
      'agent_id', assigned_agent_id_value,
      'sim_unit_ids', to_jsonb(sim_ids_value)
    );
    topic_value := 'sim.inventory_assigned';
    event_payload := jsonb_build_object(
      'event_type', topic_value,
      'command_id', p_command_id,
      'agent_id', assigned_agent_id_value,
      'assigned_count', requested_count,
      'sim_unit_ids', to_jsonb(sim_ids_value),
      'version', 1
    );
    UPDATE public.sim_commerce_commands SET entity_id = assigned_agent_id_value WHERE id = command_row.id;
  END IF;

  INSERT INTO public.business_events (
    org_id, source_type, business_key, event_version, payload, payload_hash,
    status, request_id, actor_user_id, occurred_at, processed_at
  ) VALUES (
    p_org_id, 'sim_inventory', p_command_id::text, 1, event_payload,
    encode(digest(event_payload::text, 'sha256'), 'hex'), 'completed',
    p_request_id, p_actor_user_id, now(), now()
  ) RETURNING id INTO event_id;
  INSERT INTO public.event_outbox (
    org_id, business_event_id, topic, payload, payload_hash
  ) VALUES (
    p_org_id, event_id, topic_value, event_payload,
    encode(digest(event_payload::text, 'sha256'), 'hex')
  );
  INSERT INTO public.operational_audit_logs (
    org_id, request_id, actor_user_id, actor_role, action,
    target_type, target_id, outcome, status_code, metadata
  ) VALUES (
    p_org_id, p_request_id, p_actor_user_id, actor_role_value, topic_value,
    CASE WHEN batch_row.id IS NULL THEN 'sim_inventory' ELSE 'sim_import_batch' END,
    COALESCE(batch_row.id::text, assigned_agent_id_value::text, p_command_id::text),
    'success', 200, result_value
  );
  UPDATE public.sim_commerce_commands SET
    status = 'completed', result = result_value, completed_at = now()
  WHERE id = command_row.id;

  RETURN result_value;
END;
$$;

REVOKE ALL ON FUNCTION public.execute_sim_inventory_command(
  uuid, uuid, uuid, uuid, text, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.execute_sim_inventory_command(
  uuid, uuid, uuid, uuid, text, jsonb
) TO service_role;

COMMENT ON FUNCTION public.execute_sim_inventory_command(uuid, uuid, uuid, uuid, text, jsonb) IS
  'Atomically imports or assigns SIM inventory with idempotency, transfer history, audit, and a durable outbox event.';
