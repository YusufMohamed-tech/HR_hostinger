-- Accept the canonical active profile status regardless of stored letter case.
-- This forward migration intentionally replaces only the customer command function
-- so already-applied migrations remain immutable.

CREATE OR REPLACE FUNCTION public.accounting_save_customer(
  p_org_id uuid,
  p_actor_user_id uuid,
  p_command_id uuid,
  p_request_id uuid,
  p_customer_id uuid,
  p_expected_version integer,
  p_payload jsonb
)
RETURNS SETOF public.accounting_customers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  command_row public.accounting_customer_commands%ROWTYPE;
  customer_row public.accounting_customers%ROWTYPE;
  company_row public.sales_companies%ROWTYPE;
  actor_role_value text;
  action_value text := CASE WHEN p_customer_id IS NULL THEN 'customer_create' ELSE 'customer_update' END;
  payload_hash_value text := encode(digest(jsonb_build_object(
    'customer_id', p_customer_id,
    'expected_version', p_expected_version,
    'payload', p_payload
  )::text, 'sha256'), 'hex');
  target_company_id uuid := NULLIF(p_payload->>'sales_company_id', '')::uuid;
  prior_company_id uuid;
  event_payload jsonb;
  event_id_value uuid;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501';
  END IF;
  SELECT member.role::text INTO actor_role_value
  FROM public.org_members member
  JOIN public.profiles profile
    ON profile.user_id = member.user_id
   AND profile.org_id = member.org_id
   AND lower(btrim(COALESCE(profile.account_status, ''))) = 'active'
  WHERE member.org_id = p_org_id
    AND member.user_id = p_actor_user_id
    AND member.role::text IN ('finance_manager', 'accountant');
  IF actor_role_value IS NULL THEN
    RAISE EXCEPTION 'Accounting management access is required.' USING ERRCODE = '42501';
  END IF;
  IF NULLIF(btrim(p_payload->>'name_ar'), '') IS NULL THEN
    RAISE EXCEPTION 'Customer Arabic name is required.' USING ERRCODE = '23514';
  END IF;
  IF COALESCE((p_payload->>'is_active')::boolean, true) = false THEN
    target_company_id := NULL;
  END IF;

  INSERT INTO public.accounting_customer_commands (
    organization_id, idempotency_key, action, customer_id, payload_hash,
    actor_user_id, request_id
  ) VALUES (
    p_org_id, p_command_id, action_value, p_customer_id, payload_hash_value,
    p_actor_user_id, p_request_id
  )
  ON CONFLICT (organization_id, idempotency_key) DO NOTHING;
  SELECT * INTO command_row
  FROM public.accounting_customer_commands command
  WHERE command.organization_id = p_org_id
    AND command.idempotency_key = p_command_id
  FOR UPDATE;
  IF command_row.action <> action_value
     OR command_row.payload_hash <> payload_hash_value THEN
    RAISE EXCEPTION 'Idempotency key was reused for another accounting customer command.' USING ERRCODE = '23505';
  END IF;
  IF command_row.status = 'completed' THEN
    RETURN QUERY SELECT * FROM public.accounting_customers customer
      WHERE customer.organization_id = p_org_id
        AND customer.id = command_row.customer_id;
    RETURN;
  END IF;

  IF p_customer_id IS NOT NULL THEN
    SELECT * INTO customer_row
    FROM public.accounting_customers customer
    WHERE customer.organization_id = p_org_id
      AND customer.id = p_customer_id
    FOR UPDATE;
    IF customer_row.id IS NULL THEN
      RAISE EXCEPTION 'Accounting customer was not found.' USING ERRCODE = 'P0002';
    END IF;
    IF customer_row.version <> p_expected_version THEN
      RAISE EXCEPTION 'Accounting customer version conflict.' USING ERRCODE = '40001';
    END IF;
    prior_company_id := customer_row.sales_company_id;
  ELSIF p_expected_version <> 0 THEN
    RAISE EXCEPTION 'A new accounting customer must use expected version zero.' USING ERRCODE = '40001';
  END IF;

  -- Lock both the old and new Sales companies in deterministic order before
  -- changing either direction of the relationship.
  PERFORM company.id
  FROM public.sales_companies company
  WHERE company.organization_id = p_org_id
    AND company.id IN (prior_company_id, target_company_id)
  ORDER BY company.id
  FOR UPDATE;

  IF target_company_id IS NOT NULL THEN
    SELECT * INTO company_row
    FROM public.sales_companies company
    WHERE company.organization_id = p_org_id
      AND company.id = target_company_id;
    IF company_row.id IS NULL OR NOT company_row.is_active THEN
      RAISE EXCEPTION 'The linked Sales company must be active and belong to the organization.' USING ERRCODE = '23514';
    END IF;
    IF company_row.accounting_customer_id IS NOT NULL
       AND company_row.accounting_customer_id IS DISTINCT FROM p_customer_id THEN
      RAISE EXCEPTION 'The Sales company is already linked to another accounting customer.' USING ERRCODE = '23505';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.accounting_customers other_customer
      WHERE other_customer.organization_id = p_org_id
        AND other_customer.sales_company_id = target_company_id
        AND other_customer.is_active
        AND other_customer.id IS DISTINCT FROM p_customer_id
    ) THEN
      RAISE EXCEPTION 'The Sales company is already linked to another active accounting customer.' USING ERRCODE = '23505';
    END IF;
  END IF;

  IF p_customer_id IS NULL THEN
    INSERT INTO public.accounting_customers (
      organization_id, sales_company_id, name_ar, name_en, vat_number,
      commercial_registration, phone, email, address, city, country,
      payment_terms, is_active, created_by, version
    ) VALUES (
      p_org_id, target_company_id, btrim(p_payload->>'name_ar'),
      NULLIF(btrim(p_payload->>'name_en'), ''), NULLIF(btrim(p_payload->>'vat_number'), ''),
      NULLIF(btrim(p_payload->>'commercial_registration'), ''), NULLIF(btrim(p_payload->>'phone'), ''),
      NULLIF(btrim(p_payload->>'email'), ''), NULLIF(btrim(p_payload->>'address'), ''),
      NULLIF(btrim(p_payload->>'city'), ''), COALESCE(NULLIF(btrim(p_payload->>'country'), ''), 'Saudi Arabia'),
      NULLIF(btrim(p_payload->>'payment_terms'), ''), COALESCE((p_payload->>'is_active')::boolean, true),
      p_actor_user_id, 0
    ) RETURNING * INTO customer_row;
  ELSE
    UPDATE public.accounting_customers SET
      sales_company_id = target_company_id,
      name_ar = btrim(p_payload->>'name_ar'),
      name_en = NULLIF(btrim(p_payload->>'name_en'), ''),
      vat_number = NULLIF(btrim(p_payload->>'vat_number'), ''),
      commercial_registration = NULLIF(btrim(p_payload->>'commercial_registration'), ''),
      phone = NULLIF(btrim(p_payload->>'phone'), ''),
      email = NULLIF(btrim(p_payload->>'email'), ''),
      address = NULLIF(btrim(p_payload->>'address'), ''),
      city = NULLIF(btrim(p_payload->>'city'), ''),
      country = COALESCE(NULLIF(btrim(p_payload->>'country'), ''), 'Saudi Arabia'),
      payment_terms = NULLIF(btrim(p_payload->>'payment_terms'), ''),
      is_active = COALESCE((p_payload->>'is_active')::boolean, is_active),
      version = version + 1,
      updated_at = now()
    WHERE id = customer_row.id
    RETURNING * INTO customer_row;
  END IF;

  IF prior_company_id IS NOT NULL
     AND prior_company_id IS DISTINCT FROM target_company_id THEN
    UPDATE public.sales_companies
    SET accounting_customer_id = NULL,
        updated_at = now()
    WHERE organization_id = p_org_id
      AND id = prior_company_id
      AND accounting_customer_id = customer_row.id;
  END IF;
  IF target_company_id IS NOT NULL THEN
    UPDATE public.sales_companies
    SET accounting_customer_id = customer_row.id,
        updated_at = now()
    WHERE organization_id = p_org_id
      AND id = target_company_id;
  END IF;

  event_payload := jsonb_build_object(
    'event_type', 'accounting.customer_saved',
    'customer_id', customer_row.id,
    'customer_name', customer_row.name_ar,
    'sales_company_id', customer_row.sales_company_id,
    'prior_sales_company_id', prior_company_id,
    'is_active', customer_row.is_active,
    'version', customer_row.version
  );
  INSERT INTO public.business_events (
    org_id, source_type, business_key, event_version, payload, payload_hash,
    status, request_id, actor_user_id, occurred_at, processed_at
  ) VALUES (
    p_org_id, 'accounting_customer', customer_row.id::text || ':saved:' || customer_row.version::text,
    GREATEST(customer_row.version, 1), event_payload,
    encode(digest(event_payload::text, 'sha256'), 'hex'), 'completed',
    p_request_id, p_actor_user_id, now(), now()
  ) RETURNING id INTO event_id_value;
  INSERT INTO public.event_outbox (
    org_id, business_event_id, topic, payload, payload_hash
  ) VALUES (
    p_org_id, event_id_value, 'accounting.customer_saved', event_payload,
    encode(digest(event_payload::text, 'sha256'), 'hex')
  );
  INSERT INTO public.operational_audit_logs (
    org_id, request_id, actor_user_id, actor_role, action, target_type,
    target_id, outcome, status_code, metadata
  ) VALUES (
    p_org_id, p_request_id, p_actor_user_id, actor_role_value,
    'accounting.customer_saved', 'accounting_customer', customer_row.id::text,
    'success', CASE WHEN p_customer_id IS NULL THEN 201 ELSE 200 END,
    event_payload
  );
  UPDATE public.accounting_customer_commands
  SET customer_id = customer_row.id,
      status = 'completed',
      completed_at = now(),
      result = event_payload
  WHERE id = command_row.id;

  RETURN NEXT customer_row;
END;
$$;

REVOKE ALL ON FUNCTION public.accounting_save_customer(uuid, uuid, uuid, uuid, uuid, integer, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accounting_save_customer(uuid, uuid, uuid, uuid, uuid, integer, jsonb)
  TO service_role;

COMMENT ON TABLE public.accounting_customer_commands IS
  'Replay ledger for atomic accounting-customer and Sales-company relationship commands.';
COMMENT ON FUNCTION public.accounting_save_customer(uuid, uuid, uuid, uuid, uuid, integer, jsonb) IS
  'Creates or updates an accounting customer and both sides of its optional Sales-company link in one transaction.';
