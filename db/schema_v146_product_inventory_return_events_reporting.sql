-- Phase 5: durable employee-custody/return notifications, return KPIs, and
-- automatic damaged-return accounting linkage.

ALTER TABLE public.product_inventory_loss_records
  ADD COLUMN IF NOT EXISTS return_request_id uuid
    REFERENCES public.product_return_requests(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS return_request_line_id uuid
    REFERENCES public.product_return_request_lines(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS return_receipt_id uuid
    REFERENCES public.product_return_receipts(id) ON DELETE SET NULL;
ALTER TABLE public.product_return_receipt_lines
  ADD COLUMN IF NOT EXISTS loss_record_id uuid
    REFERENCES public.product_inventory_loss_records(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS product_inventory_loss_return_line_idx
  ON public.product_inventory_loss_records (organization_id, return_request_line_id)
  WHERE return_request_line_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.emit_product_inventory_workflow_event(
  p_org_id uuid,
  p_source_type text,
  p_business_key text,
  p_event_version integer,
  p_topic text,
  p_payload jsonb,
  p_actor_user_id uuid DEFAULT NULL,
  p_request_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  payload_hash_value text;
  event_id_value uuid;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501';
  END IF;
  IF p_org_id IS NULL OR NULLIF(btrim(p_source_type), '') IS NULL
     OR NULLIF(btrim(p_business_key), '') IS NULL OR p_event_version < 1
     OR NULLIF(btrim(p_topic), '') IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'Workflow event fields are invalid.' USING ERRCODE = '23514';
  END IF;
  payload_hash_value := encode(digest(p_payload::text, 'sha256'), 'hex');
  INSERT INTO public.business_events (
    org_id, source_type, business_key, event_version, payload, payload_hash,
    status, request_id, actor_user_id, occurred_at, processed_at
  ) VALUES (
    p_org_id, p_source_type, p_business_key, p_event_version, p_payload,
    payload_hash_value, 'completed', p_request_id, p_actor_user_id, now(), now()
  )
  ON CONFLICT (org_id, source_type, business_key) DO UPDATE SET
    payload = EXCLUDED.payload,
    payload_hash = EXCLUDED.payload_hash,
    event_version = EXCLUDED.event_version,
    actor_user_id = EXCLUDED.actor_user_id,
    request_id = EXCLUDED.request_id,
    occurred_at = EXCLUDED.occurred_at,
    processed_at = EXCLUDED.processed_at,
    updated_at = now()
  RETURNING id INTO event_id_value;
  INSERT INTO public.event_outbox (
    org_id, business_event_id, topic, payload, payload_hash
  ) VALUES (
    p_org_id, event_id_value, p_topic, p_payload, payload_hash_value
  ) ON CONFLICT (business_event_id, topic) DO NOTHING;
  RETURN event_id_value;
END;
$$;

CREATE OR REPLACE FUNCTION public.emit_product_return_request_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  topic_value text;
  unit_count_value integer;
  actor_value uuid;
  payload_value jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    topic_value := 'product_inventory.return_submitted';
    actor_value := NEW.requester_user_id;
  ELSIF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  ELSE
    topic_value := CASE NEW.status
      WHEN 'approved_awaiting_delivery' THEN 'product_inventory.return_approved'
      WHEN 'rejected' THEN 'product_inventory.return_rejected'
      WHEN 'partially_received' THEN 'product_inventory.return_partially_received'
      WHEN 'received' THEN 'product_inventory.return_received'
      WHEN 'cancelled' THEN 'product_inventory.return_cancelled'
      ELSE NULL
    END;
    SELECT approval.decided_by INTO actor_value
    FROM public.product_return_approvals approval
    WHERE approval.return_request_id = NEW.id AND approval.decided_by IS NOT NULL
    ORDER BY approval.decided_at DESC NULLS LAST LIMIT 1;
  END IF;
  IF topic_value IS NULL THEN RETURN NEW; END IF;
  SELECT count(*)::integer INTO unit_count_value
  FROM public.product_return_request_lines line WHERE line.return_request_id = NEW.id;
  payload_value := jsonb_build_object(
    'event_type', topic_value,
    'return_request_id', NEW.id,
    'return_no', NEW.return_no,
    'requester_user_id', NEW.requester_user_id,
    'custodian_employee_id', NEW.custodian_employee_id,
    'project_id', NEW.project_id,
    'project_name', NEW.project_name_snapshot,
    'city', NEW.city_snapshot,
    'position_code', NEW.position_code_snapshot,
    'warehouse_id', NEW.warehouse_id,
    'approval_mode', NEW.approval_mode_snapshot,
    'status', NEW.status,
    'reason', NEW.reason_summary,
    'unit_count', unit_count_value,
    'version', NEW.version
  );
  PERFORM public.emit_product_inventory_workflow_event(
    NEW.organization_id, 'product_inventory_return',
    NEW.id::text || ':' || topic_value, GREATEST(NEW.version, 1),
    topic_value, payload_value, actor_value, NULL
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.emit_product_return_approval_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  request_row public.product_return_requests%ROWTYPE;
  topic_value text;
  payload_value jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    topic_value := 'product_inventory.return_approval_requested';
  ELSIF OLD.decision = 'pending' AND NEW.decision IN ('approved', 'rejected') THEN
    topic_value := 'product_inventory.return_reviewed';
  ELSE
    RETURN NEW;
  END IF;
  SELECT * INTO request_row FROM public.product_return_requests
  WHERE id = NEW.return_request_id;
  payload_value := jsonb_build_object(
    'event_type', topic_value,
    'return_request_id', request_row.id,
    'return_no', request_row.return_no,
    'requester_user_id', request_row.requester_user_id,
    'custodian_employee_id', request_row.custodian_employee_id,
    'project_id', request_row.project_id,
    'project_name', request_row.project_name_snapshot,
    'city', request_row.city_snapshot,
    'position_code', request_row.position_code_snapshot,
    'warehouse_id', request_row.warehouse_id,
    'approval_mode', request_row.approval_mode_snapshot,
    'status', request_row.status,
    'reason', request_row.reason_summary,
    'unit_count', (SELECT count(*) FROM public.product_return_request_lines line
      WHERE line.return_request_id = request_row.id),
    'version', GREATEST(request_row.version, 1),
    'approval_id', NEW.id,
    'approver_type', NEW.approver_type,
    'assigned_approver_user_id', NEW.assigned_approver_user_id,
    'decision', NEW.decision,
    'decision_note', NEW.decision_note,
    'decided_by', NEW.decided_by
  );
  PERFORM public.emit_product_inventory_workflow_event(
    NEW.organization_id, 'product_inventory_return_approval',
    NEW.id::text || ':' || topic_value, GREATEST(NEW.version, 1),
    topic_value, payload_value, NEW.decided_by, NULL
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.emit_product_employee_handover_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  topic_value text;
  payload_value jsonb;
BEGIN
  IF NEW.handover_type <> 'employee_custody' THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    topic_value := 'product_inventory.employee_handover_issued';
  ELSIF OLD.status = 'issued' AND NEW.status = 'accepted' THEN
    topic_value := 'product_inventory.employee_handover_accepted';
  ELSE
    RETURN NEW;
  END IF;
  payload_value := jsonb_build_object(
    'event_type', topic_value,
    'handover_id', NEW.id,
    'handover_no', NEW.handover_no,
    'recipient_user_id', NEW.recipient_user_id_snapshot,
    'recipient_employee_id', NEW.recipient_employee_id,
    'recipient_name', NEW.recipient_name_snapshot,
    'project_id', NEW.project_id,
    'project_name', NEW.project_name_snapshot,
    'city', NEW.city_snapshot,
    'position_code', NEW.position_code_snapshot,
    'unit_count', (SELECT count(*) FROM public.product_handover_lines line
      WHERE line.handover_id = NEW.id),
    'status', NEW.status,
    'version', NEW.version
  );
  PERFORM public.emit_product_inventory_workflow_event(
    NEW.organization_id, 'product_inventory_employee_handover',
    NEW.id::text || ':' || topic_value, GREATEST(NEW.version, 1),
    topic_value, payload_value,
    CASE WHEN topic_value = 'product_inventory.employee_handover_accepted'
      THEN NEW.accepted_by ELSE NEW.issued_by END,
    NULL
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.link_damaged_product_return_accounting()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  unit_row public.product_inventory_units%ROWTYPE;
  receipt_row public.product_return_receipts%ROWTYPE;
  request_line_row public.product_return_request_lines%ROWTYPE;
  loss_row public.product_inventory_loss_records%ROWTYPE;
  product_name_value text;
  reason_value text;
  payload_value jsonb;
BEGIN
  IF NEW.disposition <> 'damaged' THEN RETURN NEW; END IF;
  SELECT * INTO unit_row FROM public.product_inventory_units
  WHERE organization_id = NEW.organization_id AND id = NEW.unit_id;
  SELECT * INTO receipt_row FROM public.product_return_receipts
  WHERE organization_id = NEW.organization_id AND id = NEW.receipt_id;
  SELECT * INTO request_line_row FROM public.product_return_request_lines
  WHERE organization_id = NEW.organization_id AND id = NEW.request_line_id;
  SELECT product.name INTO product_name_value FROM public.sales_products product
  WHERE product.organization_id = NEW.organization_id AND product.id = unit_row.product_id;
  reason_value := COALESCE(
    NULLIF(btrim(NEW.inspection_note), ''),
    'Damaged during Finance return inspection'
  );
  INSERT INTO public.product_inventory_loss_records (
    id, organization_id, unit_id, loss_type, serial_snapshot,
    product_name_snapshot, unit_cost_snapshot, currency, ownership_type,
    reason, accounting_status, recorded_by, return_request_id,
    return_request_line_id, return_receipt_id
  ) VALUES (
    gen_random_uuid(), NEW.organization_id, unit_row.id, 'damage',
    unit_row.raw_serial_number, product_name_value, unit_row.unit_cost_snapshot,
    unit_row.currency, unit_row.ownership_type, reason_value,
    CASE WHEN unit_row.ownership_type = 'consignment' THEN 'not_required' ELSE 'pending' END,
    receipt_row.received_by, request_line_row.return_request_id,
    request_line_row.id, receipt_row.id
  ) RETURNING * INTO loss_row;
  UPDATE public.product_return_receipt_lines
  SET loss_record_id = loss_row.id WHERE id = NEW.id;
  payload_value := jsonb_build_object(
    'event_type', 'product_inventory.damage_recorded',
    'loss_id', loss_row.id,
    'unit_id', loss_row.unit_id,
    'loss_type', loss_row.loss_type,
    'serial_number', loss_row.serial_snapshot,
    'product_name', loss_row.product_name_snapshot,
    'unit_cost', loss_row.unit_cost_snapshot,
    'ownership_type', loss_row.ownership_type,
    'reason', loss_row.reason,
    'accounting_status', loss_row.accounting_status,
    'return_request_id', loss_row.return_request_id,
    'return_request_line_id', loss_row.return_request_line_id,
    'return_receipt_id', loss_row.return_receipt_id,
    'version', loss_row.version
  );
  PERFORM public.emit_product_inventory_workflow_event(
    NEW.organization_id, 'product_inventory_loss', loss_row.id::text,
    loss_row.version, 'product_inventory.damage_recorded', payload_value,
    receipt_row.received_by, receipt_row.request_id
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_emit_product_return_request_event ON public.product_return_requests;
CREATE TRIGGER trg_emit_product_return_request_event
  AFTER INSERT OR UPDATE ON public.product_return_requests
  FOR EACH ROW EXECUTE FUNCTION public.emit_product_return_request_event();
DROP TRIGGER IF EXISTS trg_emit_product_return_approval_event ON public.product_return_approvals;
CREATE TRIGGER trg_emit_product_return_approval_event
  AFTER INSERT OR UPDATE ON public.product_return_approvals
  FOR EACH ROW EXECUTE FUNCTION public.emit_product_return_approval_event();
DROP TRIGGER IF EXISTS trg_emit_product_employee_handover_event ON public.product_handovers;
CREATE TRIGGER trg_emit_product_employee_handover_event
  AFTER INSERT OR UPDATE ON public.product_handovers
  FOR EACH ROW EXECUTE FUNCTION public.emit_product_employee_handover_event();
DROP TRIGGER IF EXISTS trg_link_damaged_product_return_accounting ON public.product_return_receipt_lines;
CREATE TRIGGER trg_link_damaged_product_return_accounting
  AFTER INSERT ON public.product_return_receipt_lines
  FOR EACH ROW EXECUTE FUNCTION public.link_damaged_product_return_accounting();

CREATE OR REPLACE FUNCTION public.get_product_inventory_return_report(
  p_org_id uuid,
  p_date_from date DEFAULT NULL,
  p_date_to date DEFAULT NULL
)
RETURNS TABLE (
  project_id uuid,
  project_name text,
  city text,
  total_requests bigint,
  pending_approval bigint,
  awaiting_delivery bigint,
  received_requests bigint,
  rejected_requests bigint,
  cancelled_requests bigint,
  total_units bigint,
  received_sellable bigint,
  received_quarantine bigint,
  received_damaged bigint,
  average_approval_hours numeric,
  average_delivery_hours numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT
    request.project_id,
    request.project_name_snapshot,
    request.city_snapshot,
    count(DISTINCT request.id),
    count(DISTINCT request.id) FILTER (WHERE request.status = 'pending_approval'),
    count(DISTINCT request.id) FILTER (WHERE request.status IN ('approved_awaiting_delivery', 'partially_received')),
    count(DISTINCT request.id) FILTER (WHERE request.status = 'received'),
    count(DISTINCT request.id) FILTER (WHERE request.status = 'rejected'),
    count(DISTINCT request.id) FILTER (WHERE request.status = 'cancelled'),
    count(line.id),
    count(line.id) FILTER (WHERE line.status = 'received_sellable'),
    count(line.id) FILTER (WHERE line.status = 'received_quarantine'),
    count(line.id) FILTER (WHERE line.status = 'received_damaged'),
    round(avg(EXTRACT(EPOCH FROM (request.approved_at - request.submitted_at)) / 3600)
      FILTER (WHERE request.approved_at IS NOT NULL), 2),
    round(avg(EXTRACT(EPOCH FROM (request.completed_at - request.approved_at)) / 3600)
      FILTER (WHERE request.completed_at IS NOT NULL AND request.approved_at IS NOT NULL), 2)
  FROM public.product_return_requests request
  JOIN public.product_return_request_lines line ON line.return_request_id = request.id
  WHERE request.organization_id = p_org_id
    AND (p_date_from IS NULL OR request.submitted_at::date >= p_date_from)
    AND (p_date_to IS NULL OR request.submitted_at::date <= p_date_to)
  GROUP BY request.project_id, request.project_name_snapshot, request.city_snapshot
  ORDER BY request.project_name_snapshot, request.city_snapshot;
END;
$$;

REVOKE ALL ON FUNCTION public.emit_product_inventory_workflow_event(
  uuid, text, text, integer, text, jsonb, uuid, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.emit_product_inventory_workflow_event(
  uuid, text, text, integer, text, jsonb, uuid, uuid
) TO service_role;
REVOKE ALL ON FUNCTION public.get_product_inventory_return_report(uuid, date, date)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_product_inventory_return_report(uuid, date, date)
  TO service_role;

COMMENT ON FUNCTION public.get_product_inventory_return_report(uuid, date, date) IS
  'Exact project/city return funnel, disposition, approval-time, and delivery-time metrics.';
COMMENT ON COLUMN public.product_return_receipt_lines.loss_record_id IS
  'Finance-classified damage record used for durable inventory write-off accounting.';
