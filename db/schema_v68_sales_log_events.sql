-- Immutable sales-log revisions with atomic submission, correction, rejection,
-- void, audit, and accounting outbox events.

ALTER TABLE public.sales_logs
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS voided_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS voided_at timestamptz,
  ADD COLUMN IF NOT EXISTS void_reason text;
ALTER TABLE public.sales_logs DROP CONSTRAINT IF EXISTS sales_logs_status_check;
ALTER TABLE public.sales_logs ADD CONSTRAINT sales_logs_status_check
  CHECK (status IN ('submitted', 'reviewed', 'voided'));
ALTER TABLE public.sales_logs DROP CONSTRAINT IF EXISTS sales_logs_version_check;
ALTER TABLE public.sales_logs ADD CONSTRAINT sales_logs_version_check CHECK (version > 0);

CREATE TABLE IF NOT EXISTS public.sales_log_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  sales_log_id uuid NOT NULL REFERENCES public.sales_logs(id) ON DELETE RESTRICT,
  revision_number integer NOT NULL CHECK (revision_number > 0),
  event_type text NOT NULL CHECK (event_type IN ('original', 'correction', 'void')),
  previous_revision_id uuid REFERENCES public.sales_log_revisions(id) ON DELETE RESTRICT,
  edit_request_id uuid REFERENCES public.sales_log_edit_requests(id) ON DELETE RESTRICT,
  items jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(items) = 'array'),
  subtotal numeric(14,2) NOT NULL CHECK (subtotal >= 0),
  total_discount numeric(14,2) NOT NULL CHECK (total_discount >= 0),
  grand_total numeric(14,2) NOT NULL CHECK (grand_total >= 0),
  notes text,
  reason text,
  accounting_status text NOT NULL DEFAULT 'pending'
    CHECK (accounting_status IN ('pending', 'posted', 'reversal_pending', 'reversed', 'failed')),
  accounting_journal_entry_id uuid REFERENCES public.accounting_journal_entries(id) ON DELETE SET NULL,
  accounting_reversal_entry_id uuid REFERENCES public.accounting_journal_entries(id) ON DELETE SET NULL,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sales_log_id, revision_number),
  UNIQUE (organization_id, edit_request_id)
);

ALTER TABLE public.sales_logs
  ADD COLUMN IF NOT EXISTS current_revision_id uuid REFERENCES public.sales_log_revisions(id) ON DELETE RESTRICT;

INSERT INTO public.sales_log_revisions (
  organization_id, sales_log_id, revision_number, event_type, items, subtotal,
  total_discount, grand_total, notes, accounting_status,
  accounting_journal_entry_id, created_by, created_at
)
SELECT log.organization_id, log.id, 1, 'original', log.items, log.subtotal,
  log.total_discount, log.grand_total, log.notes,
  CASE WHEN journal.id IS NULL THEN 'pending' ELSE 'posted' END,
  journal.id, log.sales_agent_id, log.created_at
FROM public.sales_logs log
LEFT JOIN LATERAL (
  SELECT entry.id FROM public.accounting_journal_entries entry
  WHERE entry.organization_id = log.organization_id AND entry.source_module = 'sales_log'
    AND entry.source_id = log.id AND entry.status IN ('posted', 'reversed')
  ORDER BY entry.created_at DESC LIMIT 1
) journal ON true
WHERE NOT EXISTS (SELECT 1 FROM public.sales_log_revisions revision WHERE revision.sales_log_id = log.id);

UPDATE public.sales_logs log SET current_revision_id = revision.id
FROM public.sales_log_revisions revision
WHERE revision.sales_log_id = log.id AND revision.revision_number = log.version
  AND log.current_revision_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_log_pending_edit_request
  ON public.sales_log_edit_requests(organization_id, sales_log_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS sales_log_revisions_org_date_idx
  ON public.sales_log_revisions(organization_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.sales_log_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  idempotency_key uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('submit', 'correct', 'reject', 'void')),
  entity_id uuid,
  payload_hash text NOT NULL CHECK (length(payload_hash) = 64),
  status text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'completed')),
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  request_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (organization_id, idempotency_key)
);

