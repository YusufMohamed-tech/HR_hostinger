-- Phase 4: evidence-backed returns for employee-held serialized inventory.
-- Approval removes sale availability; only a Finance physical scan clears custody.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'product-return-evidence', 'product-return-evidence', false, 8388608,
  ARRAY['image/jpeg', 'image/png', 'image/webp']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS product_return_evidence_storage_select ON storage.objects;
CREATE POLICY product_return_evidence_storage_select ON storage.objects
  FOR SELECT USING (bucket_id = 'product-return-evidence' AND auth.role() = 'service_role');
DROP POLICY IF EXISTS product_return_evidence_storage_insert ON storage.objects;
CREATE POLICY product_return_evidence_storage_insert ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'product-return-evidence' AND auth.role() = 'service_role');
DROP POLICY IF EXISTS product_return_evidence_storage_update ON storage.objects;
CREATE POLICY product_return_evidence_storage_update ON storage.objects
  FOR UPDATE USING (bucket_id = 'product-return-evidence' AND auth.role() = 'service_role')
  WITH CHECK (bucket_id = 'product-return-evidence' AND auth.role() = 'service_role');
DROP POLICY IF EXISTS product_return_evidence_storage_delete ON storage.objects;
CREATE POLICY product_return_evidence_storage_delete ON storage.objects
  FOR DELETE USING (bucket_id = 'product-return-evidence' AND auth.role() = 'service_role');

ALTER TABLE public.managed_files DROP CONSTRAINT IF EXISTS managed_files_owner_type_check;
ALTER TABLE public.managed_files ADD CONSTRAINT managed_files_owner_type_check CHECK (
  owner_type IN (
    'personnel_file', 'employee_contract', 'employee_document',
    'candidate_application_cv', 'candidate_application_attachment',
    'product_inventory_workbook', 'product_inventory_photo',
    'product_return_evidence'
  )
);

ALTER TABLE public.product_inventory_commerce_settings
  ADD COLUMN IF NOT EXISTS return_approval_mode text NOT NULL DEFAULT 'both',
  ADD COLUMN IF NOT EXISTS finance_receipt_required boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS require_return_photo boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS minimum_return_photos integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS maximum_return_photos integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS default_return_warehouse_id uuid
    REFERENCES public.inventory_warehouses(id) ON DELETE SET NULL;
ALTER TABLE public.product_inventory_commerce_settings
  DROP CONSTRAINT IF EXISTS product_inventory_commerce_settings_return_mode_check,
  DROP CONSTRAINT IF EXISTS product_inventory_commerce_settings_return_photo_check,
  DROP CONSTRAINT IF EXISTS product_inventory_commerce_settings_finance_receipt_check;
ALTER TABLE public.product_inventory_commerce_settings
  ADD CONSTRAINT product_inventory_commerce_settings_return_mode_check
    CHECK (return_approval_mode IN ('both', 'project_manager', 'finance_manager', 'either')),
  ADD CONSTRAINT product_inventory_commerce_settings_return_photo_check
    CHECK (minimum_return_photos BETWEEN 0 AND 3
      AND maximum_return_photos BETWEEN 1 AND 3
      AND minimum_return_photos <= maximum_return_photos),
  ADD CONSTRAINT product_inventory_commerce_settings_finance_receipt_check
    CHECK (finance_receipt_required = true);

CREATE TABLE IF NOT EXISTS public.product_return_number_sequences (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  sequence_year integer NOT NULL,
  last_number integer NOT NULL DEFAULT 0 CHECK (last_number >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, sequence_year)
);

CREATE OR REPLACE FUNCTION public.next_product_return_number(p_org_id uuid, p_business_date date)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  year_value integer := EXTRACT(YEAR FROM COALESCE(p_business_date, CURRENT_DATE))::integer;
  sequence_value integer;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.product_return_number_sequences (organization_id, sequence_year, last_number)
  VALUES (p_org_id, year_value, 1)
  ON CONFLICT (organization_id, sequence_year) DO UPDATE SET
    last_number = public.product_return_number_sequences.last_number + 1,
    updated_at = now()
  RETURNING last_number INTO sequence_value;
  RETURN 'PR-' || year_value::text || '-' || lpad(sequence_value::text, 6, '0');
END;
$$;

CREATE TABLE IF NOT EXISTS public.product_return_requests (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  return_no text NOT NULL,
  requester_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  requester_employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
  custodian_assignment_id uuid NOT NULL
    REFERENCES public.product_inventory_operational_assignments(id) ON DELETE RESTRICT,
  custodian_employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL REFERENCES public.sales_companies(id) ON DELETE RESTRICT,
  project_name_snapshot text NOT NULL,
  location_id uuid REFERENCES public.locations(id) ON DELETE SET NULL,
  city_snapshot text NOT NULL,
  position_code_snapshot text NOT NULL,
  warehouse_id uuid NOT NULL REFERENCES public.inventory_warehouses(id) ON DELETE RESTRICT,
  approval_mode_snapshot text NOT NULL CHECK (
    approval_mode_snapshot IN ('both', 'project_manager', 'finance_manager', 'either')
  ),
  status text NOT NULL CHECK (status IN (
    'pending_approval', 'approved_awaiting_delivery', 'rejected',
    'partially_received', 'received', 'cancelled'
  )),
  reason_summary text NOT NULL CHECK (length(btrim(reason_summary)) BETWEEN 3 AND 2000),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  rejected_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, return_no)
);

