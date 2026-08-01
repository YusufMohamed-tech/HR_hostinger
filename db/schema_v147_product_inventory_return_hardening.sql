-- Phase 6: tenant-key integrity, feature rollout guard, exact reconciliation,
-- monitoring indexes, and production hardening for employee router returns.

ALTER TABLE public.product_inventory_commerce_settings
  ADD COLUMN IF NOT EXISTS employee_custody_returns_enabled boolean NOT NULL DEFAULT true;

CREATE OR REPLACE FUNCTION public.guard_product_return_submission_enabled()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  settings_row public.product_inventory_commerce_settings%ROWTYPE;
BEGIN
  SELECT * INTO settings_row FROM public.product_inventory_commerce_settings
  WHERE organization_id = NEW.organization_id;
  IF settings_row.organization_id IS NULL
     OR NOT settings_row.finance_managed_receiving_enabled
     OR NOT settings_row.employee_custody_returns_enabled THEN
    RAISE EXCEPTION 'Employee custody returns are disabled for this organization.'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_product_return_submission_enabled ON public.product_return_requests;
CREATE TRIGGER trg_guard_product_return_submission_enabled
  BEFORE INSERT ON public.product_return_requests
  FOR EACH ROW EXECUTE FUNCTION public.guard_product_return_submission_enabled();

ALTER TABLE public.product_inventory_units
  ADD CONSTRAINT product_inventory_units_id_org_unique UNIQUE (id, organization_id);
ALTER TABLE public.product_handovers
  ADD CONSTRAINT product_handovers_id_org_unique UNIQUE (id, organization_id);
ALTER TABLE public.product_inventory_operational_assignments
  ADD CONSTRAINT product_inventory_operational_assignments_id_org_unique UNIQUE (id, organization_id);
ALTER TABLE public.product_return_requests
  ADD CONSTRAINT product_return_requests_id_org_unique UNIQUE (id, organization_id);
ALTER TABLE public.product_return_request_lines
  ADD CONSTRAINT product_return_request_lines_id_org_unique UNIQUE (id, organization_id);
ALTER TABLE public.product_return_receipts
  ADD CONSTRAINT product_return_receipts_id_org_unique UNIQUE (id, organization_id);

ALTER TABLE public.product_return_requests
  ADD CONSTRAINT product_return_requests_assignment_org_fk
  FOREIGN KEY (custodian_assignment_id, organization_id)
  REFERENCES public.product_inventory_operational_assignments(id, organization_id)
  ON DELETE RESTRICT NOT VALID;
ALTER TABLE public.product_return_request_lines
  ADD CONSTRAINT product_return_request_lines_request_org_fk
  FOREIGN KEY (return_request_id, organization_id)
  REFERENCES public.product_return_requests(id, organization_id)
  ON DELETE RESTRICT NOT VALID,
  ADD CONSTRAINT product_return_request_lines_unit_org_fk
  FOREIGN KEY (unit_id, organization_id)
  REFERENCES public.product_inventory_units(id, organization_id)
  ON DELETE RESTRICT NOT VALID,
  ADD CONSTRAINT product_return_request_lines_handover_org_fk
  FOREIGN KEY (handover_id, organization_id)
  REFERENCES public.product_handovers(id, organization_id)
  ON DELETE RESTRICT NOT VALID;
ALTER TABLE public.product_return_attachments
  ADD CONSTRAINT product_return_attachments_request_org_fk
  FOREIGN KEY (return_request_id, organization_id)
  REFERENCES public.product_return_requests(id, organization_id)
  ON DELETE RESTRICT NOT VALID,
  ADD CONSTRAINT product_return_attachments_line_org_fk
  FOREIGN KEY (return_line_id, organization_id)
  REFERENCES public.product_return_request_lines(id, organization_id)
  ON DELETE RESTRICT NOT VALID;
ALTER TABLE public.product_return_approvals
  ADD CONSTRAINT product_return_approvals_request_org_fk
  FOREIGN KEY (return_request_id, organization_id)
  REFERENCES public.product_return_requests(id, organization_id)
  ON DELETE RESTRICT NOT VALID;
ALTER TABLE public.product_return_receipts
  ADD CONSTRAINT product_return_receipts_request_org_fk
  FOREIGN KEY (return_request_id, organization_id)
  REFERENCES public.product_return_requests(id, organization_id)
  ON DELETE RESTRICT NOT VALID;
ALTER TABLE public.product_return_receipt_lines
  ADD CONSTRAINT product_return_receipt_lines_receipt_org_fk
  FOREIGN KEY (receipt_id, organization_id)
  REFERENCES public.product_return_receipts(id, organization_id)
  ON DELETE RESTRICT NOT VALID,
  ADD CONSTRAINT product_return_receipt_lines_request_line_org_fk
  FOREIGN KEY (request_line_id, organization_id)
  REFERENCES public.product_return_request_lines(id, organization_id)
  ON DELETE RESTRICT NOT VALID,
  ADD CONSTRAINT product_return_receipt_lines_unit_org_fk
  FOREIGN KEY (unit_id, organization_id)
  REFERENCES public.product_inventory_units(id, organization_id)
  ON DELETE RESTRICT NOT VALID;
