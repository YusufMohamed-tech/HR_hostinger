-- Phase 3: employee custody for finance-managed serialized product inventory.
-- Keeps the legacy field-agent commerce path intact while adding explicit,
-- project/city-scoped OGPM and OGSV1 assignments and employee handovers.

CREATE TABLE IF NOT EXISTS public.product_inventory_operational_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL REFERENCES public.sales_companies(id) ON DELETE RESTRICT,
  location_id uuid REFERENCES public.locations(id) ON DELETE RESTRICT,
  city text NOT NULL CHECK (length(btrim(city)) BETWEEN 1 AND 160),
  position_code text NOT NULL CHECK (upper(btrim(position_code)) IN ('OGPM', 'OGSV1')),
  responsibility text NOT NULL CHECK (responsibility IN ('project_manager', 'supervisor')),
  can_receive_custody boolean NOT NULL DEFAULT true,
  can_sell boolean NOT NULL DEFAULT false,
  can_request_return boolean NOT NULL DEFAULT true,
  can_approve_return boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  effective_from date NOT NULL DEFAULT CURRENT_DATE,
  effective_to date,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  updated_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CHECK (
    (responsibility = 'project_manager' AND upper(btrim(position_code)) = 'OGPM')
    OR (responsibility = 'supervisor' AND upper(btrim(position_code)) = 'OGSV1')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS product_inventory_operational_assignments_active_idx
  ON public.product_inventory_operational_assignments (
    organization_id,
    employee_id,
    project_id,
    COALESCE(location_id, '00000000-0000-0000-0000-000000000000'::uuid),
    upper(btrim(position_code))
  )
  WHERE status = 'active' AND effective_to IS NULL;

CREATE INDEX IF NOT EXISTS product_inventory_operational_assignments_scope_idx
  ON public.product_inventory_operational_assignments (
    organization_id, project_id, city, responsibility, status, effective_from, effective_to
  );

CREATE OR REPLACE FUNCTION public.validate_product_inventory_operational_assignment()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  employee_row public.employees%ROWTYPE;
  project_org_id uuid;
  location_org_id uuid;
  location_city text;
BEGIN
  SELECT * INTO employee_row
  FROM public.employees
  WHERE id = NEW.employee_id;
  IF employee_row.id IS NULL OR employee_row.org_id <> NEW.organization_id THEN
    RAISE EXCEPTION 'Operational assignment employee must belong to the organization.'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'active' AND employee_row.user_id IS NULL THEN
    RAISE EXCEPTION 'An active inventory custodian must have a linked user account.'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'active'
     AND NOT (lower(COALESCE(employee_row.status, '')) = 'active'
              AND COALESCE(employee_row.lifecycle_status, 'active') = 'active') THEN
    RAISE EXCEPTION 'An active inventory custodian must be an active employee.'
      USING ERRCODE = '23514';
  END IF;

  SELECT organization_id INTO project_org_id
  FROM public.sales_companies
  WHERE id = NEW.project_id AND is_active;
  IF project_org_id IS NULL OR project_org_id <> NEW.organization_id THEN
    RAISE EXCEPTION 'Operational assignment project must be active in the organization.'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.location_id IS NOT NULL THEN
    SELECT org_id, NULLIF(btrim(city), '') INTO location_org_id, location_city
    FROM public.locations
    WHERE id = NEW.location_id;
    IF location_org_id IS NULL OR location_org_id <> NEW.organization_id THEN
      RAISE EXCEPTION 'Operational assignment location must belong to the organization.'
        USING ERRCODE = '23514';
    END IF;
    NEW.city := COALESCE(location_city, NULLIF(btrim(NEW.city), ''));
  END IF;
  IF NULLIF(btrim(NEW.city), '') IS NULL THEN
    RAISE EXCEPTION 'Operational assignment city is required.' USING ERRCODE = '23514';
  END IF;
  NEW.city := btrim(NEW.city);
  NEW.position_code := upper(btrim(NEW.position_code));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_product_inventory_operational_assignment
  ON public.product_inventory_operational_assignments;
CREATE TRIGGER trg_validate_product_inventory_operational_assignment
  BEFORE INSERT OR UPDATE ON public.product_inventory_operational_assignments
  FOR EACH ROW EXECUTE FUNCTION public.validate_product_inventory_operational_assignment();

DROP TRIGGER IF EXISTS trg_touch_product_inventory_operational_assignments
  ON public.product_inventory_operational_assignments;
CREATE TRIGGER trg_touch_product_inventory_operational_assignments
  BEFORE UPDATE ON public.product_inventory_operational_assignments
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.product_handovers
  ALTER COLUMN agent_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS handover_type text NOT NULL DEFAULT 'legacy_agent',
  ADD COLUMN IF NOT EXISTS recipient_assignment_id uuid
    REFERENCES public.product_inventory_operational_assignments(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS recipient_employee_id uuid REFERENCES public.employees(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS recipient_user_id_snapshot uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS recipient_name_snapshot text,
  ADD COLUMN IF NOT EXISTS recipient_responsibility_snapshot text,
  ADD COLUMN IF NOT EXISTS position_code_snapshot text,
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.sales_companies(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS project_name_snapshot text,
  ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES public.locations(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS city_snapshot text;

ALTER TABLE public.product_handovers
  DROP CONSTRAINT IF EXISTS product_handovers_handover_type_check,
  DROP CONSTRAINT IF EXISTS product_handovers_recipient_model_check;
ALTER TABLE public.product_handovers
  ADD CONSTRAINT product_handovers_handover_type_check
    CHECK (handover_type IN ('legacy_agent', 'employee_custody')),
  ADD CONSTRAINT product_handovers_recipient_model_check CHECK (
    (handover_type = 'legacy_agent'
      AND agent_id IS NOT NULL
      AND recipient_assignment_id IS NULL
      AND recipient_employee_id IS NULL)
    OR
    (handover_type = 'employee_custody'
      AND agent_id IS NULL
      AND recipient_assignment_id IS NOT NULL
      AND recipient_employee_id IS NOT NULL
      AND recipient_user_id_snapshot IS NOT NULL
      AND NULLIF(btrim(recipient_name_snapshot), '') IS NOT NULL
      AND recipient_responsibility_snapshot IN ('project_manager', 'supervisor')
      AND upper(position_code_snapshot) IN ('OGPM', 'OGSV1')
      AND project_id IS NOT NULL
      AND NULLIF(btrim(project_name_snapshot), '') IS NOT NULL
      AND NULLIF(btrim(city_snapshot), '') IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS product_handovers_employee_scope_idx
  ON public.product_handovers (
    organization_id, handover_type, project_id, city_snapshot, recipient_employee_id, status, issued_at DESC
  )
  WHERE handover_type = 'employee_custody';

ALTER TABLE public.product_handover_signatures
  ALTER COLUMN agent_user_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS recipient_user_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS recipient_type text NOT NULL DEFAULT 'legacy_agent';
ALTER TABLE public.product_handover_signatures
  DROP CONSTRAINT IF EXISTS product_handover_signatures_recipient_type_check,
  DROP CONSTRAINT IF EXISTS product_handover_signatures_recipient_check;
ALTER TABLE public.product_handover_signatures
  ADD CONSTRAINT product_handover_signatures_recipient_type_check
    CHECK (recipient_type IN ('legacy_agent', 'employee_custody')),
  ADD CONSTRAINT product_handover_signatures_recipient_check CHECK (
    (recipient_type = 'legacy_agent' AND agent_user_id IS NOT NULL AND recipient_user_id IS NULL)
    OR (recipient_type = 'employee_custody' AND agent_user_id IS NULL AND recipient_user_id IS NOT NULL)
  );

CREATE UNIQUE INDEX IF NOT EXISTS product_handover_signatures_employee_once_idx
  ON public.product_handover_signatures (handover_id, recipient_user_id)
  WHERE recipient_type = 'employee_custody';

ALTER TABLE public.product_inventory_units
  ADD COLUMN IF NOT EXISTS current_custodian_assignment_id uuid
    REFERENCES public.product_inventory_operational_assignments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS current_custodian_employee_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS current_project_id uuid REFERENCES public.sales_companies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS current_location_id uuid REFERENCES public.locations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS current_city_snapshot text;

ALTER TABLE public.product_inventory_units
  DROP CONSTRAINT IF EXISTS product_inventory_units_status_check,
  DROP CONSTRAINT IF EXISTS product_inventory_units_custody_holder_check;
ALTER TABLE public.product_inventory_units
  ADD CONSTRAINT product_inventory_units_status_check CHECK (status IN (
    'in_stock', 'reserved', 'in_transit', 'with_agent', 'with_custodian',
    'return_pending', 'return_approved', 'sold', 'returned', 'quarantine',
    'damaged', 'lost'
  )),
  ADD CONSTRAINT product_inventory_units_custody_holder_check CHECK (
    NOT (current_agent_id IS NOT NULL AND current_custodian_employee_id IS NOT NULL)
    AND (
      current_custodian_employee_id IS NULL
      OR (current_custodian_assignment_id IS NOT NULL
          AND current_project_id IS NOT NULL
          AND NULLIF(btrim(current_city_snapshot), '') IS NOT NULL)
    )
  );

CREATE INDEX IF NOT EXISTS product_inventory_units_employee_custody_idx
  ON public.product_inventory_units (
    organization_id, current_project_id, current_city_snapshot,
    current_custodian_employee_id, status, product_id
  )
  WHERE current_custodian_employee_id IS NOT NULL;

ALTER TABLE public.product_inventory_movements
  ADD COLUMN IF NOT EXISTS from_custodian_employee_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS to_custodian_employee_id uuid REFERENCES public.employees(id) ON DELETE SET NULL;
ALTER TABLE public.product_inventory_movements
  DROP CONSTRAINT IF EXISTS product_inventory_movements_movement_type_check;
ALTER TABLE public.product_inventory_movements
  ADD CONSTRAINT product_inventory_movements_movement_type_check CHECK (movement_type IN (
    'receipt', 'reserve', 'handover_issued', 'handover_accepted',
    'employee_handover_issued', 'employee_handover_accepted',
    'agent_return', 'sale', 'sale_void', 'customer_return',
    'return_reserved', 'return_rejected', 'return_approved', 'return_received',
    'quarantine', 'damage', 'loss', 'adjustment'
  ));

CREATE TABLE IF NOT EXISTS public.product_inventory_custody_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  idempotency_key uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('employee_handover_issue', 'employee_handover_accept')),
  entity_id uuid,
  payload_hash text NOT NULL CHECK (length(payload_hash) = 64),
  status text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'completed')),
  result jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(result) = 'object'),
  actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  request_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (organization_id, idempotency_key)
);

ALTER TABLE public.product_inventory_operational_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_inventory_custody_commands ENABLE ROW LEVEL SECURITY;

CREATE POLICY product_inventory_operational_assignments_select
  ON public.product_inventory_operational_assignments
  FOR SELECT USING (
    auth.role() = 'service_role'
    OR (
      organization_id = public.current_org_id()
      AND (
        public.can_manage_product_inventory()
        OR employee_id = (
          SELECT employee.id FROM public.employees employee
          WHERE employee.org_id = organization_id AND employee.user_id = auth.uid()
          LIMIT 1
        )
      )
    )
  );

CREATE POLICY product_inventory_custody_commands_service
  ON public.product_inventory_custody_commands
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS product_handovers_select ON public.product_handovers;
CREATE POLICY product_handovers_select ON public.product_handovers
  FOR SELECT USING (
    auth.role() = 'service_role'
    OR (
      organization_id = public.current_org_id()
      AND (
        public.can_view_product_inventory()
        OR agent_id = public.current_field_agent_id()
        OR recipient_user_id_snapshot = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS product_handover_lines_select ON public.product_handover_lines;
CREATE POLICY product_handover_lines_select ON public.product_handover_lines
  FOR SELECT USING (
    auth.role() = 'service_role'
    OR (
      organization_id = public.current_org_id()
      AND (
        public.can_view_product_inventory()
        OR EXISTS (
          SELECT 1 FROM public.product_handovers handover
          WHERE handover.id = handover_id
            AND handover.organization_id = organization_id
            AND (
              handover.agent_id = public.current_field_agent_id()
              OR handover.recipient_user_id_snapshot = auth.uid()
            )
        )
      )
    )
  );

CREATE OR REPLACE FUNCTION public.save_product_inventory_operational_assignment(
  p_org_id uuid,
  p_actor_user_id uuid,
  p_assignment_id uuid,
  p_expected_version integer,
  p_payload jsonb
)
RETURNS public.product_inventory_operational_assignments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_role_value text;
  assignment_row public.product_inventory_operational_assignments%ROWTYPE;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501';
  END IF;
  SELECT member.role::text INTO actor_role_value
  FROM public.org_members member
  WHERE member.org_id = p_org_id AND member.user_id = p_actor_user_id
    AND member.role::text IN ('admin', 'finance_manager')
  LIMIT 1;
  IF actor_role_value IS NULL THEN
    RAISE EXCEPTION 'Finance or administrator authority is required.' USING ERRCODE = '42501';
  END IF;

  IF p_assignment_id IS NULL THEN
    INSERT INTO public.product_inventory_operational_assignments (
      organization_id, employee_id, project_id, location_id, city,
      position_code, responsibility, can_receive_custody, can_sell,
      can_request_return, can_approve_return, status, effective_from,
      effective_to, created_by, updated_by
    ) VALUES (
      p_org_id,
      NULLIF(p_payload->>'employee_id', '')::uuid,
      NULLIF(p_payload->>'project_id', '')::uuid,
      NULLIF(p_payload->>'location_id', '')::uuid,
      p_payload->>'city', p_payload->>'position_code', p_payload->>'responsibility',
      COALESCE(NULLIF(p_payload->>'can_receive_custody', '')::boolean, true),
      COALESCE(NULLIF(p_payload->>'can_sell', '')::boolean, false),
      COALESCE(NULLIF(p_payload->>'can_request_return', '')::boolean, true),
      COALESCE(NULLIF(p_payload->>'can_approve_return', '')::boolean, false),
      COALESCE(NULLIF(p_payload->>'status', ''), 'active'),
      COALESCE(NULLIF(p_payload->>'effective_from', '')::date, CURRENT_DATE),
      NULLIF(p_payload->>'effective_to', '')::date,
      p_actor_user_id, p_actor_user_id
    ) RETURNING * INTO assignment_row;
  ELSE
    SELECT * INTO assignment_row
    FROM public.product_inventory_operational_assignments
    WHERE id = p_assignment_id AND organization_id = p_org_id
    FOR UPDATE;
    IF assignment_row.id IS NULL THEN
      RAISE EXCEPTION 'Operational assignment was not found.' USING ERRCODE = 'P0002';
    END IF;
    IF p_expected_version IS NULL OR assignment_row.version <> p_expected_version THEN
      RAISE EXCEPTION 'Operational assignment was changed by another user.' USING ERRCODE = '40001';
    END IF;
    UPDATE public.product_inventory_operational_assignments
    SET employee_id = COALESCE(NULLIF(p_payload->>'employee_id', '')::uuid, employee_id),
        project_id = COALESCE(NULLIF(p_payload->>'project_id', '')::uuid, project_id),
        location_id = CASE WHEN p_payload ? 'location_id' THEN NULLIF(p_payload->>'location_id', '')::uuid ELSE location_id END,
        city = COALESCE(NULLIF(p_payload->>'city', ''), city),
        position_code = COALESCE(NULLIF(p_payload->>'position_code', ''), position_code),
        responsibility = COALESCE(NULLIF(p_payload->>'responsibility', ''), responsibility),
        can_receive_custody = COALESCE(NULLIF(p_payload->>'can_receive_custody', '')::boolean, can_receive_custody),
        can_sell = COALESCE(NULLIF(p_payload->>'can_sell', '')::boolean, can_sell),
        can_request_return = COALESCE(NULLIF(p_payload->>'can_request_return', '')::boolean, can_request_return),
        can_approve_return = COALESCE(NULLIF(p_payload->>'can_approve_return', '')::boolean, can_approve_return),
        status = COALESCE(NULLIF(p_payload->>'status', ''), status),
        effective_from = COALESCE(NULLIF(p_payload->>'effective_from', '')::date, effective_from),
        effective_to = CASE WHEN p_payload ? 'effective_to' THEN NULLIF(p_payload->>'effective_to', '')::date ELSE effective_to END,
        updated_by = p_actor_user_id,
        version = version + 1
    WHERE id = assignment_row.id
    RETURNING * INTO assignment_row;
  END IF;
  RETURN assignment_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.execute_product_employee_custody_command(
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
  actor_role_value text;
  command_row public.product_inventory_custody_commands%ROWTYPE;
  assignment_row public.product_inventory_operational_assignments%ROWTYPE;
  employee_row public.employees%ROWTYPE;
  warehouse_row public.inventory_warehouses%ROWTYPE;
  handover_row public.product_handovers%ROWTYPE;
  project_name_value text;
  payload_hash_value text;
  units_value jsonb;
  unit_count_value integer;
  require_ack_value boolean;
  entity_id_value uuid;
  result_value jsonb;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501';
  END IF;
  IF p_action NOT IN ('employee_handover_issue', 'employee_handover_accept')
     OR jsonb_typeof(COALESCE(p_payload, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'Unsupported employee custody command.' USING ERRCODE = '22023';
  END IF;

  payload_hash_value := encode(
    digest(jsonb_build_object('action', p_action, 'payload', p_payload)::text, 'sha256'), 'hex'
  );
  entity_id_value := NULLIF(p_payload->>'handover_id', '')::uuid;
  INSERT INTO public.product_inventory_custody_commands (
    organization_id, idempotency_key, action, entity_id, payload_hash,
    actor_user_id, request_id
  ) VALUES (
    p_org_id, p_command_id, p_action, entity_id_value, payload_hash_value,
    p_actor_user_id, p_request_id
  ) ON CONFLICT (organization_id, idempotency_key) DO NOTHING;

  SELECT * INTO command_row
  FROM public.product_inventory_custody_commands
  WHERE organization_id = p_org_id AND idempotency_key = p_command_id
  FOR UPDATE;
  IF command_row.action <> p_action OR command_row.payload_hash <> payload_hash_value
     OR command_row.actor_user_id <> p_actor_user_id THEN
    RAISE EXCEPTION 'Employee custody idempotency key was reused.' USING ERRCODE = '23505';
  END IF;
  IF command_row.status = 'completed' THEN
    RETURN command_row.result;
  END IF;

  SELECT member.role::text INTO actor_role_value
  FROM public.org_members member
  JOIN public.organizations organization ON organization.id = member.org_id
  JOIN public.profiles profile ON profile.user_id = member.user_id AND profile.org_id = member.org_id
  WHERE member.org_id = p_org_id AND member.user_id = p_actor_user_id
    AND lower(COALESCE(organization.status, '')) = 'active'
    AND lower(COALESCE(profile.account_status, '')) = 'active'
  LIMIT 1;
  IF actor_role_value IS NULL THEN
    RAISE EXCEPTION 'Active organization access is required.' USING ERRCODE = '42501';
  END IF;

  PERFORM set_config('app.product_commerce_command', 'trusted', true);

  IF p_action = 'employee_handover_issue' THEN
    IF actor_role_value NOT IN ('admin', 'finance_manager') THEN
      RAISE EXCEPTION 'Only Finance can issue employee custody.' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO assignment_row
    FROM public.product_inventory_operational_assignments assignment
    WHERE assignment.id = NULLIF(p_payload->>'assignment_id', '')::uuid
      AND assignment.organization_id = p_org_id
      AND assignment.status = 'active'
      AND assignment.can_receive_custody
      AND assignment.effective_from <= CURRENT_DATE
      AND (assignment.effective_to IS NULL OR assignment.effective_to >= CURRENT_DATE)
    FOR UPDATE;
    IF assignment_row.id IS NULL THEN
      RAISE EXCEPTION 'An active custody assignment was not found.' USING ERRCODE = 'P0002';
    END IF;
    SELECT * INTO employee_row FROM public.employees
    WHERE id = assignment_row.employee_id AND org_id = p_org_id FOR SHARE;
    IF employee_row.id IS NULL OR employee_row.user_id IS NULL THEN
      RAISE EXCEPTION 'Custodian employee identity is incomplete.' USING ERRCODE = '23514';
    END IF;
    SELECT name INTO project_name_value FROM public.sales_companies
    WHERE id = assignment_row.project_id AND organization_id = p_org_id AND is_active;
    IF project_name_value IS NULL THEN
      RAISE EXCEPTION 'Custody project is not active.' USING ERRCODE = 'P0002';
    END IF;
    SELECT * INTO warehouse_row FROM public.inventory_warehouses
    WHERE id = NULLIF(p_payload->>'warehouse_id', '')::uuid
      AND organization_id = p_org_id AND is_active FOR SHARE;
    IF warehouse_row.id IS NULL THEN
      RAISE EXCEPTION 'Active warehouse was not found.' USING ERRCODE = 'P0002';
    END IF;

    units_value := COALESCE(p_payload->'unit_ids', '[]'::jsonb);
    IF jsonb_typeof(units_value) <> 'array' THEN
      RAISE EXCEPTION 'Handover unit ids must be an array.' USING ERRCODE = '23514';
    END IF;
    unit_count_value := jsonb_array_length(units_value);
    IF unit_count_value < 1 OR unit_count_value > 200 THEN
      RAISE EXCEPTION 'Employee handover must contain between 1 and 200 units.' USING ERRCODE = '23514';
    END IF;
    IF (SELECT count(DISTINCT value) FROM jsonb_array_elements_text(units_value)) <> unit_count_value THEN
      RAISE EXCEPTION 'Handover unit ids must be unique.' USING ERRCODE = '23505';
    END IF;

    PERFORM unit.id FROM public.product_inventory_units unit
    JOIN jsonb_array_elements_text(units_value) item(value) ON unit.id = item.value::uuid
    WHERE unit.organization_id = p_org_id ORDER BY unit.id FOR UPDATE OF unit;
    IF (
      SELECT count(*) FROM public.product_inventory_units unit
      JOIN jsonb_array_elements_text(units_value) item(value) ON unit.id = item.value::uuid
      WHERE unit.organization_id = p_org_id AND unit.warehouse_id = warehouse_row.id
        AND unit.status = 'in_stock' AND unit.current_agent_id IS NULL
        AND unit.current_custodian_employee_id IS NULL AND unit.current_handover_id IS NULL
        AND unit.current_sale_id IS NULL
    ) <> unit_count_value THEN
      RAISE EXCEPTION 'Only available serials in the selected warehouse can be issued.' USING ERRCODE = '55000';
    END IF;

    require_ack_value := COALESCE(NULLIF(p_payload->>'require_acknowledgment', '')::boolean, true);
    INSERT INTO public.product_handovers (
      id, organization_id, handover_no, warehouse_id, agent_id, handover_type,
      recipient_assignment_id, recipient_employee_id, recipient_user_id_snapshot,
      recipient_name_snapshot, recipient_responsibility_snapshot, position_code_snapshot,
      project_id, project_name_snapshot, location_id, city_snapshot,
      status, require_acknowledgment, notes, issued_by, accepted_by, accepted_at
    ) VALUES (
      entity_id_value, p_org_id,
      public.next_product_commerce_number(p_org_id, 'handover', CURRENT_DATE),
      warehouse_row.id, NULL, 'employee_custody',
      assignment_row.id, employee_row.id, employee_row.user_id,
      employee_row.full_name, assignment_row.responsibility, assignment_row.position_code,
      assignment_row.project_id, project_name_value, assignment_row.location_id, assignment_row.city,
      CASE WHEN require_ack_value THEN 'issued' ELSE 'accepted' END,
      require_ack_value, NULLIF(btrim(p_payload->>'notes'), ''), p_actor_user_id,
      CASE WHEN require_ack_value THEN NULL ELSE p_actor_user_id END,
      CASE WHEN require_ack_value THEN NULL ELSE now() END
    ) RETURNING * INTO handover_row;

    INSERT INTO public.product_handover_lines (
      organization_id, handover_id, unit_id, product_id,
      planned_sale_price_snapshot, minimum_sale_price, maximum_sale_price,
      currency, tax_included, line_status, accepted_at
    )
    SELECT p_org_id, handover_row.id, unit.id, unit.product_id,
      unit.planned_sale_price_snapshot,
      COALESCE(unit.minimum_sale_price_snapshot, unit.planned_sale_price_snapshot),
      COALESCE(unit.maximum_sale_price_snapshot, unit.planned_sale_price_snapshot),
      unit.currency, receipt_line.tax_included,
      CASE WHEN handover_row.status = 'accepted' THEN 'accepted' ELSE 'pending' END,
      CASE WHEN handover_row.status = 'accepted' THEN now() END
    FROM public.product_inventory_units unit
    JOIN jsonb_array_elements_text(units_value) item(value) ON unit.id = item.value::uuid
    JOIN public.product_receipt_lines receipt_line ON receipt_line.id = unit.receipt_line_id;

    UPDATE public.product_inventory_units unit
    SET status = CASE WHEN handover_row.status = 'accepted' THEN 'with_custodian' ELSE 'in_transit' END,
        warehouse_id = NULL,
        current_handover_id = handover_row.id,
        current_custodian_assignment_id = assignment_row.id,
        current_custodian_employee_id = employee_row.id,
        current_project_id = assignment_row.project_id,
        current_location_id = assignment_row.location_id,
        current_city_snapshot = assignment_row.city,
        assigned_at = now(), version = version + 1, updated_at = now()
    FROM jsonb_array_elements_text(units_value) item(value)
    WHERE unit.organization_id = p_org_id AND unit.id = item.value::uuid;

    INSERT INTO public.product_inventory_movements (
      organization_id, unit_id, movement_type, from_warehouse_id,
      to_custodian_employee_id, handover_id, reason, performed_by, metadata
    ) SELECT p_org_id, item.value::uuid, 'employee_handover_issued', warehouse_row.id,
      employee_row.id, handover_row.id, NULLIF(btrim(p_payload->>'notes'), ''), p_actor_user_id,
      jsonb_build_object(
        'handover_no', handover_row.handover_no, 'command_id', p_command_id,
        'project_id', assignment_row.project_id, 'city', assignment_row.city,
        'position_code', assignment_row.position_code
      )
    FROM jsonb_array_elements_text(units_value) item(value);

    IF handover_row.status = 'accepted' THEN
      INSERT INTO public.product_inventory_movements (
        organization_id, unit_id, movement_type, to_custodian_employee_id,
        handover_id, reason, performed_by, metadata
      ) SELECT p_org_id, item.value::uuid, 'employee_handover_accepted', employee_row.id,
        handover_row.id, 'Immediate Finance-approved custody', p_actor_user_id,
        jsonb_build_object('handover_no', handover_row.handover_no, 'command_id', p_command_id)
      FROM jsonb_array_elements_text(units_value) item(value);
    END IF;

  ELSE
    SELECT * INTO handover_row FROM public.product_handovers
    WHERE id = entity_id_value AND organization_id = p_org_id
      AND handover_type = 'employee_custody' FOR UPDATE;
    IF handover_row.id IS NULL THEN
      RAISE EXCEPTION 'Employee handover was not found.' USING ERRCODE = 'P0002';
    END IF;
    IF handover_row.recipient_user_id_snapshot <> p_actor_user_id THEN
      RAISE EXCEPTION 'Only the assigned recipient can accept this handover.' USING ERRCODE = '42501';
    END IF;
    IF handover_row.status <> 'issued' THEN
      RAISE EXCEPTION 'Only an issued handover can be accepted.' USING ERRCODE = '55000';
    END IF;
    IF handover_row.version <> NULLIF(p_payload->>'expected_version', '')::integer THEN
      RAISE EXCEPTION 'Handover was changed by another user.' USING ERRCODE = '40001';
    END IF;
    UPDATE public.product_handovers
    SET status = 'accepted', accepted_by = p_actor_user_id, accepted_at = now(),
        version = version + 1, updated_at = now()
    WHERE id = handover_row.id RETURNING * INTO handover_row;
    UPDATE public.product_handover_lines
    SET line_status = 'accepted', accepted_at = now(), updated_at = now()
    WHERE organization_id = p_org_id AND handover_id = handover_row.id AND line_status = 'pending';
    UPDATE public.product_inventory_units
    SET status = 'with_custodian', version = version + 1, updated_at = now()
    WHERE organization_id = p_org_id AND current_handover_id = handover_row.id AND status = 'in_transit';
    INSERT INTO public.product_inventory_movements (
      organization_id, unit_id, movement_type, to_custodian_employee_id,
      handover_id, reason, performed_by, metadata
    ) SELECT p_org_id, line.unit_id, 'employee_handover_accepted', handover_row.recipient_employee_id,
      handover_row.id, NULLIF(btrim(p_payload->>'acceptance_note'), ''), p_actor_user_id,
      jsonb_build_object('handover_no', handover_row.handover_no, 'command_id', p_command_id)
    FROM public.product_handover_lines line
    WHERE line.organization_id = p_org_id AND line.handover_id = handover_row.id;

    IF COALESCE(p_payload->>'signature_data', '') NOT LIKE 'data:image/%'
       OR length(COALESCE(p_payload->>'signature_data', '')) > 1500000 THEN
      RAISE EXCEPTION 'A valid recipient signature is required.' USING ERRCODE = '23514';
    END IF;
    INSERT INTO public.product_handover_signatures (
      handover_id, agent_user_id, recipient_user_id, recipient_type,
      organization_id, signature_data, signed_at
    ) VALUES (
      handover_row.id, NULL, p_actor_user_id, 'employee_custody',
      p_org_id, p_payload->>'signature_data', now()
    );
  END IF;

  result_value := jsonb_build_object(
    'handover', to_jsonb(handover_row),
    'unit_count', (SELECT count(*) FROM public.product_handover_lines line
      WHERE line.organization_id = p_org_id AND line.handover_id = handover_row.id)
  );
  UPDATE public.product_inventory_custody_commands
  SET status = 'completed', result = result_value, entity_id = handover_row.id, completed_at = now()
  WHERE id = command_row.id;
  RETURN result_value;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_product_inventory_employee_custody_report(p_org_id uuid)
RETURNS TABLE (
  assignment_id uuid,
  project_id uuid,
  project_name text,
  city text,
  employee_id uuid,
  recipient_name text,
  responsibility text,
  position_code text,
  received_units bigint,
  ready_to_sell_units bigint,
  return_pending_units bigint,
  awaiting_delivery_units bigint,
  physically_held_units bigint,
  sold_units bigint,
  returned_units bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    assignment.id,
    assignment.project_id,
    project.name,
    assignment.city,
    employee.id,
    employee.full_name,
    assignment.responsibility,
    assignment.position_code,
    count(DISTINCT line.unit_id) FILTER (WHERE handover.status IN ('accepted', 'completed')),
    count(DISTINCT unit.id) FILTER (WHERE unit.status = 'with_custodian'),
    count(DISTINCT unit.id) FILTER (WHERE unit.status = 'return_pending'),
    count(DISTINCT unit.id) FILTER (WHERE unit.status = 'return_approved'),
    count(DISTINCT unit.id) FILTER (WHERE unit.status IN ('with_custodian', 'return_pending', 'return_approved')),
    count(DISTINCT unit.id) FILTER (WHERE unit.status = 'sold'),
    count(DISTINCT line.unit_id) FILTER (WHERE line.line_status = 'returned')
  FROM public.product_inventory_operational_assignments assignment
  JOIN public.employees employee ON employee.id = assignment.employee_id
  JOIN public.sales_companies project ON project.id = assignment.project_id
  LEFT JOIN public.product_handovers handover
    ON handover.organization_id = assignment.organization_id
   AND handover.recipient_assignment_id = assignment.id
  LEFT JOIN public.product_handover_lines line
    ON line.organization_id = assignment.organization_id AND line.handover_id = handover.id
  LEFT JOIN public.product_inventory_units unit
    ON unit.organization_id = assignment.organization_id
   AND unit.current_custodian_assignment_id = assignment.id
   AND unit.id = line.unit_id
  WHERE assignment.organization_id = p_org_id
    AND (
      auth.role() = 'service_role'
      OR p_org_id = public.current_org_id()
    )
  GROUP BY assignment.id, project.name, employee.id, employee.full_name;
$$;

GRANT SELECT ON public.product_inventory_operational_assignments TO authenticated;
GRANT SELECT ON public.product_inventory_operational_assignments TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_inventory_operational_assignments TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.product_inventory_custody_commands TO service_role;
GRANT SELECT, INSERT ON public.product_handover_signatures TO service_role;
GRANT EXECUTE ON FUNCTION public.save_product_inventory_operational_assignment(
  uuid, uuid, uuid, integer, jsonb
) TO service_role;
GRANT EXECUTE ON FUNCTION public.execute_product_employee_custody_command(
  uuid, uuid, uuid, uuid, text, jsonb
) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_product_inventory_employee_custody_report(uuid)
  TO authenticated, service_role;

COMMENT ON TABLE public.product_inventory_operational_assignments IS
  'Explicit project/city inventory eligibility for OGPM and OGSV1 employees.';
COMMENT ON FUNCTION public.execute_product_employee_custody_command(
  uuid, uuid, uuid, uuid, text, jsonb
) IS 'Atomic, idempotent issue/accept flow for Finance-to-employee serialized custody.';