CREATE TABLE IF NOT EXISTS public.product_return_request_lines (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  return_request_id uuid NOT NULL REFERENCES public.product_return_requests(id) ON DELETE RESTRICT,
  unit_id uuid NOT NULL REFERENCES public.product_inventory_units(id) ON DELETE RESTRICT,
  handover_id uuid NOT NULL REFERENCES public.product_handovers(id) ON DELETE RESTRICT,
  serial_snapshot text NOT NULL,
  product_name_snapshot text NOT NULL,
  requester_note text NOT NULL CHECK (length(btrim(requester_note)) BETWEEN 3 AND 2000),
  claimed_condition text NOT NULL CHECK (
    claimed_condition IN ('sealed', 'good', 'open_box', 'damaged', 'unknown')
  ),
  status text NOT NULL CHECK (status IN (
    'pending', 'awaiting_delivery', 'rejected', 'cancelled',
    'received_sellable', 'received_quarantine', 'received_damaged'
  )),
  requested_at timestamptz NOT NULL DEFAULT now(),
  received_at timestamptz,
  received_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  inspection_note text,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (return_request_id, unit_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS product_return_request_lines_one_open_unit_idx
  ON public.product_return_request_lines (organization_id, unit_id)
  WHERE status IN ('pending', 'awaiting_delivery');

CREATE TABLE IF NOT EXISTS public.product_return_attachments (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  return_request_id uuid NOT NULL REFERENCES public.product_return_requests(id) ON DELETE RESTRICT,
  return_line_id uuid NOT NULL REFERENCES public.product_return_request_lines(id) ON DELETE RESTRICT,
  managed_file_id uuid NOT NULL UNIQUE REFERENCES public.managed_files(id) ON DELETE RESTRICT,
  original_name text NOT NULL,
  detected_mime text NOT NULL CHECK (detected_mime IN ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes bigint NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 8388608),
  sha256 text NOT NULL CHECK (length(sha256) = 64),
  evidence_type text NOT NULL CHECK (evidence_type IN ('requester_photo', 'finance_inspection_photo')),
  captured_at timestamptz,
  uploaded_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.product_return_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  return_request_id uuid NOT NULL REFERENCES public.product_return_requests(id) ON DELETE RESTRICT,
  approver_type text NOT NULL CHECK (approver_type IN ('finance_manager', 'project_manager')),
  assigned_approver_user_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  assigned_approver_assignment_id uuid
    REFERENCES public.product_inventory_operational_assignments(id) ON DELETE RESTRICT,
  decision text NOT NULL DEFAULT 'pending' CHECK (decision IN ('pending', 'approved', 'rejected')),
  decision_note text,
  decided_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (return_request_id, approver_type)
);

CREATE TABLE IF NOT EXISTS public.product_return_receipts (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  return_request_id uuid NOT NULL REFERENCES public.product_return_requests(id) ON DELETE RESTRICT,
  warehouse_id uuid NOT NULL REFERENCES public.inventory_warehouses(id) ON DELETE RESTRICT,
  received_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  received_at timestamptz NOT NULL DEFAULT now(),
  notes text,
  request_id uuid NOT NULL,
  command_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'discrepancy')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, command_id)
);

CREATE TABLE IF NOT EXISTS public.product_return_receipt_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  receipt_id uuid NOT NULL REFERENCES public.product_return_receipts(id) ON DELETE RESTRICT,
  request_line_id uuid NOT NULL UNIQUE REFERENCES public.product_return_request_lines(id) ON DELETE RESTRICT,
  unit_id uuid NOT NULL REFERENCES public.product_inventory_units(id) ON DELETE RESTRICT,
  scanned_serial text NOT NULL,
  disposition text NOT NULL CHECK (disposition IN ('sellable', 'quarantine', 'damaged')),
  condition_received text NOT NULL CHECK (
    condition_received IN ('sealed', 'good', 'open_box', 'damaged', 'unknown')
  ),
  inspection_note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.product_inventory_units
  ADD COLUMN IF NOT EXISTS active_return_request_line_id uuid
    REFERENCES public.product_return_request_lines(id) ON DELETE SET NULL;
ALTER TABLE public.product_inventory_movements
  ADD COLUMN IF NOT EXISTS return_request_id uuid REFERENCES public.product_return_requests(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS return_request_line_id uuid
    REFERENCES public.product_return_request_lines(id) ON DELETE SET NULL;

ALTER TABLE public.product_inventory_custody_commands
  DROP CONSTRAINT IF EXISTS product_inventory_custody_commands_action_check;
ALTER TABLE public.product_inventory_custody_commands
  ADD CONSTRAINT product_inventory_custody_commands_action_check CHECK (action IN (
    'employee_handover_issue', 'employee_handover_accept',
    'return_request_submit', 'return_request_review', 'return_request_cancel',
    'return_physical_receive'
  ));

CREATE INDEX IF NOT EXISTS product_return_requests_scope_status_idx
  ON public.product_return_requests (
    organization_id, project_id, city_snapshot, custodian_employee_id, status, submitted_at DESC
  );
CREATE INDEX IF NOT EXISTS product_return_request_lines_request_status_idx
  ON public.product_return_request_lines (organization_id, return_request_id, status, created_at);
CREATE INDEX IF NOT EXISTS product_return_approvals_assignee_idx
  ON public.product_return_approvals (
    organization_id, assigned_approver_user_id, decision, created_at DESC
  );
CREATE INDEX IF NOT EXISTS product_return_attachments_line_idx
  ON public.product_return_attachments (organization_id, return_line_id, created_at);
CREATE INDEX IF NOT EXISTS product_inventory_movements_return_idx
  ON public.product_inventory_movements (organization_id, return_request_id, movement_at DESC)
  WHERE return_request_id IS NOT NULL;

ALTER TABLE public.product_return_number_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_return_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_return_request_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_return_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_return_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_return_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_return_receipt_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY product_return_number_sequences_service ON public.product_return_number_sequences
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
CREATE POLICY product_return_requests_select ON public.product_return_requests
  FOR SELECT USING (
    auth.role() = 'service_role'
    OR (
      organization_id = public.current_org_id()
      AND (
        public.can_view_product_inventory()
        OR requester_user_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.product_return_approvals approval
          WHERE approval.return_request_id = id
            AND approval.assigned_approver_user_id = auth.uid()
        )
      )
    )
  );
