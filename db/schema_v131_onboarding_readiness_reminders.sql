-- Add onboarding requirements to the existing durable compliance reminder job,
-- and expose capability readiness without coupling it to account access.

ALTER TABLE public.compliance_alerts
  DROP CONSTRAINT IF EXISTS compliance_alerts_source_type_check,
  ADD CONSTRAINT compliance_alerts_source_type_check CHECK (
    source_type IN ('personnel_file', 'contract_end', 'probation_end', 'onboarding_item')
  ),
  DROP CONSTRAINT IF EXISTS compliance_alerts_milestone_days_check,
  ADD CONSTRAINT compliance_alerts_milestone_days_check CHECK (
    milestone_days IN (30, 14, 7, 3, 1, 0, -1, -7, -14, -30)
  );

CREATE OR REPLACE FUNCTION public.refresh_employee_onboarding_from_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  employee_id_value uuid;
BEGIN
  employee_id_value := CASE WHEN TG_OP = 'DELETE' THEN OLD.employee_id ELSE NEW.employee_id END;
  PERFORM public.refresh_employee_onboarding(employee_id_value);
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_employee_onboarding_from_employee()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.refresh_employee_onboarding(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS refresh_onboarding_employee_details_trigger ON public.employees;
CREATE TRIGGER refresh_onboarding_employee_details_trigger
  AFTER UPDATE OF payment_method, iban, bank_account,
    emergency_contact_name, emergency_contact_phone, hiring_date, employment_type
  ON public.employees
  FOR EACH ROW EXECUTE FUNCTION public.refresh_employee_onboarding_from_employee();

DROP TRIGGER IF EXISTS refresh_onboarding_employee_locations_trigger ON public.employee_locations;
CREATE TRIGGER refresh_onboarding_employee_locations_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.employee_locations
  FOR EACH ROW EXECUTE FUNCTION public.refresh_employee_onboarding_from_change();

DROP TRIGGER IF EXISTS refresh_onboarding_employee_shifts_trigger ON public.employee_shifts;
CREATE TRIGGER refresh_onboarding_employee_shifts_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.employee_shifts
  FOR EACH ROW EXECUTE FUNCTION public.refresh_employee_onboarding_from_change();

DROP TRIGGER IF EXISTS refresh_onboarding_social_insurance_trigger ON public.social_insurance;
CREATE TRIGGER refresh_onboarding_social_insurance_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.social_insurance
  FOR EACH ROW EXECUTE FUNCTION public.refresh_employee_onboarding_from_change();

DROP TRIGGER IF EXISTS refresh_onboarding_contracts_trigger ON public.employee_contracts;
CREATE TRIGGER refresh_onboarding_contracts_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.employee_contracts
  FOR EACH ROW EXECUTE FUNCTION public.refresh_employee_onboarding_from_change();

DROP TRIGGER IF EXISTS refresh_onboarding_personnel_files_trigger ON public.personnel_files;
CREATE TRIGGER refresh_onboarding_personnel_files_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.personnel_files
  FOR EACH ROW EXECUTE FUNCTION public.refresh_employee_onboarding_from_change();

CREATE OR REPLACE VIEW public.employee_capability_readiness
WITH (security_invoker = true)
AS
SELECT
  employee.org_id,
  employee.id AS employee_id,
  capability.capability,
  employee.lifecycle_status = 'active' AS account_and_employment_active,
  count(item.id) FILTER (
    WHERE item.capability = capability.capability
      AND item.status NOT IN ('verified', 'waived', 'not_applicable')
  ) = 0 AS is_ready,
  COALESCE(
    array_agg(item.requirement_code ORDER BY item.due_at, item.requirement_code)
      FILTER (
        WHERE item.capability = capability.capability
          AND item.status NOT IN ('verified', 'waived', 'not_applicable')
      ),
    ARRAY[]::text[]
  ) AS blocking_requirements
FROM public.employees employee
CROSS JOIN (
  VALUES
    ('general'::text),
    ('payroll'::text),
    ('payroll_payment'::text),
    ('attendance'::text),
    ('inventory'::text),
    ('sales'::text),
    ('accounting'::text)
) capability(capability)
LEFT JOIN public.employee_onboarding_items item
  ON item.org_id = employee.org_id
 AND item.employee_id = employee.id
 AND item.capability = capability.capability
WHERE employee.lifecycle_status NOT IN ('offboarded', 'archived')
GROUP BY employee.org_id, employee.id, employee.lifecycle_status, capability.capability;

CREATE OR REPLACE FUNCTION public.enqueue_compliance_alerts(
  p_run_id uuid, p_request_id uuid, p_now timestamptz DEFAULT now()
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  candidate record;
  alert_row public.compliance_alerts%ROWTYPE;
  event_payload jsonb;
  event_id_value uuid;
  enqueued integer := 0;
  result_value jsonb;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.compliance_job_runs (id, request_id, started_at)
  VALUES (p_run_id, p_request_id, p_now) ON CONFLICT (id) DO NOTHING;
  IF (SELECT completed_at IS NOT NULL FROM public.compliance_job_runs WHERE id = p_run_id) THEN
    RETURN (SELECT result FROM public.compliance_job_runs WHERE id = p_run_id);
  END IF;

  FOR candidate IN
    WITH deadlines AS (
      SELECT
        file.org_id,
        'personnel_file'::text AS source_type,
        file.id AS source_id,
        file.employee_id,
        file.expiry_date AS deadline_date,
        COALESCE(NULLIF(file.category, ''), 'Document') AS deadline_label,
        NULL::boolean AS employee_can_submit
      FROM public.personnel_files file
      WHERE file.expiry_date IS NOT NULL
      UNION ALL
      SELECT
        contract.org_id, 'contract_end', contract.id, contract.employee_id,
        contract.end_date, 'Contract expiry', NULL::boolean
      FROM public.employee_contracts contract
      WHERE contract.end_date IS NOT NULL AND contract.status = 'active'
      UNION ALL
      SELECT
        contract.org_id, 'probation_end', contract.id, contract.employee_id,
        contract.probation_end_date, 'Probation end', NULL::boolean
      FROM public.employee_contracts contract
      WHERE contract.probation_end_date IS NOT NULL AND contract.status = 'active'
      UNION ALL
      SELECT
        item.org_id, 'onboarding_item', item.id, item.employee_id,
        item.due_at, item.label_ar, template.employee_can_submit
      FROM public.employee_onboarding_items item
      LEFT JOIN public.onboarding_requirement_templates template ON template.id = item.template_id
      WHERE item.due_at IS NOT NULL
        AND item.status NOT IN ('verified', 'waived', 'not_applicable')
    )
    SELECT
      deadline.*,
      employee.full_name,
      public.organization_business_date(deadline.org_id, p_now) AS business_date,
      deadline.deadline_date - public.organization_business_date(deadline.org_id, p_now) AS milestone_days
    FROM deadlines deadline
    JOIN public.employees employee
      ON employee.org_id = deadline.org_id
     AND employee.id = deadline.employee_id
    WHERE deadline.deadline_date - public.organization_business_date(deadline.org_id, p_now)
      IN (30, 14, 7, 3, 1, 0, -1, -7, -14, -30)
  LOOP
    INSERT INTO public.compliance_alerts (
      org_id, source_type, source_id, employee_id,
      deadline_date, milestone_days, business_date
    )
    VALUES (
      candidate.org_id, candidate.source_type, candidate.source_id, candidate.employee_id,
      candidate.deadline_date, candidate.milestone_days, candidate.business_date
    )
    ON CONFLICT (org_id, source_type, source_id, deadline_date, milestone_days) DO NOTHING
    RETURNING * INTO alert_row;
    IF alert_row.id IS NULL THEN CONTINUE; END IF;

    event_payload := jsonb_build_object(
      'event_type', 'compliance.deadline',
      'alert_id', alert_row.id,
      'source_type', candidate.source_type,
      'source_id', candidate.source_id,
      'employee_id', candidate.employee_id,
      'employee_name', candidate.full_name,
      'deadline_label', candidate.deadline_label,
      'deadline_date', candidate.deadline_date,
      'days_remaining', candidate.milestone_days,
      'business_date', candidate.business_date,
      'employee_can_submit', COALESCE(candidate.employee_can_submit, false)
    );
    INSERT INTO public.business_events (
      org_id, source_type, business_key, payload, payload_hash,
      status, request_id, occurred_at, processed_at
    )
    VALUES (
      candidate.org_id, 'compliance', alert_row.id::text, event_payload,
      encode(digest(event_payload::text, 'sha256'), 'hex'),
      'completed', p_request_id, p_now, p_now
    )
    RETURNING id INTO event_id_value;
    INSERT INTO public.event_outbox (
      org_id, business_event_id, topic, payload, payload_hash
    )
    VALUES (
      candidate.org_id, event_id_value, 'compliance.deadline', event_payload,
      encode(digest(event_payload::text, 'sha256'), 'hex')
    );
    UPDATE public.compliance_alerts SET event_id = event_id_value WHERE id = alert_row.id;
    enqueued := enqueued + 1;
    alert_row := NULL;
  END LOOP;

  result_value := jsonb_build_object(
    'runId', p_run_id,
    'alertsEnqueued', enqueued,
    'completedAt', now()
  );
  UPDATE public.compliance_job_runs
  SET completed_at = now(), alerts_enqueued = enqueued, result = result_value
  WHERE id = p_run_id;
  RETURN result_value;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_compliance_alerts(uuid, uuid, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_compliance_alerts(uuid, uuid, timestamptz)
  TO service_role;
