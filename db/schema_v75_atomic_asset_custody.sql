-- Make asset inventory, custody, acknowledgement, and accounting publication authoritative.

ALTER TABLE public.asset_inventory
  ADD COLUMN IF NOT EXISTS purchase_date date NOT NULL DEFAULT CURRENT_DATE,
  ADD COLUMN IF NOT EXISTS purchase_price numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS paid_immediately boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS useful_life_months integer NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS salvage_value numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS depreciation_method text NOT NULL DEFAULT 'straight_line',
  ADD COLUMN IF NOT EXISTS capitalized_journal_id uuid REFERENCES public.accounting_journal_entries(id),
  ADD COLUMN IF NOT EXISTS last_depreciation_date date,
  ADD COLUMN IF NOT EXISTS months_depreciated integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE public.asset_inventory DROP CONSTRAINT IF EXISTS asset_inventory_financial_values_check;
ALTER TABLE public.asset_inventory ADD CONSTRAINT asset_inventory_financial_values_check CHECK (
  purchase_price >= 0 AND salvage_value >= 0 AND salvage_value <= purchase_price
  AND useful_life_months > 0 AND months_depreciated >= 0 AND months_depreciated <= useful_life_months
  AND depreciation_method = 'straight_line' AND version > 0
);

ALTER TABLE public.employee_assets
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS acknowledgment_signature_name text,
  ADD COLUMN IF NOT EXISTS acknowledgment_signature_hash text,
  ADD COLUMN IF NOT EXISTS acknowledgment_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS acknowledged_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.employee_assets DROP CONSTRAINT IF EXISTS employee_assets_status_check;
ALTER TABLE public.employee_assets ADD CONSTRAINT employee_assets_status_check
  CHECK (status IN ('assigned', 'returned', 'damaged', 'lost', 'transferred'));
ALTER TABLE public.employee_assets DROP CONSTRAINT IF EXISTS employee_assets_version_check;
ALTER TABLE public.employee_assets ADD CONSTRAINT employee_assets_version_check CHECK (version > 0);

CREATE TABLE IF NOT EXISTS public.asset_commands (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('create_inventory', 'assign', 'transition', 'acknowledge')),
  target_id uuid NOT NULL,
  input_hash text NOT NULL CHECK (length(input_hash) = 64),
  request_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'completed')),
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
ALTER TABLE public.asset_commands ENABLE ROW LEVEL SECURITY;
CREATE POLICY asset_commands_service_only ON public.asset_commands FOR ALL
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

CREATE OR REPLACE FUNCTION public.guard_trusted_asset_write()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Asset writes require a trusted command.' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_guard_trusted_asset_inventory_write ON public.asset_inventory;
CREATE TRIGGER trg_guard_trusted_asset_inventory_write BEFORE INSERT OR UPDATE OR DELETE ON public.asset_inventory
  FOR EACH ROW EXECUTE FUNCTION public.guard_trusted_asset_write();
DROP TRIGGER IF EXISTS trg_guard_trusted_employee_asset_write ON public.employee_assets;
CREATE TRIGGER trg_guard_trusted_employee_asset_write BEFORE INSERT OR UPDATE OR DELETE ON public.employee_assets
  FOR EACH ROW EXECUTE FUNCTION public.guard_trusted_asset_write();