ALTER TABLE public.sales_log_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_log_commands ENABLE ROW LEVEL SECURITY;
CREATE POLICY sales_log_revisions_select ON public.sales_log_revisions FOR SELECT USING (
  auth.role() = 'service_role' OR organization_id = public.current_org_id()
);
CREATE POLICY sales_log_commands_select ON public.sales_log_commands FOR SELECT USING (
  auth.role() = 'service_role' OR (organization_id = public.current_org_id()
    AND public.current_role() IN ('admin', 'hr_admin', 'sales_manager'))
);

DROP POLICY IF EXISTS sales_logs_insert ON public.sales_logs;
DROP POLICY IF EXISTS sales_logs_update ON public.sales_logs;
DROP POLICY IF EXISTS sales_log_edit_requests_update ON public.sales_log_edit_requests;

CREATE OR REPLACE FUNCTION public.canonical_sales_log_items(
  p_org_id uuid, p_company_id uuid, p_items jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE requested_count integer; valid_count integer; result jsonb;
BEGIN
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'Sales log must contain between 1 and 200 items.' USING ERRCODE = '23514';
  END IF;
  SELECT count(*), count(DISTINCT item->>'product_id') INTO requested_count, valid_count
  FROM jsonb_array_elements(p_items) item;
  IF requested_count <> valid_count THEN RAISE EXCEPTION 'A product may appear only once per sales log.' USING ERRCODE = '23514'; END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_items) item
    WHERE NULLIF(item->>'product_id', '') IS NULL
      OR COALESCE((item->>'quantity')::numeric, 0) <> trunc(COALESCE((item->>'quantity')::numeric, 0))
      OR COALESCE((item->>'quantity')::numeric, 0) NOT BETWEEN 1 AND 1000000
      OR COALESCE((item->>'discount_percent')::numeric, 0) NOT BETWEEN 0 AND 100
  ) THEN RAISE EXCEPTION 'Sales item quantity or discount is invalid.' USING ERRCODE = '23514'; END IF;
  SELECT count(*) INTO valid_count FROM public.sales_products product
  WHERE product.organization_id = p_org_id AND product.company_id = p_company_id AND product.is_active
    AND product.id IN (SELECT (item->>'product_id')::uuid FROM jsonb_array_elements(p_items) item);
  IF valid_count <> requested_count THEN RAISE EXCEPTION 'Every sales item must be an active product in the selected company.' USING ERRCODE = '23514'; END IF;
  SELECT jsonb_agg(jsonb_build_object(
    'product_id', product.id, 'product_name', product.name,
    'quantity', (item->>'quantity')::integer, 'unit_price', round(product.price, 2),
    'discount_percent', round(COALESCE((item->>'discount_percent')::numeric, 0), 2),
    'discount_amount', round(product.price * (item->>'quantity')::integer * COALESCE((item->>'discount_percent')::numeric, 0) / 100, 2),
    'line_total', round(product.price * (item->>'quantity')::integer * (1 - COALESCE((item->>'discount_percent')::numeric, 0) / 100), 2)
  ) ORDER BY product.id) INTO result
  FROM jsonb_array_elements(p_items) item
  JOIN public.sales_products product ON product.id = (item->>'product_id')::uuid
    AND product.organization_id = p_org_id AND product.company_id = p_company_id;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_sales_log(
  p_org_id uuid, p_actor_user_id uuid, p_command_id uuid, p_request_id uuid,
  p_company_id uuid, p_items jsonb, p_notes text
)
RETURNS SETOF public.sales_logs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  command_row public.sales_log_commands%ROWTYPE; log_row public.sales_logs%ROWTYPE;
  revision_row public.sales_log_revisions%ROWTYPE; actor_role_value text;
  canonical_items jsonb; subtotal_value numeric(14,2); discount_value numeric(14,2); total_value numeric(14,2);
  event_payload jsonb; event_id uuid; business_date date := public.organization_business_date(p_org_id, now());
  payload_value jsonb := jsonb_build_object('company_id', p_company_id, 'items', p_items, 'notes', COALESCE(p_notes, ''));
  hash_value text := encode(digest(payload_value::text, 'sha256'), 'hex');
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501'; END IF;
  SELECT role::text INTO actor_role_value FROM public.org_members WHERE org_id = p_org_id AND user_id = p_actor_user_id;
  IF actor_role_value NOT IN ('sales', 'sales_manager') OR NOT EXISTS (
    SELECT 1 FROM public.sales_company_assignments assignment
    WHERE assignment.organization_id = p_org_id AND assignment.company_id = p_company_id
      AND assignment.user_id = p_actor_user_id AND assignment.is_active
      AND assignment.start_date <= business_date AND (assignment.end_date IS NULL OR assignment.end_date >= business_date)
  ) THEN RAISE EXCEPTION 'An active sales company assignment is required.' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.sales_log_commands (organization_id, idempotency_key, action, payload_hash, actor_user_id, request_id)
  VALUES (p_org_id, p_command_id, 'submit', hash_value, p_actor_user_id, p_request_id)
  ON CONFLICT (organization_id, idempotency_key) DO NOTHING;
  SELECT * INTO command_row FROM public.sales_log_commands WHERE organization_id = p_org_id AND idempotency_key = p_command_id FOR UPDATE;
  IF command_row.action <> 'submit' OR command_row.payload_hash <> hash_value THEN RAISE EXCEPTION 'Idempotency key was reused for another sales command.' USING ERRCODE = '23505'; END IF;
  IF command_row.status = 'completed' THEN RETURN QUERY SELECT * FROM public.sales_logs WHERE organization_id = p_org_id AND id = command_row.entity_id; RETURN; END IF;
  canonical_items := public.canonical_sales_log_items(p_org_id, p_company_id, p_items);
  SELECT round(sum((item->>'quantity')::numeric * (item->>'unit_price')::numeric), 2),
    round(sum((item->>'discount_amount')::numeric), 2), round(sum((item->>'line_total')::numeric), 2)
    INTO subtotal_value, discount_value, total_value FROM jsonb_array_elements(canonical_items) item;
  INSERT INTO public.sales_logs (organization_id, company_id, sales_agent_id, log_date, items,
    subtotal, total_discount, grand_total, notes, status, version)
  VALUES (p_org_id, p_company_id, p_actor_user_id, business_date, canonical_items,
    subtotal_value, discount_value, total_value, NULLIF(btrim(p_notes), ''), 'submitted', 1)
  RETURNING * INTO log_row;
  INSERT INTO public.sales_log_revisions (organization_id, sales_log_id, revision_number, event_type,
    items, subtotal, total_discount, grand_total, notes, created_by)
  VALUES (p_org_id, log_row.id, 1, 'original', canonical_items, subtotal_value,
    discount_value, total_value, log_row.notes, p_actor_user_id) RETURNING * INTO revision_row;
  UPDATE public.sales_logs SET current_revision_id = revision_row.id WHERE id = log_row.id RETURNING * INTO log_row;
  event_payload := jsonb_build_object('event_type', 'sales_log.submitted', 'sales_log_id', log_row.id,
    'revision_id', revision_row.id, 'revision_number', 1, 'company_id', p_company_id,
    'sales_agent_id', p_actor_user_id, 'log_date', business_date, 'grand_total', total_value);
  INSERT INTO public.business_events (org_id, source_type, business_key, event_version, payload,
    payload_hash, status, request_id, actor_user_id, occurred_at, processed_at)
  VALUES (p_org_id, 'sales_log', log_row.id::text || ':submitted:1', 1, event_payload,
    encode(digest(event_payload::text, 'sha256'), 'hex'), 'completed', p_request_id, p_actor_user_id, now(), now()) RETURNING id INTO event_id;
  INSERT INTO public.event_outbox (org_id, business_event_id, topic, payload, payload_hash)
  VALUES (p_org_id, event_id, 'sales_log.submitted', event_payload, encode(digest(event_payload::text, 'sha256'), 'hex'));
  UPDATE public.sales_log_commands SET entity_id = log_row.id, status = 'completed', completed_at = now(), result = event_payload WHERE id = command_row.id;
  RETURN NEXT log_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_sales_log_edit(
  p_org_id uuid, p_actor_user_id uuid, p_command_id uuid, p_request_id uuid,
  p_edit_request_id uuid, p_expected_version integer, p_decision text,
  p_items jsonb, p_notes text, p_resolution_note text
)
RETURNS SETOF public.sales_log_edit_requests
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  command_row public.sales_log_commands%ROWTYPE; request_row public.sales_log_edit_requests%ROWTYPE;
  log_row public.sales_logs%ROWTYPE; old_revision public.sales_log_revisions%ROWTYPE;
  new_revision public.sales_log_revisions%ROWTYPE; actor_role_value text;
  canonical_items jsonb; subtotal_value numeric(14,2); discount_value numeric(14,2); total_value numeric(14,2);
  event_payload jsonb; event_id uuid;
  payload_value jsonb := jsonb_build_object('edit_request_id', p_edit_request_id,
    'expected_version', p_expected_version, 'decision', p_decision, 'items', COALESCE(p_items, '[]'::jsonb),
    'notes', COALESCE(p_notes, ''), 'resolution_note', COALESCE(p_resolution_note, ''));
  hash_value text := encode(digest(payload_value::text, 'sha256'), 'hex');
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501'; END IF;
  IF p_decision NOT IN ('applied', 'rejected') THEN RAISE EXCEPTION 'Unsupported sales edit decision.' USING ERRCODE = '22023'; END IF;
  SELECT role::text INTO actor_role_value FROM public.org_members
    WHERE org_id = p_org_id AND user_id = p_actor_user_id AND role::text IN ('admin', 'hr_admin', 'sales_manager');
  IF actor_role_value IS NULL THEN RAISE EXCEPTION 'Sales management access is required.' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.sales_log_commands (organization_id, idempotency_key, action, entity_id, payload_hash, actor_user_id, request_id)
  VALUES (p_org_id, p_command_id, CASE WHEN p_decision = 'applied' THEN 'correct' ELSE 'reject' END,
    p_edit_request_id, hash_value, p_actor_user_id, p_request_id)
  ON CONFLICT (organization_id, idempotency_key) DO NOTHING;
  SELECT * INTO command_row FROM public.sales_log_commands WHERE organization_id = p_org_id AND idempotency_key = p_command_id FOR UPDATE;
  IF command_row.action <> (CASE WHEN p_decision = 'applied' THEN 'correct' ELSE 'reject' END)
     OR command_row.payload_hash <> hash_value THEN RAISE EXCEPTION 'Idempotency key was reused for another sales command.' USING ERRCODE = '23505'; END IF;
  IF command_row.status = 'completed' THEN RETURN QUERY SELECT * FROM public.sales_log_edit_requests WHERE organization_id = p_org_id AND id = p_edit_request_id; RETURN; END IF;
  SELECT * INTO request_row FROM public.sales_log_edit_requests
    WHERE organization_id = p_org_id AND id = p_edit_request_id FOR UPDATE;
  IF request_row.id IS NULL THEN RAISE EXCEPTION 'Sales edit request was not found.' USING ERRCODE = 'P0002'; END IF;
  IF request_row.status <> 'pending' THEN RAISE EXCEPTION 'Sales edit request was already resolved.' USING ERRCODE = '40001'; END IF;
  SELECT * INTO log_row FROM public.sales_logs
    WHERE organization_id = p_org_id AND id = request_row.sales_log_id FOR UPDATE;
  IF log_row.id IS NULL OR log_row.version <> p_expected_version OR log_row.status = 'voided' THEN
    RAISE EXCEPTION 'Sales log state or version conflict.' USING ERRCODE = '40001';
  END IF;
  IF actor_role_value = 'sales_manager' AND NOT EXISTS (
    SELECT 1 FROM public.sales_company_assignments assignment
    WHERE assignment.organization_id = p_org_id AND assignment.company_id = log_row.company_id
      AND assignment.user_id = p_actor_user_id AND assignment.assignment_role = 'manager'
      AND assignment.is_active AND assignment.start_date <= public.organization_business_date(p_org_id, now())
      AND (assignment.end_date IS NULL OR assignment.end_date >= public.organization_business_date(p_org_id, now()))
  ) THEN RAISE EXCEPTION 'The sales manager is not assigned to this company.' USING ERRCODE = '42501'; END IF;
  IF p_decision = 'rejected' THEN
    UPDATE public.sales_log_edit_requests SET status = 'rejected', resolved_by = p_actor_user_id,
      resolved_at = now(), resolution_note = NULLIF(btrim(p_resolution_note), ''), updated_at = now()
    WHERE id = request_row.id RETURNING * INTO request_row;
    UPDATE public.sales_log_commands SET status = 'completed', completed_at = now(),
      result = jsonb_build_object('edit_request_id', request_row.id, 'status', request_row.status)
    WHERE id = command_row.id;
    RETURN NEXT request_row; RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM public.accounting_invoices invoice WHERE invoice.organization_id = p_org_id
      AND invoice.source_module = 'sales_log' AND invoice.source_id = log_row.id
      AND invoice.status NOT IN ('cancelled', 'void')) THEN
    RAISE EXCEPTION 'Reverse or void the linked sales invoice before correcting this log.' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO old_revision FROM public.sales_log_revisions
    WHERE organization_id = p_org_id AND id = log_row.current_revision_id FOR UPDATE;
  canonical_items := public.canonical_sales_log_items(p_org_id, log_row.company_id, p_items);
  SELECT round(sum((item->>'quantity')::numeric * (item->>'unit_price')::numeric), 2),
    round(sum((item->>'discount_amount')::numeric), 2), round(sum((item->>'line_total')::numeric), 2)
    INTO subtotal_value, discount_value, total_value FROM jsonb_array_elements(canonical_items) item;
  UPDATE public.sales_log_revisions SET accounting_status = CASE WHEN accounting_status = 'posted' THEN 'reversal_pending' ELSE 'reversed' END
    WHERE id = old_revision.id;
  INSERT INTO public.sales_log_revisions (organization_id, sales_log_id, revision_number, event_type,
    previous_revision_id, edit_request_id, items, subtotal, total_discount, grand_total, notes,
    reason, created_by)
  VALUES (p_org_id, log_row.id, log_row.version + 1, 'correction', old_revision.id,
    request_row.id, canonical_items, subtotal_value, discount_value, total_value,
    NULLIF(btrim(p_notes), ''), NULLIF(btrim(p_resolution_note), ''), p_actor_user_id)
  RETURNING * INTO new_revision;
  UPDATE public.sales_logs SET items = canonical_items, subtotal = subtotal_value,
    total_discount = discount_value, grand_total = total_value, notes = NULLIF(btrim(p_notes), ''),
    status = 'reviewed', reviewed_by = p_actor_user_id, reviewed_at = now(),
    current_revision_id = new_revision.id, version = version + 1, updated_at = now()
  WHERE id = log_row.id RETURNING * INTO log_row;
  UPDATE public.sales_log_edit_requests SET status = 'applied', resolved_by = p_actor_user_id,
    resolved_at = now(), resolution_note = NULLIF(btrim(p_resolution_note), ''), updated_at = now()
  WHERE id = request_row.id RETURNING * INTO request_row;
  event_payload := jsonb_build_object('event_type', 'sales_log.corrected', 'sales_log_id', log_row.id,
    'previous_revision_id', old_revision.id, 'revision_id', new_revision.id,
    'revision_number', new_revision.revision_number, 'old_grand_total', old_revision.grand_total,
    'grand_total', new_revision.grand_total, 'log_date', log_row.log_date, 'sales_agent_id', log_row.sales_agent_id);
  INSERT INTO public.business_events (org_id, source_type, business_key, event_version, payload,
    payload_hash, status, request_id, actor_user_id, occurred_at, processed_at)
  VALUES (p_org_id, 'sales_log', log_row.id::text || ':corrected:' || log_row.version::text,
    log_row.version, event_payload, encode(digest(event_payload::text, 'sha256'), 'hex'),
    'completed', p_request_id, p_actor_user_id, now(), now()) RETURNING id INTO event_id;
  INSERT INTO public.event_outbox (org_id, business_event_id, topic, payload, payload_hash)
  VALUES (p_org_id, event_id, 'sales_log.corrected', event_payload, encode(digest(event_payload::text, 'sha256'), 'hex'));
  UPDATE public.sales_log_commands SET entity_id = log_row.id, status = 'completed', completed_at = now(), result = event_payload WHERE id = command_row.id;
  RETURN NEXT request_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.void_sales_log(
  p_org_id uuid, p_actor_user_id uuid, p_command_id uuid, p_request_id uuid,
  p_sales_log_id uuid, p_expected_version integer, p_reason text
)
RETURNS SETOF public.sales_logs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  command_row public.sales_log_commands%ROWTYPE; log_row public.sales_logs%ROWTYPE;
  old_revision public.sales_log_revisions%ROWTYPE; void_revision public.sales_log_revisions%ROWTYPE;
  actor_role_value text; event_payload jsonb; event_id uuid;
  payload_value jsonb := jsonb_build_object('sales_log_id', p_sales_log_id,
    'expected_version', p_expected_version, 'reason', COALESCE(p_reason, ''));
  hash_value text := encode(digest(payload_value::text, 'sha256'), 'hex');
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Service role is required.' USING ERRCODE = '42501'; END IF;
  SELECT role::text INTO actor_role_value FROM public.org_members WHERE org_id = p_org_id AND user_id = p_actor_user_id
    AND role::text IN ('admin', 'hr_admin', 'sales_manager');
  IF actor_role_value IS NULL THEN RAISE EXCEPTION 'Sales management access is required.' USING ERRCODE = '42501'; END IF;
  IF length(btrim(COALESCE(p_reason, ''))) < 5 THEN RAISE EXCEPTION 'A meaningful void reason is required.' USING ERRCODE = '23514'; END IF;
  INSERT INTO public.sales_log_commands (organization_id, idempotency_key, action, entity_id, payload_hash, actor_user_id, request_id)
  VALUES (p_org_id, p_command_id, 'void', p_sales_log_id, hash_value, p_actor_user_id, p_request_id)
  ON CONFLICT (organization_id, idempotency_key) DO NOTHING;
  SELECT * INTO command_row FROM public.sales_log_commands WHERE organization_id = p_org_id AND idempotency_key = p_command_id FOR UPDATE;
  IF command_row.action <> 'void' OR command_row.payload_hash <> hash_value THEN RAISE EXCEPTION 'Idempotency key was reused for another sales command.' USING ERRCODE = '23505'; END IF;
  IF command_row.status = 'completed' THEN RETURN QUERY SELECT * FROM public.sales_logs WHERE organization_id = p_org_id AND id = p_sales_log_id; RETURN; END IF;
  SELECT * INTO log_row FROM public.sales_logs WHERE organization_id = p_org_id AND id = p_sales_log_id FOR UPDATE;
  IF log_row.id IS NULL THEN RAISE EXCEPTION 'Sales log was not found.' USING ERRCODE = 'P0002'; END IF;
  IF log_row.status = 'voided' OR log_row.version <> p_expected_version THEN RAISE EXCEPTION 'Sales log state or version conflict.' USING ERRCODE = '40001'; END IF;
  IF EXISTS (SELECT 1 FROM public.accounting_invoices invoice WHERE invoice.organization_id = p_org_id
      AND invoice.source_module = 'sales_log' AND invoice.source_id = log_row.id
      AND invoice.status NOT IN ('cancelled', 'void')) THEN
    RAISE EXCEPTION 'Reverse or void the linked sales invoice before voiding this log.' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO old_revision FROM public.sales_log_revisions WHERE organization_id = p_org_id AND id = log_row.current_revision_id FOR UPDATE;
  UPDATE public.sales_log_revisions SET accounting_status = CASE WHEN accounting_status = 'posted' THEN 'reversal_pending' ELSE 'reversed' END WHERE id = old_revision.id;
  INSERT INTO public.sales_log_revisions (organization_id, sales_log_id, revision_number, event_type,
    previous_revision_id, items, subtotal, total_discount, grand_total, notes, reason,
    accounting_status, created_by)
  VALUES (p_org_id, log_row.id, log_row.version + 1, 'void', old_revision.id, '[]'::jsonb,
    0, 0, 0, log_row.notes, btrim(p_reason), 'reversed', p_actor_user_id) RETURNING * INTO void_revision;
  UPDATE public.sales_logs SET status = 'voided', voided_by = p_actor_user_id, voided_at = now(),
    void_reason = btrim(p_reason), current_revision_id = void_revision.id, version = version + 1,
    reviewed_by = p_actor_user_id, reviewed_at = now(), updated_at = now()
  WHERE id = log_row.id RETURNING * INTO log_row;
  UPDATE public.sales_log_edit_requests SET status = 'rejected', resolved_by = p_actor_user_id,
    resolved_at = now(), resolution_note = 'Sale log was voided', updated_at = now()
  WHERE organization_id = p_org_id AND sales_log_id = log_row.id AND status = 'pending';
  event_payload := jsonb_build_object('event_type', 'sales_log.voided', 'sales_log_id', log_row.id,
    'previous_revision_id', old_revision.id, 'revision_id', void_revision.id,
    'revision_number', void_revision.revision_number, 'old_grand_total', old_revision.grand_total,
    'grand_total', 0, 'log_date', log_row.log_date, 'sales_agent_id', log_row.sales_agent_id,
    'reason', log_row.void_reason);
  INSERT INTO public.business_events (org_id, source_type, business_key, event_version, payload,
    payload_hash, status, request_id, actor_user_id, occurred_at, processed_at)
  VALUES (p_org_id, 'sales_log', log_row.id::text || ':voided:' || log_row.version::text,
    log_row.version, event_payload, encode(digest(event_payload::text, 'sha256'), 'hex'),
    'completed', p_request_id, p_actor_user_id, now(), now()) RETURNING id INTO event_id;
  INSERT INTO public.event_outbox (org_id, business_event_id, topic, payload, payload_hash)
  VALUES (p_org_id, event_id, 'sales_log.voided', event_payload, encode(digest(event_payload::text, 'sha256'), 'hex'));
  UPDATE public.sales_log_commands SET status = 'completed', completed_at = now(), result = event_payload WHERE id = command_row.id;
  RETURN NEXT log_row;
END;
$$;

REVOKE ALL ON FUNCTION public.canonical_sales_log_items(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.submit_sales_log(uuid, uuid, uuid, uuid, uuid, jsonb, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.resolve_sales_log_edit(uuid, uuid, uuid, uuid, uuid, integer, text, jsonb, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.void_sales_log(uuid, uuid, uuid, uuid, uuid, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_sales_log(uuid, uuid, uuid, uuid, uuid, jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.resolve_sales_log_edit(uuid, uuid, uuid, uuid, uuid, integer, text, jsonb, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.void_sales_log(uuid, uuid, uuid, uuid, uuid, integer, text) TO service_role;