ALTER TABLE public.product_inventory_units
  ADD CONSTRAINT product_inventory_units_active_return_line_org_fk
  FOREIGN KEY (active_return_request_line_id, organization_id)
  REFERENCES public.product_return_request_lines(id, organization_id)
  ON DELETE RESTRICT NOT VALID;
ALTER TABLE public.product_inventory_movements
  ADD CONSTRAINT product_inventory_movements_return_request_org_fk
  FOREIGN KEY (return_request_id, organization_id)
  REFERENCES public.product_return_requests(id, organization_id)
  ON DELETE RESTRICT NOT VALID,
  ADD CONSTRAINT product_inventory_movements_return_line_org_fk
  FOREIGN KEY (return_request_line_id, organization_id)
  REFERENCES public.product_return_request_lines(id, organization_id)
  ON DELETE RESTRICT NOT VALID;
ALTER TABLE public.product_inventory_loss_records
  ADD CONSTRAINT product_inventory_loss_records_return_request_org_fk
  FOREIGN KEY (return_request_id, organization_id)
  REFERENCES public.product_return_requests(id, organization_id)
  ON DELETE RESTRICT NOT VALID,
  ADD CONSTRAINT product_inventory_loss_records_return_line_org_fk
  FOREIGN KEY (return_request_line_id, organization_id)
  REFERENCES public.product_return_request_lines(id, organization_id)
  ON DELETE RESTRICT NOT VALID,
  ADD CONSTRAINT product_inventory_loss_records_return_receipt_org_fk
  FOREIGN KEY (return_receipt_id, organization_id)
  REFERENCES public.product_return_receipts(id, organization_id)
  ON DELETE RESTRICT NOT VALID;

ALTER TABLE public.product_return_requests VALIDATE CONSTRAINT product_return_requests_assignment_org_fk;
ALTER TABLE public.product_return_request_lines VALIDATE CONSTRAINT product_return_request_lines_request_org_fk;
ALTER TABLE public.product_return_request_lines VALIDATE CONSTRAINT product_return_request_lines_unit_org_fk;
ALTER TABLE public.product_return_request_lines VALIDATE CONSTRAINT product_return_request_lines_handover_org_fk;
ALTER TABLE public.product_return_attachments VALIDATE CONSTRAINT product_return_attachments_request_org_fk;
ALTER TABLE public.product_return_attachments VALIDATE CONSTRAINT product_return_attachments_line_org_fk;
ALTER TABLE public.product_return_approvals VALIDATE CONSTRAINT product_return_approvals_request_org_fk;
ALTER TABLE public.product_return_receipts VALIDATE CONSTRAINT product_return_receipts_request_org_fk;
ALTER TABLE public.product_return_receipt_lines VALIDATE CONSTRAINT product_return_receipt_lines_receipt_org_fk;
ALTER TABLE public.product_return_receipt_lines VALIDATE CONSTRAINT product_return_receipt_lines_request_line_org_fk;
ALTER TABLE public.product_return_receipt_lines VALIDATE CONSTRAINT product_return_receipt_lines_unit_org_fk;
ALTER TABLE public.product_inventory_units VALIDATE CONSTRAINT product_inventory_units_active_return_line_org_fk;
ALTER TABLE public.product_inventory_movements VALIDATE CONSTRAINT product_inventory_movements_return_request_org_fk;
ALTER TABLE public.product_inventory_movements VALIDATE CONSTRAINT product_inventory_movements_return_line_org_fk;
ALTER TABLE public.product_inventory_loss_records VALIDATE CONSTRAINT product_inventory_loss_records_return_request_org_fk;
ALTER TABLE public.product_inventory_loss_records VALIDATE CONSTRAINT product_inventory_loss_records_return_line_org_fk;
ALTER TABLE public.product_inventory_loss_records VALIDATE CONSTRAINT product_inventory_loss_records_return_receipt_org_fk;

CREATE INDEX IF NOT EXISTS product_return_requests_monitor_pending_idx
  ON public.product_return_requests (organization_id, submitted_at)
  WHERE status = 'pending_approval';
CREATE INDEX IF NOT EXISTS product_return_requests_monitor_delivery_idx
  ON public.product_return_requests (organization_id, approved_at)
  WHERE status IN ('approved_awaiting_delivery', 'partially_received');
CREATE INDEX IF NOT EXISTS product_inventory_custody_commands_processing_idx
  ON public.product_inventory_custody_commands (organization_id, created_at)
  WHERE status = 'processing';
CREATE INDEX IF NOT EXISTS product_inventory_loss_return_accounting_idx
  ON public.product_inventory_loss_records (organization_id, accounting_status, created_at)
  WHERE return_request_id IS NOT NULL
    AND accounting_status IN ('pending', 'pending_approval', 'failed');

