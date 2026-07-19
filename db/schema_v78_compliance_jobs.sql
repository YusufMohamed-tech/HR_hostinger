-- Enqueue timezone-aware personnel deadlines with durable deduplication.

CREATE TABLE IF NOT EXISTS public.compliance_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  source_type text NOT NULL CHECK (source_type IN ('personnel_file', 'contract_end', 'probation_end')),
  source_id uuid NOT NULL,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  deadline_date date NOT NULL,
  milestone_days integer NOT NULL CHECK (milestone_days IN (30, 14, 7, 1, 0, -7, -30)),
  business_date date NOT NULL,
  event_id uuid REFERENCES public.business_events(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, source_type, source_id, deadline_date, milestone_days)
);
CREATE INDEX IF NOT EXISTS idx_compliance_alerts_org_deadline ON public.compliance_alerts(org_id, deadline_date DESC);
ALTER TABLE public.compliance_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY compliance_alerts_service_only ON public.compliance_alerts FOR ALL
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

CREATE TABLE IF NOT EXISTS public.compliance_job_runs (
  id uuid PRIMARY KEY,
  request_id uuid NOT NULL,
  started_at timestamptz NOT NULL,
  completed_at timestamptz,
  alerts_enqueued integer NOT NULL DEFAULT 0 CHECK (alerts_enqueued >= 0),
  result jsonb NOT NULL DEFAULT '{}'::jsonb
);
ALTER TABLE public.compliance_job_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY compliance_job_runs_service_only ON public.compliance_job_runs FOR ALL
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

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
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.compliance_job_runs (id, request_id, started_at)
  VALUES (p_run_id, p_request_id, p_now) ON CONFLICT (id) DO NOTHING;
  IF (SELECT completed_at IS NOT NULL FROM public.compliance_job_runs WHERE id = p_run_id) THEN
    RETURN (SELECT result FROM public.compliance_job_runs WHERE id = p_run_id);
  END IF;
  FOR candidate IN
    WITH deadlines AS (
      SELECT file.org_id, 'personnel_file'::text AS source_type, file.id AS source_id,
        file.employee_id, file.expiry_date AS deadline_date,
        COALESCE(NULLIF(file.category, ''), 'Document') AS deadline_label
      FROM public.personnel_files file WHERE file.expiry_date IS NOT NULL
      UNION ALL
      SELECT contract.org_id, 'contract_end', contract.id, contract.employee_id,
        contract.end_date, 'Contract expiry'
      FROM public.employee_contracts contract
      WHERE contract.end_date IS NOT NULL AND contract.status = 'active'
      UNION ALL
      SELECT contract.org_id, 'probation_end', contract.id, contract.employee_id,
        contract.probation_end_date, 'Probation end'
      FROM public.employee_contracts contract
      WHERE contract.probation_end_date IS NOT NULL AND contract.status = 'active'
    )
    SELECT deadline.*, employee.full_name,
      public.organization_business_date(deadline.org_id, p_now) AS business_date,
      deadline.deadline_date - public.organization_business_date(deadline.org_id, p_now) AS milestone_days
    FROM deadlines deadline
    JOIN public.employees employee ON employee.org_id = deadline.org_id AND employee.id = deadline.employee_id
    WHERE deadline.deadline_date - public.organization_business_date(deadline.org_id, p_now)
      IN (30, 14, 7, 1, 0, -7, -30)
  LOOP
    INSERT INTO public.compliance_alerts (org_id, source_type, source_id, employee_id,
      deadline_date, milestone_days, business_date)
    VALUES (candidate.org_id, candidate.source_type, candidate.source_id, candidate.employee_id,
      candidate.deadline_date, candidate.milestone_days, candidate.business_date)
    ON CONFLICT (org_id, source_type, source_id, deadline_date, milestone_days) DO NOTHING
    RETURNING * INTO alert_row;
    IF alert_row.id IS NULL THEN CONTINUE; END IF;
    event_payload := jsonb_build_object('event_type', 'compliance.deadline', 'alert_id', alert_row.id,
      'source_type', candidate.source_type, 'source_id', candidate.source_id,
      'employee_id', candidate.employee_id, 'employee_name', candidate.full_name,
      'deadline_label', candidate.deadline_label, 'deadline_date', candidate.deadline_date,
      'days_remaining', candidate.milestone_days, 'business_date', candidate.business_date);
    INSERT INTO public.business_events (org_id, source_type, business_key, payload, payload_hash,
      status, request_id, occurred_at, processed_at)
    VALUES (candidate.org_id, 'compliance', alert_row.id::text, event_payload,
      encode(digest(event_payload::text, 'sha256'), 'hex'), 'completed', p_request_id, p_now, p_now)
    RETURNING id INTO event_id_value;
    INSERT INTO public.event_outbox (org_id, business_event_id, topic, payload, payload_hash)
    VALUES (candidate.org_id, event_id_value, 'compliance.deadline', event_payload,
      encode(digest(event_payload::text, 'sha256'), 'hex'));
    UPDATE public.compliance_alerts SET event_id = event_id_value WHERE id = alert_row.id;
    enqueued := enqueued + 1;
    alert_row := NULL;
  END LOOP;
  result_value := jsonb_build_object('runId', p_run_id, 'alertsEnqueued', enqueued, 'completedAt', now());
  UPDATE public.compliance_job_runs SET completed_at = now(), alerts_enqueued = enqueued, result = result_value
  WHERE id = p_run_id;
  RETURN result_value;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_compliance_alerts(uuid, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_compliance_alerts(uuid, uuid, timestamptz) TO service_role;