CREATE POLICY product_return_request_lines_select ON public.product_return_request_lines
  FOR SELECT USING (
    auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1 FROM public.product_return_requests request
      WHERE request.id = return_request_id
        AND request.organization_id = organization_id
        AND (
          request.requester_user_id = auth.uid()
          OR public.can_view_product_inventory()
          OR EXISTS (
            SELECT 1 FROM public.product_return_approvals approval
            WHERE approval.return_request_id = request.id
              AND approval.assigned_approver_user_id = auth.uid()
          )
        )
    )
  );
CREATE POLICY product_return_attachments_select ON public.product_return_attachments
  FOR SELECT USING (
    auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1 FROM public.product_return_requests request
      WHERE request.id = return_request_id
        AND request.organization_id = organization_id
        AND (
          request.requester_user_id = auth.uid()
          OR public.can_view_product_inventory()
          OR EXISTS (
            SELECT 1 FROM public.product_return_approvals approval
            WHERE approval.return_request_id = request.id
              AND approval.assigned_approver_user_id = auth.uid()
          )
        )
    )
  );
CREATE POLICY product_return_approvals_select ON public.product_return_approvals
  FOR SELECT USING (
    auth.role() = 'service_role'
    OR (
      organization_id = public.current_org_id()
      AND (public.can_view_product_inventory() OR assigned_approver_user_id = auth.uid())
    )
  );
CREATE POLICY product_return_receipts_select ON public.product_return_receipts
  FOR SELECT USING (
    auth.role() = 'service_role'
    OR (organization_id = public.current_org_id() AND public.can_view_product_inventory())
  );
CREATE POLICY product_return_receipt_lines_select ON public.product_return_receipt_lines
  FOR SELECT USING (
    auth.role() = 'service_role'
    OR (organization_id = public.current_org_id() AND public.can_view_product_inventory())
  );