CREATE OR REPLACE FUNCTION public.get_product_inventory_return_reconciliation(p_org_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  open_line_unit_mismatches integer;
  closed_line_unit_mismatches integer;
  orphan_active_units integer;
  damaged_without_loss integer;
  loss_link_mismatches integer;
  custody_report_units bigint;
  physical_custody_units bigint;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501';
  END IF;
  SELECT count(*)::integer INTO open_line_unit_mismatches
  FROM public.product_return_request_lines line
  JOIN public.product_return_requests request ON request.id = line.return_request_id
  JOIN public.product_inventory_units unit ON unit.id = line.unit_id
  WHERE line.organization_id = p_org_id
    AND line.status IN ('pending', 'awaiting_delivery')
    AND (
      unit.organization_id <> p_org_id
      OR unit.active_return_request_line_id IS DISTINCT FROM line.id
      OR unit.current_custodian_employee_id IS DISTINCT FROM request.custodian_employee_id
      OR (line.status = 'pending' AND unit.status <> 'return_pending')
      OR (line.status = 'awaiting_delivery' AND unit.status <> 'return_approved')
    );
  SELECT count(*)::integer INTO closed_line_unit_mismatches
  FROM public.product_return_request_lines line
  JOIN public.product_inventory_units unit ON unit.id = line.unit_id
  WHERE line.organization_id = p_org_id
    AND line.status IN ('received_sellable', 'received_quarantine', 'received_damaged')
    AND line.id = (
      SELECT latest_line.id
      FROM public.product_return_request_lines latest_line
      WHERE latest_line.organization_id = line.organization_id
        AND latest_line.unit_id = line.unit_id
        AND latest_line.status IN ('received_sellable', 'received_quarantine', 'received_damaged')
      ORDER BY latest_line.received_at DESC NULLS LAST, latest_line.created_at DESC, latest_line.id DESC
      LIMIT 1
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.product_inventory_movements later_movement
      WHERE later_movement.organization_id = line.organization_id
        AND later_movement.unit_id = line.unit_id
        AND later_movement.movement_at > line.received_at
    )
    AND (
      unit.active_return_request_line_id IS NOT NULL
      OR unit.current_custodian_employee_id IS NOT NULL
      OR (line.status = 'received_sellable' AND unit.status <> 'in_stock')
      OR (line.status = 'received_quarantine' AND unit.status <> 'quarantine')
      OR (line.status = 'received_damaged' AND unit.status <> 'damaged')
    );
  SELECT count(*)::integer INTO orphan_active_units
  FROM public.product_inventory_units unit
  LEFT JOIN public.product_return_request_lines line
    ON line.id = unit.active_return_request_line_id
   AND line.organization_id = unit.organization_id
  WHERE unit.organization_id = p_org_id
    AND unit.active_return_request_line_id IS NOT NULL
    AND (line.id IS NULL OR line.status NOT IN ('pending', 'awaiting_delivery'));
  SELECT count(*)::integer INTO damaged_without_loss
  FROM public.product_return_request_lines line
  LEFT JOIN public.product_inventory_loss_records loss
    ON loss.return_request_line_id = line.id AND loss.organization_id = line.organization_id
  WHERE line.organization_id = p_org_id
    AND line.status = 'received_damaged' AND loss.id IS NULL;
  SELECT count(*)::integer INTO loss_link_mismatches
  FROM public.product_inventory_loss_records loss
  JOIN public.product_return_request_lines line ON line.id = loss.return_request_line_id
  WHERE loss.organization_id = p_org_id
    AND (line.organization_id <> p_org_id OR line.unit_id <> loss.unit_id
      OR line.status <> 'received_damaged');
  SELECT COALESCE(sum(report.physically_held_units), 0) INTO custody_report_units
  FROM public.get_product_inventory_employee_custody_report(p_org_id) report;
  SELECT count(*) INTO physical_custody_units
  FROM public.product_inventory_units unit
  WHERE unit.organization_id = p_org_id
    AND unit.current_custodian_employee_id IS NOT NULL
    AND unit.status IN ('in_transit', 'with_custodian', 'return_pending', 'return_approved');
  RETURN jsonb_build_object(
    'openLineUnitMismatches', open_line_unit_mismatches,
    'closedLineUnitMismatches', closed_line_unit_mismatches,
    'orphanActiveUnits', orphan_active_units,
    'damagedWithoutLoss', damaged_without_loss,
    'lossLinkMismatches', loss_link_mismatches,
    'custodyReportUnits', custody_report_units,
    'physicalCustodyUnits', physical_custody_units,
    'custodyDifference', custody_report_units - physical_custody_units,
    'balanced', open_line_unit_mismatches = 0
      AND closed_line_unit_mismatches = 0
      AND orphan_active_units = 0
      AND damaged_without_loss = 0
      AND loss_link_mismatches = 0
      AND custody_report_units = physical_custody_units
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_product_inventory_return_reconciliation(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_product_inventory_return_reconciliation(uuid)
  TO service_role;

COMMENT ON COLUMN public.product_inventory_commerce_settings.employee_custody_returns_enabled IS
  'Organization rollout switch for new return submissions; in-flight requests remain completable.';
COMMENT ON FUNCTION public.get_product_inventory_return_reconciliation(uuid) IS
  'Exact return-line, serialized-unit, custody-report, and damage-accounting reconciliation.';
