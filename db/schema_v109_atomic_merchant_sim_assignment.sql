-- Atomic agent-to-merchant SIM handover.

ALTER TABLE public.sim_commerce_commands
  DROP CONSTRAINT IF EXISTS sim_commerce_commands_action_check;
ALTER TABLE public.sim_commerce_commands
  ADD CONSTRAINT sim_commerce_commands_action_check CHECK (
    action IN (
      'sale', 'return', 'void', 'commission_settle',
      'inventory_import', 'inventory_box_import', 'inventory_assign',
      'inventory_merchant_assign'
    )
  );

CREATE OR REPLACE FUNCTION public.assign_sim_inventory_to_merchant(
  p_org_id uuid,
  p_actor_user_id uuid,
  p_request_id uuid,
  p_command_id uuid,
  p_merchant_id uuid,
  p_sim_ids jsonb,
  p_quantity integer,
  p_provider text,
  p_sim_type text,
  p_notes text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  command_row public.sim_commerce_commands%ROWTYPE;
  merchant_row public.merchants%ROWTYPE;
  agent_row public.field_agents%ROWTYPE;
  actor_role_value text;
  payload_value jsonb := jsonb_build_object(
    'merchant_id', p_merchant_id,
    'sim_ids', COALESCE(p_sim_ids, '[]'::jsonb),
    'quantity', p_quantity,
    'provider', NULLIF(lower(btrim(p_provider)), ''),
    'sim_type', NULLIF(lower(btrim(p_sim_type)), ''),
    'notes', NULLIF(btrim(p_notes), '')
  );
  hash_value text;
  requested_ids uuid[] := ARRAY[]::uuid[];
  selected_ids uuid[] := ARRAY[]::uuid[];
  requested_count integer;
  updated_count integer;
  event_payload jsonb;
  event_id uuid;
  result_value jsonb;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501';
  END IF;
  SELECT member.role::text INTO actor_role_value
  FROM public.org_members member
  JOIN public.organizations organization ON organization.id = member.org_id
  JOIN public.profiles profile ON profile.user_id = member.user_id AND profile.org_id = member.org_id
  WHERE member.org_id = p_org_id AND member.user_id = p_actor_user_id
    AND member.role::text IN ('admin', 'sales_manager', 'onground_agent_manager', 'field_agent')
    AND lower(COALESCE(organization.status, '')) = 'active'
    AND lower(COALESCE(profile.account_status, 'active')) = 'active'
  LIMIT 1;
  IF actor_role_value IS NULL THEN
    RAISE EXCEPTION 'Agent or field-agent management access is required.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO merchant_row FROM public.merchants
  WHERE organization_id = p_org_id AND id = p_merchant_id FOR UPDATE;
  IF merchant_row.id IS NULL THEN RAISE EXCEPTION 'Merchant was not found.' USING ERRCODE = 'P0002'; END IF;
  IF merchant_row.status <> 'active' THEN
    RAISE EXCEPTION 'Cannot assign SIMs to a suspended merchant.' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO agent_row FROM public.field_agents
  WHERE organization_id = p_org_id AND id = merchant_row.agent_id FOR UPDATE;
  IF agent_row.id IS NULL OR agent_row.status <> 'active' THEN
    RAISE EXCEPTION 'Merchant owner agent is missing or suspended.' USING ERRCODE = '55000';
  END IF;
  IF actor_role_value = 'field_agent' AND agent_row.user_id <> p_actor_user_id THEN
    RAISE EXCEPTION 'An agent can only assign inventory to their own merchants.' USING ERRCODE = '42501';
  END IF;

  hash_value := encode(digest(payload_value::text, 'sha256'), 'hex');
  INSERT INTO public.sim_commerce_commands (
    organization_id, idempotency_key, action, entity_id, payload_hash,
    actor_user_id, request_id
  ) VALUES (
    p_org_id, p_command_id, 'inventory_merchant_assign', p_merchant_id,
    hash_value, p_actor_user_id, p_request_id
  ) ON CONFLICT (organization_id, idempotency_key) DO NOTHING;
  SELECT * INTO command_row FROM public.sim_commerce_commands
  WHERE organization_id = p_org_id AND idempotency_key = p_command_id FOR UPDATE;
  IF command_row.action <> 'inventory_merchant_assign' OR command_row.payload_hash <> hash_value
     OR command_row.actor_user_id IS DISTINCT FROM p_actor_user_id THEN
    RAISE EXCEPTION 'Idempotency key was reused for a different merchant SIM command.'
      USING ERRCODE = '23505';
  END IF;
  IF command_row.status = 'completed' THEN RETURN command_row.result; END IF;

  IF jsonb_typeof(COALESCE(p_sim_ids, '[]'::jsonb)) = 'array'
     AND jsonb_array_length(COALESCE(p_sim_ids, '[]'::jsonb)) > 0 THEN
    requested_count := jsonb_array_length(p_sim_ids);
    IF requested_count > 1000 THEN
      RAISE EXCEPTION 'A merchant SIM assignment cannot exceed 1000 rows.' USING ERRCODE = '23514';
    END IF;
    SELECT COALESCE(array_agg(item.value::uuid ORDER BY item.value), ARRAY[]::uuid[])
      INTO requested_ids
    FROM jsonb_array_elements_text(p_sim_ids) AS item(value);
    IF cardinality(ARRAY(SELECT DISTINCT unnest(requested_ids))) <> requested_count THEN
      RAISE EXCEPTION 'Merchant SIM assignment ids must be unique.' USING ERRCODE = '23505';
    END IF;
    PERFORM 1 FROM public.sim_units sim
    WHERE sim.organization_id = p_org_id AND sim.id = ANY(requested_ids)
    ORDER BY sim.id FOR UPDATE;
    SELECT COALESCE(array_agg(sim.id ORDER BY sim.id), ARRAY[]::uuid[])
      INTO selected_ids
    FROM public.sim_units sim
    WHERE sim.organization_id = p_org_id AND sim.id = ANY(requested_ids)
      AND sim.status::text = 'with_agent' AND sim.current_agent_id = agent_row.id;
    IF cardinality(selected_ids) <> requested_count THEN
      RAISE EXCEPTION 'All requested SIMs must be held by the merchant owner agent.' USING ERRCODE = '55000';
    END IF;
  ELSE
    requested_count := COALESCE(p_quantity, 0);
    IF requested_count < 1 OR requested_count > 1000 OR NULLIF(btrim(p_provider), '') IS NULL THEN
      RAISE EXCEPTION 'A valid quantity and provider are required.' USING ERRCODE = '23514';
    END IF;
    SELECT COALESCE(array_agg(candidate.id ORDER BY candidate.assigned_at, candidate.id), ARRAY[]::uuid[])
      INTO selected_ids
    FROM (
      SELECT sim.id, sim.assigned_at
      FROM public.sim_units sim
      WHERE sim.organization_id = p_org_id
        AND sim.status::text = 'with_agent'
        AND sim.current_agent_id = agent_row.id
        AND sim.provider = lower(btrim(p_provider))
        AND (NULLIF(lower(btrim(p_sim_type)), '') IS NULL
          OR sim.sim_type = lower(btrim(p_sim_type)))
      ORDER BY sim.assigned_at, sim.id
      FOR UPDATE SKIP LOCKED
      LIMIT requested_count
    ) candidate;
    IF cardinality(selected_ids) <> requested_count THEN
      RAISE EXCEPTION 'Not enough matching SIMs are available in the agent inventory.' USING ERRCODE = '55000';
    END IF;
  END IF;

  UPDATE public.sim_units SET
    status = 'with_merchant', current_merchant_id = merchant_row.id,
    merchant_assigned_at = now(), version = version + 1, updated_at = now()
  WHERE organization_id = p_org_id AND id = ANY(selected_ids)
    AND status::text = 'with_agent' AND current_agent_id = agent_row.id;
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  IF updated_count <> requested_count THEN
    RAISE EXCEPTION 'SIM inventory changed during merchant handover.' USING ERRCODE = '40001';
  END IF;
  INSERT INTO public.sim_transfers (
    organization_id, sim_unit_id, transfer_type, from_agent_id,
    to_merchant_id, performed_by, notes
  )
  SELECT p_org_id, sim_id, 'assign_to_merchant', agent_row.id,
    merchant_row.id, p_actor_user_id, NULLIF(btrim(p_notes), '')
  FROM unnest(selected_ids) AS sim_id;

  result_value := jsonb_build_object(
    'assigned', requested_count, 'merchant_id', merchant_row.id,
    'agent_id', agent_row.id, 'sim_unit_ids', to_jsonb(selected_ids)
  );
  event_payload := jsonb_build_object(
    'event_type', 'sim.inventory_assigned_to_merchant',
    'command_id', p_command_id, 'merchant_id', merchant_row.id,
    'agent_id', agent_row.id, 'assigned_count', requested_count,
    'sim_unit_ids', to_jsonb(selected_ids), 'version', 1
  );
  INSERT INTO public.business_events (
    org_id, source_type, business_key, event_version, payload, payload_hash,
    status, request_id, actor_user_id, occurred_at, processed_at
  ) VALUES (
    p_org_id, 'sim_inventory', p_command_id::text, 1, event_payload,
    encode(digest(event_payload::text, 'sha256'), 'hex'), 'completed',
    p_request_id, p_actor_user_id, now(), now()
  ) RETURNING id INTO event_id;
  INSERT INTO public.event_outbox (org_id, business_event_id, topic, payload, payload_hash)
  VALUES (p_org_id, event_id, 'sim.inventory_assigned_to_merchant', event_payload,
    encode(digest(event_payload::text, 'sha256'), 'hex'));
  INSERT INTO public.operational_audit_logs (
    org_id, request_id, actor_user_id, actor_role, action, target_type,
    target_id, outcome, status_code, metadata
  ) VALUES (
    p_org_id, p_request_id, p_actor_user_id, actor_role_value,
    'sim.inventory_assigned_to_merchant', 'merchant', merchant_row.id::text,
    'success', 200, result_value
  );
  UPDATE public.sim_commerce_commands SET
    status = 'completed', result = result_value, completed_at = now()
  WHERE id = command_row.id;
  RETURN result_value;
END;
$$;

REVOKE ALL ON FUNCTION public.assign_sim_inventory_to_merchant(
  uuid, uuid, uuid, uuid, uuid, jsonb, integer, text, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assign_sim_inventory_to_merchant(
  uuid, uuid, uuid, uuid, uuid, jsonb, integer, text, text, text
) TO service_role;

COMMENT ON FUNCTION public.assign_sim_inventory_to_merchant(uuid, uuid, uuid, uuid, uuid, jsonb, integer, text, text, text) IS
  'Locks agent inventory and atomically hands SIMs to an owned merchant with transfer history, audit, and outbox evidence.';