DROP TRIGGER IF EXISTS trg_touch_product_return_requests ON public.product_return_requests;
CREATE TRIGGER trg_touch_product_return_requests BEFORE UPDATE ON public.product_return_requests
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
DROP TRIGGER IF EXISTS trg_touch_product_return_request_lines ON public.product_return_request_lines;
CREATE TRIGGER trg_touch_product_return_request_lines BEFORE UPDATE ON public.product_return_request_lines
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
DROP TRIGGER IF EXISTS trg_touch_product_return_approvals ON public.product_return_approvals;
CREATE TRIGGER trg_touch_product_return_approvals BEFORE UPDATE ON public.product_return_approvals
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE OR REPLACE FUNCTION public.execute_product_return_command(
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
  actor_employee_id uuid;
  command_row public.product_inventory_custody_commands%ROWTYPE;
  settings_row public.product_inventory_commerce_settings%ROWTYPE;
  request_row public.product_return_requests%ROWTYPE;
  approval_row public.product_return_approvals%ROWTYPE;
  assignment_row public.product_inventory_operational_assignments%ROWTYPE;
  warehouse_row public.inventory_warehouses%ROWTYPE;
  receipt_row public.product_return_receipts%ROWTYPE;
  item jsonb;
  attachment jsonb;
  unit_row public.product_inventory_units%ROWTYPE;
  request_line_row public.product_return_request_lines%ROWTYPE;
  payload_hash_value text;
  entity_id_value uuid;
  result_value jsonb;
  item_count integer;
  attachment_count integer;
  approved_value boolean;
  pm_assignment_id uuid;
  pm_user_id uuid;
  project_name_value text;
  decision_value text;
  disposition_value text;
  received_line_count integer;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501';
  END IF;
  IF p_action NOT IN (
    'return_request_submit', 'return_request_review',
    'return_request_cancel', 'return_physical_receive'
  ) OR jsonb_typeof(COALESCE(p_payload, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'Unsupported product return command.' USING ERRCODE = '22023';
  END IF;

  SELECT member.role::text, employee.id INTO actor_role_value, actor_employee_id
  FROM public.org_members member
  JOIN public.organizations organization ON organization.id = member.org_id
  JOIN public.profiles profile ON profile.user_id = member.user_id AND profile.org_id = member.org_id
  LEFT JOIN public.employees employee
    ON employee.org_id = member.org_id AND employee.user_id = member.user_id
   AND lower(COALESCE(employee.status, '')) = 'active'
   AND COALESCE(employee.lifecycle_status, 'active') = 'active'
  WHERE member.org_id = p_org_id AND member.user_id = p_actor_user_id
    AND lower(COALESCE(organization.status, '')) = 'active'
    AND lower(COALESCE(profile.account_status, '')) = 'active'
  LIMIT 1;
  IF actor_role_value IS NULL THEN
    RAISE EXCEPTION 'Active organization access is required.' USING ERRCODE = '42501';
  END IF;

  payload_hash_value := encode(
    digest(jsonb_build_object('action', p_action, 'payload', p_payload)::text, 'sha256'), 'hex'
  );
  entity_id_value := COALESCE(
    NULLIF(p_payload->>'return_request_id', '')::uuid,
    NULLIF(p_payload->>'entity_id', '')::uuid
  );
  INSERT INTO public.product_inventory_custody_commands (
    organization_id, idempotency_key, action, entity_id, payload_hash,
    actor_user_id, request_id
  ) VALUES (
    p_org_id, p_command_id, p_action, entity_id_value, payload_hash_value,
    p_actor_user_id, p_request_id
  ) ON CONFLICT (organization_id, idempotency_key) DO NOTHING;
  SELECT * INTO command_row FROM public.product_inventory_custody_commands
  WHERE organization_id = p_org_id AND idempotency_key = p_command_id FOR UPDATE;
  IF command_row.action <> p_action OR command_row.payload_hash <> payload_hash_value
     OR command_row.actor_user_id <> p_actor_user_id THEN
    RAISE EXCEPTION 'Product return idempotency key was reused.' USING ERRCODE = '23505';
  END IF;
  IF command_row.status = 'completed' THEN RETURN command_row.result; END IF;

  SELECT * INTO settings_row FROM public.product_inventory_commerce_settings
  WHERE organization_id = p_org_id;
  IF settings_row.organization_id IS NULL THEN
    INSERT INTO public.product_inventory_commerce_settings (organization_id)
    VALUES (p_org_id) RETURNING * INTO settings_row;
  END IF;
  PERFORM set_config('app.product_commerce_command', 'trusted', true);

  IF p_action = 'return_request_submit' THEN
    IF actor_employee_id IS NULL THEN
      RAISE EXCEPTION 'An active employee profile is required.' USING ERRCODE = '42501';
    END IF;
    IF entity_id_value IS NULL THEN
      RAISE EXCEPTION 'Return request id is required.' USING ERRCODE = '23514';
    END IF;
    IF jsonb_typeof(COALESCE(p_payload->'lines', '[]'::jsonb)) <> 'array' THEN
      RAISE EXCEPTION 'Return request lines must be an array.' USING ERRCODE = '23514';
    END IF;
    item_count := jsonb_array_length(p_payload->'lines');
    IF item_count < 1 OR item_count > 50 THEN
      RAISE EXCEPTION 'Return request must contain between 1 and 50 serials.' USING ERRCODE = '23514';
    END IF;
    IF (SELECT count(DISTINCT value->>'unit_id') FROM jsonb_array_elements(p_payload->'lines')) <> item_count
       OR (SELECT count(DISTINCT value->>'line_id') FROM jsonb_array_elements(p_payload->'lines')) <> item_count THEN
      RAISE EXCEPTION 'Return request line and unit ids must be unique.' USING ERRCODE = '23505';
    END IF;

    SELECT assignment.* INTO assignment_row
    FROM public.product_inventory_operational_assignments assignment
    JOIN public.product_inventory_units unit
      ON unit.current_custodian_assignment_id = assignment.id
    JOIN jsonb_array_elements(p_payload->'lines') line(value)
      ON unit.id = (line.value->>'unit_id')::uuid
    WHERE assignment.organization_id = p_org_id
      AND assignment.employee_id = actor_employee_id
      AND assignment.status = 'active' AND assignment.can_request_return
      AND assignment.effective_from <= CURRENT_DATE
      AND (assignment.effective_to IS NULL OR assignment.effective_to >= CURRENT_DATE)
    LIMIT 1 FOR UPDATE OF assignment;
    IF assignment_row.id IS NULL THEN
      RAISE EXCEPTION 'An active return-capable custody assignment was not found.' USING ERRCODE = 'P0002';
    END IF;
    IF (
      SELECT count(*) FROM public.product_inventory_units unit
      JOIN jsonb_array_elements(p_payload->'lines') line(value)
        ON unit.id = (line.value->>'unit_id')::uuid
      WHERE unit.organization_id = p_org_id
        AND unit.status = 'with_custodian'
        AND unit.current_custodian_assignment_id = assignment_row.id
        AND unit.current_custodian_employee_id = actor_employee_id
        AND unit.active_return_request_line_id IS NULL
        AND unit.current_sale_id IS NULL
    ) <> item_count THEN
      RAISE EXCEPTION 'Only your ready, unsold custody serials can be returned.' USING ERRCODE = '55000';
    END IF;
    PERFORM unit.id FROM public.product_inventory_units unit
    JOIN jsonb_array_elements(p_payload->'lines') line(value)
      ON unit.id = (line.value->>'unit_id')::uuid
    WHERE unit.organization_id = p_org_id ORDER BY unit.id FOR UPDATE OF unit;

    SELECT * INTO warehouse_row FROM public.inventory_warehouses
    WHERE organization_id = p_org_id
      AND id = COALESCE(NULLIF(p_payload->>'warehouse_id', '')::uuid, settings_row.default_return_warehouse_id)
      AND is_active FOR SHARE;
    IF warehouse_row.id IS NULL THEN
      RAISE EXCEPTION 'An active return warehouse is required.' USING ERRCODE = 'P0002';
    END IF;
    SELECT name INTO project_name_value FROM public.sales_companies
    WHERE id = assignment_row.project_id AND organization_id = p_org_id;

    IF settings_row.return_approval_mode IN ('both', 'project_manager', 'either') THEN
      SELECT assignment.id, employee.user_id INTO pm_assignment_id, pm_user_id
      FROM public.product_inventory_operational_assignments assignment
      JOIN public.employees employee ON employee.id = assignment.employee_id
      WHERE assignment.organization_id = p_org_id
        AND assignment.project_id = assignment_row.project_id
        AND lower(assignment.city) = lower(assignment_row.city)
        AND assignment.responsibility = 'project_manager'
        AND assignment.can_approve_return AND assignment.status = 'active'
        AND assignment.effective_from <= CURRENT_DATE
        AND (assignment.effective_to IS NULL OR assignment.effective_to >= CURRENT_DATE)
        AND employee.user_id IS NOT NULL
      ORDER BY assignment.created_at LIMIT 1;
      IF pm_assignment_id IS NULL THEN
        RAISE EXCEPTION 'A scoped OGPM return approver is required for this project and city.'
          USING ERRCODE = 'P0002';
      END IF;
    END IF;

    INSERT INTO public.product_return_requests (
      id, organization_id, return_no, requester_user_id, requester_employee_id,
      custodian_assignment_id, custodian_employee_id, project_id, project_name_snapshot,
      location_id, city_snapshot, position_code_snapshot, warehouse_id,
      approval_mode_snapshot, status, reason_summary
    ) VALUES (
      entity_id_value, p_org_id, public.next_product_return_number(p_org_id, CURRENT_DATE),
      p_actor_user_id, actor_employee_id, assignment_row.id, actor_employee_id,
      assignment_row.project_id, project_name_value, assignment_row.location_id,
      assignment_row.city, assignment_row.position_code, warehouse_row.id,
      settings_row.return_approval_mode, 'pending_approval', btrim(p_payload->>'reason_summary')
    ) RETURNING * INTO request_row;

    FOR item IN SELECT value FROM jsonb_array_elements(p_payload->'lines') LOOP
      SELECT * INTO unit_row FROM public.product_inventory_units
      WHERE organization_id = p_org_id AND id = (item->>'unit_id')::uuid;
      attachment_count := jsonb_array_length(COALESCE(item->'attachments', '[]'::jsonb));
      IF jsonb_typeof(COALESCE(item->'attachments', '[]'::jsonb)) <> 'array'
         OR attachment_count < (
           CASE WHEN settings_row.require_return_photo THEN settings_row.minimum_return_photos ELSE 0 END
         )
         OR attachment_count > settings_row.maximum_return_photos THEN
        RAISE EXCEPTION 'Each return serial must have the configured number of photos.' USING ERRCODE = '23514';
      END IF;
      INSERT INTO public.product_return_request_lines (
        id, organization_id, return_request_id, unit_id, handover_id,
        serial_snapshot, product_name_snapshot, requester_note, claimed_condition, status
      ) SELECT
        (item->>'line_id')::uuid, p_org_id, request_row.id, unit_row.id,
        unit_row.current_handover_id, unit_row.raw_serial_number, product.name,
        btrim(item->>'requester_note'), COALESCE(NULLIF(item->>'claimed_condition', ''), 'unknown'),
        'pending'
      FROM public.sales_products product WHERE product.id = unit_row.product_id
      RETURNING * INTO request_line_row;

      FOR attachment IN SELECT value FROM jsonb_array_elements(COALESCE(item->'attachments', '[]'::jsonb)) LOOP
        IF attachment->'file'->>'bucket' <> 'product-return-evidence'
           OR attachment->'file'->>'scan_status' <> 'clean'
           OR attachment->'file'->>'type' NOT IN ('image/jpeg', 'image/png', 'image/webp')
           OR length(COALESCE(attachment->'file'->>'sha256', '')) <> 64
           OR COALESCE((attachment->'file'->>'size_bytes')::bigint, 0) NOT BETWEEN 1 AND 8388608
           OR attachment->'file'->>'path' NOT LIKE
             p_org_id::text || '/' || request_row.id::text || '/' || request_line_row.id::text || '/%' THEN
          RAISE EXCEPTION 'Return evidence must be clean, private, and scoped to its serial.' USING ERRCODE = '23514';
        END IF;
        INSERT INTO public.managed_files (
          id, org_id, bucket_id, storage_path, owner_type, owner_id,
          original_name, detected_mime, size_bytes, sha256, scan_status,
          scan_engine, scanned_at, retention_until, uploaded_by,
          storage_provider, storage_container, classification
        ) VALUES (
          (attachment->>'managed_file_id')::uuid, p_org_id,
          attachment->'file'->>'bucket', attachment->'file'->>'path',
          'product_return_evidence', (attachment->>'attachment_id')::uuid,
          attachment->'file'->>'filename', attachment->'file'->>'type',
          (attachment->'file'->>'size_bytes')::bigint, attachment->'file'->>'sha256',
          'clean', attachment->'file'->>'scan_engine',
          (attachment->'file'->>'scanned_at')::timestamptz,
          CURRENT_DATE + 2555, p_actor_user_id,
          COALESCE(NULLIF(attachment->'file'->>'provider', ''), 'supabase_storage'),
          attachment->'file'->>'bucket', 'restricted_financial'
        );
        INSERT INTO public.product_return_attachments (
          id, organization_id, return_request_id, return_line_id, managed_file_id,
          original_name, detected_mime, size_bytes, sha256, evidence_type,
          captured_at, uploaded_by
        ) VALUES (
          (attachment->>'attachment_id')::uuid, p_org_id, request_row.id,
          request_line_row.id, (attachment->>'managed_file_id')::uuid,
          attachment->'file'->>'filename', attachment->'file'->>'type',
          (attachment->'file'->>'size_bytes')::bigint, attachment->'file'->>'sha256',
          'requester_photo', NULLIF(attachment->>'captured_at', '')::timestamptz,
          p_actor_user_id
        );
      END LOOP;

      UPDATE public.product_inventory_units
      SET status = 'return_pending', active_return_request_line_id = request_line_row.id,
          version = version + 1, updated_at = now()
      WHERE id = unit_row.id;
      INSERT INTO public.product_inventory_movements (
        organization_id, unit_id, movement_type, from_custodian_employee_id,
        handover_id, return_request_id, return_request_line_id, reason,
        performed_by, metadata
      ) VALUES (
        p_org_id, unit_row.id, 'return_reserved', actor_employee_id,
        unit_row.current_handover_id, request_row.id, request_line_row.id,
        request_line_row.requester_note, p_actor_user_id,
        jsonb_build_object('return_no', request_row.return_no, 'command_id', p_command_id)
      );
    END LOOP;

    IF settings_row.return_approval_mode IN ('both', 'finance_manager', 'either') THEN
      INSERT INTO public.product_return_approvals (
        organization_id, return_request_id, approver_type
      ) VALUES (p_org_id, request_row.id, 'finance_manager');
    END IF;
    IF settings_row.return_approval_mode IN ('both', 'project_manager', 'either') THEN
      INSERT INTO public.product_return_approvals (
        organization_id, return_request_id, approver_type,
        assigned_approver_user_id, assigned_approver_assignment_id
      ) VALUES (p_org_id, request_row.id, 'project_manager', pm_user_id, pm_assignment_id);
    END IF;

  ELSIF p_action = 'return_request_review' THEN
    SELECT * INTO request_row FROM public.product_return_requests
    WHERE organization_id = p_org_id AND id = entity_id_value FOR UPDATE;
    IF request_row.id IS NULL THEN
      RAISE EXCEPTION 'Return request was not found.' USING ERRCODE = 'P0002';
    END IF;
    IF request_row.status <> 'pending_approval' THEN
      RAISE EXCEPTION 'Only a pending return request can be reviewed.' USING ERRCODE = '55000';
    END IF;
    IF request_row.version <> NULLIF(p_payload->>'expected_version', '')::integer THEN
      RAISE EXCEPTION 'Return request was changed by another user.' USING ERRCODE = '40001';
    END IF;
    decision_value := p_payload->>'decision';
    IF decision_value NOT IN ('approved', 'rejected') THEN
      RAISE EXCEPTION 'Return review decision is invalid.' USING ERRCODE = '23514';
    END IF;

    IF actor_role_value IN ('admin', 'finance_manager') THEN
      SELECT * INTO approval_row FROM public.product_return_approvals
      WHERE return_request_id = request_row.id AND approver_type = 'finance_manager' FOR UPDATE;
    ELSE
      SELECT * INTO approval_row FROM public.product_return_approvals
      WHERE return_request_id = request_row.id AND approver_type = 'project_manager'
        AND assigned_approver_user_id = p_actor_user_id FOR UPDATE;
    END IF;
    IF approval_row.id IS NULL OR approval_row.decision <> 'pending' THEN
      RAISE EXCEPTION 'No pending scoped approval is assigned to this user.' USING ERRCODE = '42501';
    END IF;
    UPDATE public.product_return_approvals
    SET decision = decision_value, decision_note = NULLIF(btrim(p_payload->>'decision_note'), ''),
        decided_by = p_actor_user_id, decided_at = now(), version = version + 1
    WHERE id = approval_row.id RETURNING * INTO approval_row;

    IF decision_value = 'rejected' THEN
      UPDATE public.product_return_requests
      SET status = 'rejected', rejected_at = now(), version = version + 1
      WHERE id = request_row.id RETURNING * INTO request_row;
      UPDATE public.product_return_request_lines
      SET status = 'rejected', version = version + 1
      WHERE return_request_id = request_row.id AND status = 'pending';
      UPDATE public.product_inventory_units unit
      SET status = 'with_custodian', active_return_request_line_id = NULL,
          version = unit.version + 1, updated_at = now()
      FROM public.product_return_request_lines line
      WHERE line.return_request_id = request_row.id AND line.unit_id = unit.id
        AND unit.organization_id = p_org_id;
      INSERT INTO public.product_inventory_movements (
        organization_id, unit_id, movement_type, to_custodian_employee_id,
        handover_id, return_request_id, return_request_line_id, reason,
        performed_by, metadata
      ) SELECT p_org_id, line.unit_id, 'return_rejected', request_row.custodian_employee_id,
        line.handover_id, request_row.id, line.id, approval_row.decision_note,
        p_actor_user_id, jsonb_build_object('return_no', request_row.return_no, 'command_id', p_command_id)
      FROM public.product_return_request_lines line WHERE line.return_request_id = request_row.id;
    ELSE
      SELECT CASE request_row.approval_mode_snapshot
        WHEN 'both' THEN bool_and(approval.decision = 'approved')
        WHEN 'either' THEN bool_or(approval.decision = 'approved')
        WHEN 'finance_manager' THEN bool_or(approval.approver_type = 'finance_manager' AND approval.decision = 'approved')
        WHEN 'project_manager' THEN bool_or(approval.approver_type = 'project_manager' AND approval.decision = 'approved')
      END INTO approved_value
      FROM public.product_return_approvals approval
      WHERE approval.return_request_id = request_row.id;
      IF approved_value THEN
        UPDATE public.product_return_requests
        SET status = 'approved_awaiting_delivery', approved_at = now(), version = version + 1
        WHERE id = request_row.id RETURNING * INTO request_row;
        UPDATE public.product_return_request_lines
        SET status = 'awaiting_delivery', version = version + 1
        WHERE return_request_id = request_row.id AND status = 'pending';
        UPDATE public.product_inventory_units unit
        SET status = 'return_approved', version = unit.version + 1, updated_at = now()
        FROM public.product_return_request_lines line
        WHERE line.return_request_id = request_row.id AND line.unit_id = unit.id
          AND unit.organization_id = p_org_id;
        INSERT INTO public.product_inventory_movements (
          organization_id, unit_id, movement_type, from_custodian_employee_id,
          handover_id, return_request_id, return_request_line_id, reason,
          performed_by, metadata
        ) SELECT p_org_id, line.unit_id, 'return_approved', request_row.custodian_employee_id,
          line.handover_id, request_row.id, line.id, approval_row.decision_note,
          p_actor_user_id, jsonb_build_object('return_no', request_row.return_no, 'command_id', p_command_id)
        FROM public.product_return_request_lines line WHERE line.return_request_id = request_row.id;
      ELSE
        UPDATE public.product_return_requests SET version = version + 1
        WHERE id = request_row.id RETURNING * INTO request_row;
      END IF;
    END IF;

  ELSIF p_action = 'return_request_cancel' THEN
    SELECT * INTO request_row FROM public.product_return_requests
    WHERE organization_id = p_org_id AND id = entity_id_value FOR UPDATE;
    IF request_row.id IS NULL THEN RAISE EXCEPTION 'Return request was not found.' USING ERRCODE = 'P0002'; END IF;
    IF request_row.requester_user_id <> p_actor_user_id THEN
      RAISE EXCEPTION 'Only the requester can cancel this return.' USING ERRCODE = '42501';
    END IF;
    IF request_row.status <> 'pending_approval' THEN
      RAISE EXCEPTION 'Only a pending return can be cancelled.' USING ERRCODE = '55000';
    END IF;
    IF request_row.version <> NULLIF(p_payload->>'expected_version', '')::integer THEN
      RAISE EXCEPTION 'Return request was changed by another user.' USING ERRCODE = '40001';
    END IF;
    UPDATE public.product_return_requests
    SET status = 'cancelled', version = version + 1
    WHERE id = request_row.id RETURNING * INTO request_row;
    UPDATE public.product_return_request_lines
    SET status = 'cancelled', version = version + 1
    WHERE return_request_id = request_row.id AND status = 'pending';
    UPDATE public.product_inventory_units unit
    SET status = 'with_custodian', active_return_request_line_id = NULL,
        version = unit.version + 1, updated_at = now()
    FROM public.product_return_request_lines line
    WHERE line.return_request_id = request_row.id AND line.unit_id = unit.id;

  ELSE
    IF actor_role_value NOT IN ('admin', 'finance_manager') THEN
      RAISE EXCEPTION 'Only Finance can physically receive returned products.' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO request_row FROM public.product_return_requests
    WHERE organization_id = p_org_id AND id = entity_id_value FOR UPDATE;
    IF request_row.id IS NULL THEN RAISE EXCEPTION 'Return request was not found.' USING ERRCODE = 'P0002'; END IF;
    IF request_row.status NOT IN ('approved_awaiting_delivery', 'partially_received') THEN
      RAISE EXCEPTION 'Return request is not ready for physical receipt.' USING ERRCODE = '55000';
    END IF;
    IF request_row.version <> NULLIF(p_payload->>'expected_version', '')::integer THEN
      RAISE EXCEPTION 'Return request was changed by another user.' USING ERRCODE = '40001';
    END IF;
    SELECT * INTO warehouse_row FROM public.inventory_warehouses
    WHERE organization_id = p_org_id AND id = NULLIF(p_payload->>'warehouse_id', '')::uuid
      AND is_active FOR SHARE;
    IF warehouse_row.id IS NULL THEN RAISE EXCEPTION 'Active receiving warehouse was not found.' USING ERRCODE = 'P0002'; END IF;
    item_count := jsonb_array_length(COALESCE(p_payload->'lines', '[]'::jsonb));
    IF jsonb_typeof(COALESCE(p_payload->'lines', '[]'::jsonb)) <> 'array'
       OR item_count < 1 OR item_count > 50 THEN
      RAISE EXCEPTION 'Physical receipt lines are invalid.' USING ERRCODE = '23514';
    END IF;
    IF (SELECT count(DISTINCT value->>'request_line_id') FROM jsonb_array_elements(p_payload->'lines')) <> item_count THEN
      RAISE EXCEPTION 'Physical receipt lines must be unique.' USING ERRCODE = '23505';
    END IF;

    INSERT INTO public.product_return_receipts (
      id, organization_id, return_request_id, warehouse_id, received_by,
      notes, request_id, command_id
    ) VALUES (
      NULLIF(p_payload->>'receipt_id', '')::uuid, p_org_id, request_row.id,
      warehouse_row.id, p_actor_user_id, NULLIF(btrim(p_payload->>'notes'), ''),
      p_request_id, p_command_id
    ) RETURNING * INTO receipt_row;

    FOR item IN SELECT value FROM jsonb_array_elements(p_payload->'lines') LOOP
      SELECT * INTO request_line_row FROM public.product_return_request_lines
      WHERE organization_id = p_org_id AND return_request_id = request_row.id
        AND id = (item->>'request_line_id')::uuid AND status = 'awaiting_delivery'
      FOR UPDATE;
      IF request_line_row.id IS NULL THEN
        RAISE EXCEPTION 'Return line is not awaiting physical delivery.' USING ERRCODE = '55000';
      END IF;
      SELECT * INTO unit_row FROM public.product_inventory_units
      WHERE organization_id = p_org_id AND id = request_line_row.unit_id FOR UPDATE;
      IF public.normalize_product_serial(item->>'scanned_serial')
         <> public.normalize_product_serial(request_line_row.serial_snapshot) THEN
        RAISE EXCEPTION 'Scanned serial does not match the requested return line.' USING ERRCODE = '23514';
      END IF;
      IF unit_row.status <> 'return_approved'
         OR unit_row.current_custodian_employee_id <> request_row.custodian_employee_id
         OR unit_row.active_return_request_line_id <> request_line_row.id THEN
        RAISE EXCEPTION 'Returned unit custody state changed before receipt.' USING ERRCODE = '55000';
      END IF;
      disposition_value := item->>'disposition';
      IF disposition_value NOT IN ('sellable', 'quarantine', 'damaged') THEN
        RAISE EXCEPTION 'Return disposition is invalid.' USING ERRCODE = '23514';
      END IF;
      INSERT INTO public.product_return_receipt_lines (
        organization_id, receipt_id, request_line_id, unit_id, scanned_serial,
        disposition, condition_received, inspection_note
      ) VALUES (
        p_org_id, receipt_row.id, request_line_row.id, unit_row.id,
        item->>'scanned_serial', disposition_value,
        COALESCE(NULLIF(item->>'condition_received', ''), 'unknown'),
        NULLIF(btrim(item->>'inspection_note'), '')
      );
      UPDATE public.product_return_request_lines
      SET status = CASE disposition_value
          WHEN 'sellable' THEN 'received_sellable'
          WHEN 'quarantine' THEN 'received_quarantine'
          ELSE 'received_damaged' END,
          received_at = now(), received_by = p_actor_user_id,
          inspection_note = NULLIF(btrim(item->>'inspection_note'), ''),
          version = version + 1
      WHERE id = request_line_row.id;
      UPDATE public.product_handover_lines
      SET line_status = 'returned', closed_at = now(), updated_at = now()
      WHERE organization_id = p_org_id AND handover_id = request_line_row.handover_id
        AND unit_id = unit_row.id AND line_status IN ('accepted', 'pending');
      UPDATE public.product_inventory_units
      SET status = CASE disposition_value
          WHEN 'sellable' THEN 'in_stock'
          WHEN 'quarantine' THEN 'quarantine'
          ELSE 'damaged' END,
          warehouse_id = warehouse_row.id,
          current_handover_id = NULL, current_agent_id = NULL,
          current_custodian_assignment_id = NULL,
          current_custodian_employee_id = NULL,
          current_project_id = NULL, current_location_id = NULL,
          current_city_snapshot = NULL, active_return_request_line_id = NULL,
          assigned_at = NULL, version = version + 1, updated_at = now()
      WHERE id = unit_row.id;
      INSERT INTO public.product_inventory_movements (
        organization_id, unit_id, movement_type, to_warehouse_id,
        from_custodian_employee_id, handover_id, return_request_id,
        return_request_line_id, reason, performed_by, metadata
      ) VALUES (
        p_org_id, unit_row.id,
        CASE disposition_value WHEN 'quarantine' THEN 'quarantine'
          WHEN 'damaged' THEN 'damage' ELSE 'return_received' END,
        warehouse_row.id, request_row.custodian_employee_id, request_line_row.handover_id,
        request_row.id, request_line_row.id, NULLIF(btrim(item->>'inspection_note'), ''),
        p_actor_user_id, jsonb_build_object(
          'return_no', request_row.return_no, 'receipt_id', receipt_row.id,
          'disposition', disposition_value, 'command_id', p_command_id
        )
      );
    END LOOP;

    SELECT count(*) INTO received_line_count FROM public.product_return_request_lines
    WHERE return_request_id = request_row.id
      AND status IN ('received_sellable', 'received_quarantine', 'received_damaged');
    UPDATE public.product_return_requests
    SET status = CASE WHEN received_line_count = (
          SELECT count(*) FROM public.product_return_request_lines WHERE return_request_id = request_row.id
        ) THEN 'received' ELSE 'partially_received' END,
        completed_at = CASE WHEN received_line_count = (
          SELECT count(*) FROM public.product_return_request_lines WHERE return_request_id = request_row.id
        ) THEN now() ELSE NULL END,
        version = version + 1
    WHERE id = request_row.id RETURNING * INTO request_row;
  END IF;

  INSERT INTO public.operational_audit_logs (
    org_id, request_id, actor_user_id, actor_role, action,
    target_type, target_id, outcome, status_code, metadata
  ) VALUES (
    p_org_id, p_request_id, p_actor_user_id, actor_role_value,
    'product_inventory.' || p_action, 'product_return_request', request_row.id::text,
    'success', 200, jsonb_build_object(
      'return_no', request_row.return_no, 'status', request_row.status,
      'command_id', p_command_id
    )
  );
  result_value := jsonb_build_object(
    'return_request', to_jsonb(request_row),
    'lines', (SELECT COALESCE(jsonb_agg(to_jsonb(line) ORDER BY line.created_at), '[]'::jsonb)
      FROM public.product_return_request_lines line WHERE line.return_request_id = request_row.id),
    'approvals', (SELECT COALESCE(jsonb_agg(to_jsonb(approval) ORDER BY approval.created_at), '[]'::jsonb)
      FROM public.product_return_approvals approval WHERE approval.return_request_id = request_row.id)
  );
  UPDATE public.product_inventory_custody_commands
  SET status = 'completed', result = result_value, entity_id = request_row.id, completed_at = now()
  WHERE id = command_row.id;
  RETURN result_value;
END;
$$;

GRANT SELECT ON public.product_return_requests, public.product_return_request_lines,
  public.product_return_attachments, public.product_return_approvals,
  public.product_return_receipts, public.product_return_receipt_lines
  TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_return_number_sequences,
  public.product_return_requests, public.product_return_request_lines,
  public.product_return_attachments, public.product_return_approvals,
  public.product_return_receipts, public.product_return_receipt_lines
  TO service_role;
REVOKE ALL ON FUNCTION public.execute_product_return_command(
  uuid, uuid, uuid, uuid, text, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.execute_product_return_command(
  uuid, uuid, uuid, uuid, text, jsonb
) TO service_role;

COMMENT ON FUNCTION public.execute_product_return_command(
  uuid, uuid, uuid, uuid, text, jsonb
) IS 'Atomic evidence-backed request, approval, cancellation, and Finance physical return receipt workflow.';