CREATE OR REPLACE FUNCTION public.create_asset_inventory(
  p_org_id uuid, p_actor_user_id uuid, p_request_id uuid, p_command_id uuid,
  p_inventory_id uuid, p_payload jsonb
)
RETURNS SETOF public.asset_inventory LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  inventory_row public.asset_inventory%ROWTYPE;
  command_row public.asset_commands%ROWTYPE;
  input_hash_value text;
  event_payload jsonb;
  event_id uuid;
  actor_role_value text;
  location_id_value uuid;
  purchase_price_value numeric(14,2);
  salvage_value_value numeric(14,2);
  useful_life_value integer;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501'; END IF;
  SELECT role::text INTO actor_role_value FROM public.org_members WHERE org_id = p_org_id AND user_id = p_actor_user_id;
  IF actor_role_value NOT IN ('admin', 'hr_admin') THEN RAISE EXCEPTION 'Asset inventory management is forbidden.' USING ERRCODE = '42501'; END IF;
  IF NULLIF(btrim(p_payload->>'asset_name'), '') IS NULL OR NULLIF(btrim(p_payload->>'serial_number'), '') IS NULL THEN
    RAISE EXCEPTION 'Asset name and serial number are required.' USING ERRCODE = '22023';
  END IF;
  location_id_value := NULLIF(p_payload->>'office_location_id', '')::uuid;
  IF location_id_value IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.locations WHERE org_id = p_org_id AND id = location_id_value) THEN
    RAISE EXCEPTION 'Asset location is outside the organization.' USING ERRCODE = '23514';
  END IF;
  purchase_price_value := round(COALESCE(NULLIF(p_payload->>'purchase_price', '')::numeric, 0), 2);
  salvage_value_value := round(COALESCE(NULLIF(p_payload->>'salvage_value', '')::numeric, 0), 2);
  useful_life_value := COALESCE(NULLIF(p_payload->>'useful_life_months', '')::integer, 60);
  IF purchase_price_value < 0 OR salvage_value_value < 0 OR salvage_value_value > purchase_price_value
     OR useful_life_value < 1 OR useful_life_value > 600 THEN
    RAISE EXCEPTION 'Asset financial values are invalid.' USING ERRCODE = '23514';
  END IF;
  input_hash_value := encode(digest(p_payload::text, 'sha256'), 'hex');
  INSERT INTO public.asset_commands (id, org_id, actor_user_id, action, target_id, input_hash, request_id)
  VALUES (p_command_id, p_org_id, p_actor_user_id, 'create_inventory', p_inventory_id, input_hash_value, p_request_id)
  ON CONFLICT (id) DO NOTHING;
  SELECT * INTO command_row FROM public.asset_commands WHERE id = p_command_id FOR UPDATE;
  IF command_row.org_id IS DISTINCT FROM p_org_id OR command_row.actor_user_id IS DISTINCT FROM p_actor_user_id
     OR command_row.action <> 'create_inventory' OR command_row.target_id IS DISTINCT FROM p_inventory_id
     OR command_row.input_hash IS DISTINCT FROM input_hash_value THEN
    RAISE EXCEPTION 'Asset command id was reused with different input.' USING ERRCODE = '23505';
  END IF;
  IF command_row.status = 'completed' THEN
    RETURN QUERY SELECT * FROM public.asset_inventory WHERE org_id = p_org_id AND id = p_inventory_id; RETURN;
  END IF;
  INSERT INTO public.asset_inventory (id, org_id, asset_name, asset_type, serial_number,
    office_location_id, purchase_date, received_date, purchase_price, paid_immediately,
    useful_life_months, salvage_value, notes, status, created_by, updated_by, version)
  VALUES (p_inventory_id, p_org_id, btrim(p_payload->>'asset_name'),
    COALESCE(NULLIF(btrim(p_payload->>'asset_type'), ''), 'Company Asset'), btrim(p_payload->>'serial_number'),
    location_id_value, COALESCE(NULLIF(p_payload->>'purchase_date', '')::date, CURRENT_DATE),
    COALESCE(NULLIF(p_payload->>'purchase_date', '')::date, CURRENT_DATE), purchase_price_value,
    COALESCE((p_payload->>'paid_immediately')::boolean, false), useful_life_value, salvage_value_value,
    NULLIF(btrim(p_payload->>'notes'), ''), 'available', p_actor_user_id, p_actor_user_id, 1)
  RETURNING * INTO inventory_row;
  event_payload := jsonb_build_object('event_type', 'asset.inventory_created', 'inventory_id', inventory_row.id,
    'asset_name', inventory_row.asset_name, 'purchase_price', inventory_row.purchase_price,
    'paid_immediately', inventory_row.paid_immediately, 'actor_user_id', p_actor_user_id, 'version', inventory_row.version);
  INSERT INTO public.business_events (org_id, source_type, business_key, event_version, payload, payload_hash,
    status, request_id, actor_user_id, occurred_at, processed_at)
  VALUES (p_org_id, 'asset', 'inventory:' || p_command_id::text, 1, event_payload,
    encode(digest(event_payload::text, 'sha256'), 'hex'), 'completed', p_request_id, p_actor_user_id, now(), now())
  RETURNING id INTO event_id;
  INSERT INTO public.event_outbox (org_id, business_event_id, topic, payload, payload_hash)
  VALUES (p_org_id, event_id, 'asset.inventory_created', event_payload, encode(digest(event_payload::text, 'sha256'), 'hex'));
  INSERT INTO public.operational_audit_logs (org_id, request_id, actor_user_id, actor_role, action,
    target_type, target_id, outcome, status_code, metadata)
  VALUES (p_org_id, p_request_id, p_actor_user_id, actor_role_value, 'asset.inventory_created',
    'asset_inventory', inventory_row.id::text, 'success', 201,
    jsonb_build_object('serial_number', inventory_row.serial_number, 'purchase_price', inventory_row.purchase_price));
  UPDATE public.asset_commands SET status = 'completed', completed_at = now(), result = to_jsonb(inventory_row)
    WHERE id = p_command_id;
  RETURN NEXT inventory_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.assign_asset_inventory(
  p_org_id uuid, p_actor_user_id uuid, p_request_id uuid, p_command_id uuid,
  p_assignment_id uuid, p_inventory_id uuid, p_employee_id uuid, p_notes text
)
RETURNS SETOF public.employee_assets LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  inventory_row public.asset_inventory%ROWTYPE;
  assignment_row public.employee_assets%ROWTYPE;
  command_row public.asset_commands%ROWTYPE;
  actor_role_value text;
  employee_user_id uuid;
  input_value jsonb;
  input_hash_value text;
  event_payload jsonb;
  event_id uuid;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501'; END IF;
  SELECT role::text INTO actor_role_value FROM public.org_members WHERE org_id = p_org_id AND user_id = p_actor_user_id;
  IF actor_role_value NOT IN ('admin', 'hr_admin') THEN RAISE EXCEPTION 'Asset assignment is forbidden.' USING ERRCODE = '42501'; END IF;
  input_value := jsonb_build_object('assignment_id', p_assignment_id, 'inventory_id', p_inventory_id,
    'employee_id', p_employee_id, 'notes', NULLIF(btrim(p_notes), ''));
  input_hash_value := encode(digest(input_value::text, 'sha256'), 'hex');
  INSERT INTO public.asset_commands (id, org_id, actor_user_id, action, target_id, input_hash, request_id)
  VALUES (p_command_id, p_org_id, p_actor_user_id, 'assign', p_assignment_id, input_hash_value, p_request_id)
  ON CONFLICT (id) DO NOTHING;
  SELECT * INTO command_row FROM public.asset_commands WHERE id = p_command_id FOR UPDATE;
  IF command_row.org_id IS DISTINCT FROM p_org_id OR command_row.actor_user_id IS DISTINCT FROM p_actor_user_id
     OR command_row.action <> 'assign' OR command_row.target_id IS DISTINCT FROM p_assignment_id
     OR command_row.input_hash IS DISTINCT FROM input_hash_value THEN
    RAISE EXCEPTION 'Asset command id was reused with different input.' USING ERRCODE = '23505';
  END IF;
  IF command_row.status = 'completed' THEN
    RETURN QUERY SELECT * FROM public.employee_assets WHERE org_id = p_org_id AND id = p_assignment_id; RETURN;
  END IF;
  SELECT * INTO inventory_row FROM public.asset_inventory WHERE org_id = p_org_id AND id = p_inventory_id FOR UPDATE;
  IF inventory_row.id IS NULL THEN RAISE EXCEPTION 'Asset inventory was not found.' USING ERRCODE = 'P0002'; END IF;
  IF inventory_row.status NOT IN ('available', 'returned') OR inventory_row.current_assignment_id IS NOT NULL THEN
    RAISE EXCEPTION 'Asset inventory is not available for assignment.' USING ERRCODE = '23514';
  END IF;
  SELECT user_id INTO employee_user_id FROM public.employees WHERE org_id = p_org_id AND id = p_employee_id
    AND lifecycle_status = 'active' AND lower(status::text) = 'active';
  IF employee_user_id IS NULL THEN RAISE EXCEPTION 'Active employee was not found.' USING ERRCODE = '23514'; END IF;
  INSERT INTO public.employee_assets (id, org_id, employee_id, inventory_id, asset_name, asset_type,
    serial_number, assigned_date, purchase_date, purchase_price, useful_life_months, salvage_value,
    status, notes, assigned_by, updated_by, version)
  VALUES (p_assignment_id, p_org_id, p_employee_id, inventory_row.id, inventory_row.asset_name,
    inventory_row.asset_type, inventory_row.serial_number, CURRENT_DATE, inventory_row.purchase_date,
    inventory_row.purchase_price, inventory_row.useful_life_months, inventory_row.salvage_value,
    'assigned', NULLIF(btrim(p_notes), ''), p_actor_user_id, p_actor_user_id, 1)
  RETURNING * INTO assignment_row;
  UPDATE public.asset_inventory SET status = 'assigned', current_employee_id = p_employee_id,
    current_assignment_id = assignment_row.id, updated_by = p_actor_user_id, version = version + 1
  WHERE id = inventory_row.id RETURNING * INTO inventory_row;
  event_payload := jsonb_build_object('event_type', 'asset.assigned', 'inventory_id', inventory_row.id,
    'assignment_id', assignment_row.id, 'employee_id', assignment_row.employee_id,
    'employee_user_id', employee_user_id, 'asset_name', assignment_row.asset_name,
    'actor_user_id', p_actor_user_id, 'version', assignment_row.version);
  INSERT INTO public.business_events (org_id, source_type, business_key, payload, payload_hash, status,
    request_id, actor_user_id, occurred_at, processed_at)
  VALUES (p_org_id, 'asset', 'assignment:' || p_command_id::text, event_payload,
    encode(digest(event_payload::text, 'sha256'), 'hex'), 'completed', p_request_id, p_actor_user_id, now(), now())
  RETURNING id INTO event_id;
  INSERT INTO public.event_outbox (org_id, business_event_id, topic, payload, payload_hash)
  VALUES (p_org_id, event_id, 'asset.assigned', event_payload, encode(digest(event_payload::text, 'sha256'), 'hex'));
  INSERT INTO public.operational_audit_logs (org_id, request_id, actor_user_id, actor_role, action,
    target_type, target_id, outcome, status_code, metadata)
  VALUES (p_org_id, p_request_id, p_actor_user_id, actor_role_value, 'asset.assigned',
    'employee_asset', assignment_row.id::text, 'success', 201,
    jsonb_build_object('inventory_id', inventory_row.id, 'employee_id', assignment_row.employee_id));
  UPDATE public.asset_commands SET status = 'completed', completed_at = now(), result = to_jsonb(assignment_row)
    WHERE id = p_command_id;
  RETURN NEXT assignment_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.transition_asset_assignment(
  p_org_id uuid, p_actor_user_id uuid, p_request_id uuid, p_command_id uuid,
  p_assignment_id uuid, p_expected_version integer, p_target_status text
)
RETURNS SETOF public.employee_assets LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  assignment_row public.employee_assets%ROWTYPE;
  inventory_row public.asset_inventory%ROWTYPE;
  command_row public.asset_commands%ROWTYPE;
  actor_role_value text;
  employee_user_id uuid;
  input_value jsonb;
  input_hash_value text;
  event_payload jsonb;
  event_id uuid;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501'; END IF;
  SELECT role::text INTO actor_role_value FROM public.org_members WHERE org_id = p_org_id AND user_id = p_actor_user_id;
  IF actor_role_value NOT IN ('admin', 'hr_admin') THEN RAISE EXCEPTION 'Asset transition is forbidden.' USING ERRCODE = '42501'; END IF;
  IF p_target_status NOT IN ('returned', 'damaged', 'lost') OR p_expected_version < 1 THEN
    RAISE EXCEPTION 'Asset transition input is invalid.' USING ERRCODE = '22023';
  END IF;
  input_value := jsonb_build_object('assignment_id', p_assignment_id, 'expected_version', p_expected_version,
    'target_status', p_target_status);
  input_hash_value := encode(digest(input_value::text, 'sha256'), 'hex');
  INSERT INTO public.asset_commands (id, org_id, actor_user_id, action, target_id, input_hash, request_id)
  VALUES (p_command_id, p_org_id, p_actor_user_id, 'transition', p_assignment_id, input_hash_value, p_request_id)
  ON CONFLICT (id) DO NOTHING;
  SELECT * INTO command_row FROM public.asset_commands WHERE id = p_command_id FOR UPDATE;
  IF command_row.org_id IS DISTINCT FROM p_org_id OR command_row.actor_user_id IS DISTINCT FROM p_actor_user_id
     OR command_row.action <> 'transition' OR command_row.target_id IS DISTINCT FROM p_assignment_id
     OR command_row.input_hash IS DISTINCT FROM input_hash_value THEN
    RAISE EXCEPTION 'Asset command id was reused with different input.' USING ERRCODE = '23505';
  END IF;
  IF command_row.status = 'completed' THEN
    RETURN QUERY SELECT * FROM public.employee_assets WHERE org_id = p_org_id AND id = p_assignment_id; RETURN;
  END IF;
  SELECT * INTO assignment_row FROM public.employee_assets WHERE org_id = p_org_id AND id = p_assignment_id FOR UPDATE;
  IF assignment_row.id IS NULL THEN RAISE EXCEPTION 'Asset assignment was not found.' USING ERRCODE = 'P0002'; END IF;
  IF assignment_row.version <> p_expected_version THEN RAISE EXCEPTION 'Asset assignment version conflict.' USING ERRCODE = '40001'; END IF;
  IF assignment_row.status <> 'assigned' THEN RAISE EXCEPTION 'Only an assigned asset may transition.' USING ERRCODE = '23514'; END IF;
  SELECT * INTO inventory_row FROM public.asset_inventory WHERE org_id = p_org_id AND id = assignment_row.inventory_id FOR UPDATE;
  IF inventory_row.id IS NULL OR inventory_row.current_assignment_id IS DISTINCT FROM assignment_row.id THEN
    RAISE EXCEPTION 'Asset inventory custody pointers are inconsistent.' USING ERRCODE = '23514';
  END IF;
  SELECT user_id INTO employee_user_id FROM public.employees WHERE org_id = p_org_id AND id = assignment_row.employee_id;
  UPDATE public.employee_assets SET status = p_target_status,
    returned_date = CASE WHEN p_target_status = 'returned' THEN CURRENT_DATE ELSE returned_date END,
    returned_by = CASE WHEN p_target_status = 'returned' THEN p_actor_user_id ELSE returned_by END,
    updated_by = p_actor_user_id, version = version + 1, updated_at = now()
  WHERE id = assignment_row.id RETURNING * INTO assignment_row;
  UPDATE public.asset_inventory SET status = p_target_status, current_employee_id = NULL,
    current_assignment_id = NULL, updated_by = p_actor_user_id, version = version + 1
  WHERE id = inventory_row.id RETURNING * INTO inventory_row;
  event_payload := jsonb_build_object('event_type', 'asset.status_changed', 'inventory_id', inventory_row.id,
    'assignment_id', assignment_row.id, 'employee_id', assignment_row.employee_id,
    'employee_user_id', employee_user_id, 'asset_name', assignment_row.asset_name,
    'status', assignment_row.status, 'actor_user_id', p_actor_user_id, 'version', assignment_row.version);
  INSERT INTO public.business_events (org_id, source_type, business_key, event_version, payload, payload_hash,
    status, request_id, actor_user_id, occurred_at, processed_at)
  VALUES (p_org_id, 'asset', 'transition:' || p_command_id::text, assignment_row.version, event_payload,
    encode(digest(event_payload::text, 'sha256'), 'hex'), 'completed', p_request_id, p_actor_user_id, now(), now())
  RETURNING id INTO event_id;
  INSERT INTO public.event_outbox (org_id, business_event_id, topic, payload, payload_hash)
  VALUES (p_org_id, event_id, 'asset.status_changed', event_payload, encode(digest(event_payload::text, 'sha256'), 'hex'));
  INSERT INTO public.operational_audit_logs (org_id, request_id, actor_user_id, actor_role, action,
    target_type, target_id, outcome, status_code, metadata)
  VALUES (p_org_id, p_request_id, p_actor_user_id, actor_role_value, 'asset.status_changed',
    'employee_asset', assignment_row.id::text, 'success', 200,
    jsonb_build_object('inventory_id', inventory_row.id, 'status', assignment_row.status, 'version', assignment_row.version));
  UPDATE public.asset_commands SET status = 'completed', completed_at = now(), result = to_jsonb(assignment_row)
    WHERE id = p_command_id;
  RETURN NEXT assignment_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.acknowledge_asset_assignment(
  p_org_id uuid, p_actor_user_id uuid, p_request_id uuid, p_command_id uuid,
  p_assignment_id uuid, p_expected_version integer, p_signature_name text, p_evidence jsonb
)
RETURNS SETOF public.employee_assets LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  assignment_row public.employee_assets%ROWTYPE;
  command_row public.asset_commands%ROWTYPE;
  actor_role_value text;
  employee_user_id uuid;
  employee_name text;
  input_value jsonb;
  input_hash_value text;
  signature_hash_value text;
  acknowledged_at_value timestamptz := now();
  event_payload jsonb;
  event_id uuid;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501'; END IF;
  IF length(btrim(p_signature_name)) < 2 OR length(btrim(p_signature_name)) > 160
     OR p_expected_version < 1 OR jsonb_typeof(COALESCE(p_evidence, '{}'::jsonb)) <> 'object'
     OR length(COALESCE(p_evidence, '{}'::jsonb)::text) > 4000 THEN
    RAISE EXCEPTION 'Asset acknowledgement evidence is invalid.' USING ERRCODE = '22023';
  END IF;
  input_value := jsonb_build_object('assignment_id', p_assignment_id, 'expected_version', p_expected_version,
    'signature_name', btrim(p_signature_name), 'evidence', COALESCE(p_evidence, '{}'::jsonb));
  input_hash_value := encode(digest(input_value::text, 'sha256'), 'hex');
  INSERT INTO public.asset_commands (id, org_id, actor_user_id, action, target_id, input_hash, request_id)
  VALUES (p_command_id, p_org_id, p_actor_user_id, 'acknowledge', p_assignment_id, input_hash_value, p_request_id)
  ON CONFLICT (id) DO NOTHING;
  SELECT * INTO command_row FROM public.asset_commands WHERE id = p_command_id FOR UPDATE;
  IF command_row.org_id IS DISTINCT FROM p_org_id OR command_row.actor_user_id IS DISTINCT FROM p_actor_user_id
     OR command_row.action <> 'acknowledge' OR command_row.target_id IS DISTINCT FROM p_assignment_id
     OR command_row.input_hash IS DISTINCT FROM input_hash_value THEN
    RAISE EXCEPTION 'Asset command id was reused with different input.' USING ERRCODE = '23505';
  END IF;
  IF command_row.status = 'completed' THEN
    RETURN QUERY SELECT * FROM public.employee_assets WHERE org_id = p_org_id AND id = p_assignment_id; RETURN;
  END IF;
  SELECT * INTO assignment_row FROM public.employee_assets WHERE org_id = p_org_id AND id = p_assignment_id FOR UPDATE;
  IF assignment_row.id IS NULL THEN RAISE EXCEPTION 'Asset assignment was not found.' USING ERRCODE = 'P0002'; END IF;
  IF assignment_row.version <> p_expected_version THEN RAISE EXCEPTION 'Asset assignment version conflict.' USING ERRCODE = '40001'; END IF;
  IF assignment_row.status <> 'assigned' OR assignment_row.acknowledged_at IS NOT NULL THEN
    RAISE EXCEPTION 'Asset is not awaiting acknowledgement.' USING ERRCODE = '23514';
  END IF;
  SELECT role::text INTO actor_role_value FROM public.org_members WHERE org_id = p_org_id AND user_id = p_actor_user_id;
  SELECT user_id, full_name INTO employee_user_id, employee_name FROM public.employees
    WHERE org_id = p_org_id AND id = assignment_row.employee_id;
  IF employee_user_id IS DISTINCT FROM p_actor_user_id AND actor_role_value NOT IN ('admin', 'hr_admin') THEN
    RAISE EXCEPTION 'Only the assigned employee may acknowledge this asset.' USING ERRCODE = '42501';
  END IF;
  signature_hash_value := encode(digest(concat_ws('|', p_org_id, p_assignment_id, p_actor_user_id,
    btrim(p_signature_name), acknowledged_at_value::text, COALESCE(p_evidence, '{}'::jsonb)::text), 'sha256'), 'hex');
  UPDATE public.employee_assets SET acknowledgment_signature_name = btrim(p_signature_name),
    acknowledgment_signature_hash = signature_hash_value,
    acknowledgment_signature_url = 'database-evidence:' || signature_hash_value,
    acknowledgment_evidence = COALESCE(p_evidence, '{}'::jsonb) || jsonb_build_object('consent', true),
    acknowledged_by = p_actor_user_id, acknowledged_at = acknowledged_at_value,
    updated_by = p_actor_user_id, version = version + 1, updated_at = now()
  WHERE id = assignment_row.id RETURNING * INTO assignment_row;
  event_payload := jsonb_build_object('event_type', 'asset.acknowledged', 'assignment_id', assignment_row.id,
    'inventory_id', assignment_row.inventory_id, 'employee_id', assignment_row.employee_id,
    'employee_user_id', employee_user_id, 'employee_name', employee_name,
    'asset_name', assignment_row.asset_name, 'signature_hash', signature_hash_value,
    'actor_user_id', p_actor_user_id, 'version', assignment_row.version);
  INSERT INTO public.business_events (org_id, source_type, business_key, event_version, payload, payload_hash,
    status, request_id, actor_user_id, occurred_at, processed_at)
  VALUES (p_org_id, 'asset', 'acknowledgement:' || p_command_id::text, assignment_row.version, event_payload,
    encode(digest(event_payload::text, 'sha256'), 'hex'), 'completed', p_request_id, p_actor_user_id, now(), now())
  RETURNING id INTO event_id;
  INSERT INTO public.event_outbox (org_id, business_event_id, topic, payload, payload_hash)
  VALUES (p_org_id, event_id, 'asset.acknowledged', event_payload, encode(digest(event_payload::text, 'sha256'), 'hex'));
  INSERT INTO public.operational_audit_logs (org_id, request_id, actor_user_id, actor_role, action,
    target_type, target_id, outcome, status_code, metadata)
  VALUES (p_org_id, p_request_id, p_actor_user_id, COALESCE(actor_role_value, 'employee'), 'asset.acknowledged',
    'employee_asset', assignment_row.id::text, 'success', 200,
    jsonb_build_object('signature_hash', signature_hash_value, 'version', assignment_row.version));
  UPDATE public.asset_commands SET status = 'completed', completed_at = now(), result = to_jsonb(assignment_row)
    WHERE id = p_command_id;
  RETURN NEXT assignment_row;
END;
$$;

REVOKE ALL ON FUNCTION public.create_asset_inventory(uuid, uuid, uuid, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.assign_asset_inventory(uuid, uuid, uuid, uuid, uuid, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.transition_asset_assignment(uuid, uuid, uuid, uuid, uuid, integer, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.acknowledge_asset_assignment(uuid, uuid, uuid, uuid, uuid, integer, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_asset_inventory(uuid, uuid, uuid, uuid, uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.assign_asset_inventory(uuid, uuid, uuid, uuid, uuid, uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.transition_asset_assignment(uuid, uuid, uuid, uuid, uuid, integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.acknowledge_asset_assignment(uuid, uuid, uuid, uuid, uuid, integer, text, jsonb) TO service_role;
